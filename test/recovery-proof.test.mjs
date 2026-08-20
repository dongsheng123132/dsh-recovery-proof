import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { inspectRecoveryDrill, inspectRecoveryManifestJson, RecoveryProofError, verifyRecoveryDrill, verifyRecoveryEvidenceJsonl } from '../lib/recovery-proof.mjs'

const hash = (value) => createHash('sha256').update(value).digest('hex')
const event = (scenarioId, seq, phase, status, durationMs, objectIds) => ({ eventVersion: 1, idempotencyKey: `${scenarioId}-${seq}`, scenarioId, seq, phase, status, durationMs, objectIds })

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-recovery-proof-'))
  await mkdir(path.join(root, 'objects'))
  const values = { pre: 'before\n', rescue: 'rescue\n', restored: 'after\n', rollback: 'before\n' }
  for (const [name, value] of Object.entries(values)) await writeFile(path.join(root, 'objects', `${name}.txt`), value)
  const objects = Object.entries(values).map(([id, value]) => ({ id, role: id === 'pre' ? 'prestate' : id, path: `objects/${id}.txt`, sha256: hash(value), revision: 'git:abc123' }))
  const scenarios = [
    { id: 'recover', kind: 'recover', expectedPhases: ['snapshot', 'plan', 'rescue', 'apply', 'verify'], requiredObjectIds: ['pre', 'rescue', 'restored'], maxRtoMs: 100 },
    { id: 'rollback', kind: 'failed-apply-rollback', expectedPhases: ['snapshot', 'plan', 'rescue', 'apply', 'rollback', 'verify'], requiredObjectIds: ['pre', 'rescue', 'rollback'], maxRtoMs: 100 },
    { id: 'stale', kind: 'stale-plan-rejection', expectedPhases: ['snapshot', 'plan', 'mutate', 'reject-stale'], requiredObjectIds: ['pre'], maxRtoMs: 100 }
  ]
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ schemaVersion: 1, system: { name: 'demo', revision: 'git:abc123' }, objects, scenarios }))
  const events = [
    ...['snapshot', 'plan', 'rescue', 'apply', 'verify'].map((phase, i) => event('recover', i + 1, phase, 'ok', 5, i === 2 ? ['rescue'] : i === 4 ? ['restored', 'pre'] : [])),
    ...['snapshot', 'plan', 'rescue', 'apply', 'rollback', 'verify'].map((phase, i) => event('rollback', i + 1, phase, phase === 'apply' ? 'failed' : 'ok', 5, i === 2 ? ['rescue'] : i === 4 ? ['rollback', 'pre'] : [])),
    ...['snapshot', 'plan', 'mutate', 'reject-stale'].map((phase, i) => event('stale', i + 1, phase, phase === 'reject-stale' ? 'rejected' : 'ok', 5, i === 0 ? ['pre'] : []))
  ]
  await writeFile(path.join(root, 'events.jsonl'), `${events.map(JSON.stringify).join('\n')}\n`)
  return root
}

test('inspect exposes policy and hashes, not object content', async () => {
  const root = await fixture()
  const result = await inspectRecoveryDrill({ workspaceRoot: root, manifestPath: 'manifest.json' })
  assert.equal(result.readOnly, true)
  assert.equal(result.scenarios.length, 3)
  assert.equal(JSON.stringify(result).includes('before'), false)
})

test('verify emits a read-back-verified content-addressed report', async () => {
  const root = await fixture()
  const result = await verifyRecoveryDrill({ workspaceRoot: root, manifestPath: 'manifest.json', eventsPath: 'events.jsonl', artifactDir: 'artifacts' })
  assert.equal(result.status, 'verified')
  assert.equal(result.scenarios.every(({ status }) => status === 'verified'), true)
  assert.match(result.artifact.path, /^artifacts\/recovery-proof-[a-f0-9]{64}\.json$/)
  const body = await readFile(path.join(root, result.artifact.path))
  assert.equal(hash(body), result.artifact.sha256)
  assert.equal(result.artifact.verifiedByReadBack, true)
})

test('discloses stale objects and sequence/RTO failures', async () => {
  const root = await fixture()
  await writeFile(path.join(root, 'objects', 'restored.txt'), 'tampered\n')
  const events = (await readFile(path.join(root, 'events.jsonl'), 'utf8')).replace('"durationMs":5', '"durationMs":500')
  await writeFile(path.join(root, 'events.jsonl'), events)
  const result = await verifyRecoveryDrill({ workspaceRoot: root, manifestPath: 'manifest.json', eventsPath: 'events.jsonl', artifactDir: 'artifacts' })
  assert.equal(result.status, 'failed')
  assert.deepEqual(result.disclosure.staleObjectIds, ['restored'])
  assert.equal(result.scenarios[0].findings.some(({ code }) => code === 'RTO_EXCEEDED'), true)
})

test('rejects secret-shaped evidence fields', async () => {
  const root = await fixture()
  await writeFile(path.join(root, 'events.jsonl'), `${JSON.stringify({ ...event('recover', 1, 'snapshot', 'ok', 1, []), token: 'never' })}\n`)
  await assert.rejects(() => verifyRecoveryDrill({ workspaceRoot: root, manifestPath: 'manifest.json', eventsPath: 'events.jsonl', artifactDir: 'artifacts' }), (error) => error instanceof RecoveryProofError && error.code === 'FORBIDDEN_FIELD')
})

test('rejects traversal and symlink evidence', async () => {
  const root = await fixture()
  await assert.rejects(() => inspectRecoveryDrill({ workspaceRoot: root, manifestPath: '../manifest.json' }), /escapes workspaceRoot/)
  const link = path.join(root, 'linked-events.jsonl')
  try {
    await symlink(path.join(root, 'events.jsonl'), link)
    await assert.rejects(() => verifyRecoveryDrill({ workspaceRoot: root, manifestPath: 'manifest.json', eventsPath: 'linked-events.jsonl', artifactDir: 'artifacts' }), /non-symlink file/)
  } catch (error) {
    if (error.code !== 'EPERM') throw error
  }
})

test('inline proof validates structural evidence without filesystem access', async () => {
  const root = await fixture()
  const manifestJson = await readFile(path.join(root, 'manifest.json'), 'utf8')
  const eventsJsonl = await readFile(path.join(root, 'events.jsonl'), 'utf8')
  const inspect = inspectRecoveryManifestJson(manifestJson)
  assert.equal(inspect.filesystemAccess, false)
  assert.equal(inspect.objectCount, 4)
  const result = verifyRecoveryEvidenceJsonl(manifestJson, eventsJsonl)
  assert.equal(result.status, 'structurally-verified')
  assert.equal(result.objectContentVerification, 'not-performed')
  assert.equal(result.eventCount, 15)
})
