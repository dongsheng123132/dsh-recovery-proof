import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const checkout = process.env.DSH_CHECKOUT
if (!checkout) throw new Error('DSH_CHECKOUT must point to a built DeepSeek Harness checkout')
const pluginEntry = process.env.PLUGIN_ENTRY
const plugin = pluginEntry ? await import(pathToFileURL(resolve(pluginEntry)).href) : await import('../index.js')
const importBuilt = relative => import(pathToFileURL(resolve(checkout, relative)).href)
const { Context } = await importBuilt('vendor/cordis/lib/index.js')
const { default: SystemPrompt } = await importBuilt('packages/core/system-prompt/lib/index.js')
const { default: ToolRuntime } = await importBuilt('packages/core/tools/lib/index.js')
const { TokenMeter } = await importBuilt('packages/llm/token-meter/lib/index.js')

const hash = value => createHash('sha256').update(value).digest('hex')
const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-proof-runtime-'))
await mkdir(join(root, 'objects'))
const values = { pre: 'before\n', rescue: 'rescue\n', restored: 'after\n', rollback: 'before\n' }
for (const [id, value] of Object.entries(values)) await writeFile(join(root, 'objects', `${id}.txt`), value)
const objects = Object.entries(values).map(([id, value]) => ({ id, role: id === 'pre' ? 'prestate' : id, path: `objects/${id}.txt`, sha256: hash(value), revision: 'git:smoke' }))
const scenarios = [
  { id: 'recover', kind: 'recover', expectedPhases: ['snapshot', 'plan', 'rescue', 'apply', 'verify'], requiredObjectIds: ['pre', 'rescue', 'restored'], maxRtoMs: 100 },
  { id: 'rollback', kind: 'failed-apply-rollback', expectedPhases: ['snapshot', 'plan', 'rescue', 'apply', 'rollback', 'verify'], requiredObjectIds: ['pre', 'rescue', 'rollback'], maxRtoMs: 100 },
  { id: 'stale', kind: 'stale-plan-rejection', expectedPhases: ['snapshot', 'plan', 'mutate', 'reject-stale'], requiredObjectIds: ['pre'], maxRtoMs: 100 }
]
await writeFile(join(root, 'manifest.json'), JSON.stringify({ schemaVersion: 1, system: { name: 'smoke', revision: 'git:smoke' }, objects, scenarios }))
const event = (scenarioId, seq, phase, status, objectIds = []) => ({ eventVersion: 1, idempotencyKey: `${scenarioId}-${seq}`, scenarioId, seq, phase, status, durationMs: 1, objectIds })
const events = [
  ...['snapshot', 'plan', 'rescue', 'apply', 'verify'].map((phase, i) => event('recover', i + 1, phase, 'ok', i === 2 ? ['rescue'] : i === 4 ? ['pre', 'restored'] : [])),
  ...['snapshot', 'plan', 'rescue', 'apply', 'rollback', 'verify'].map((phase, i) => event('rollback', i + 1, phase, phase === 'apply' ? 'failed' : 'ok', i === 2 ? ['rescue'] : i === 4 ? ['pre', 'rollback'] : [])),
  ...['snapshot', 'plan', 'mutate', 'reject-stale'].map((phase, i) => event('stale', i + 1, phase, phase === 'reject-stale' ? 'rejected' : 'ok', i === 0 ? ['pre'] : []))
]
await writeFile(join(root, 'events.jsonl'), `${events.map(value => JSON.stringify(value)).join('\n')}\n`)

const ctx = new Context()
try {
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TokenMeter)
  await ctx.plugin(plugin, { workspaceRoot: root })
  const tools = ctx.get('tools')
  const names = tools.schemas().filter(({ name }) => name.startsWith('dsh_recovery_proof_')).map(({ name }) => name)
  assert.deepEqual(names, ['dsh_recovery_proof_inspect', 'dsh_recovery_proof_verify'])
  const inspect = await tools.execute({ signal: new AbortController().signal, callId: 'recovery-inspect', name: 'dsh_recovery_proof_inspect', arguments: { manifestPath: 'manifest.json' } }, {})
  assert.equal(inspect.isError, false)
  assert.equal(inspect.value.readOnly, true)
  const verify = await tools.execute({ signal: new AbortController().signal, callId: 'recovery-verify', name: 'dsh_recovery_proof_verify', arguments: { manifestPath: 'manifest.json', eventsPath: 'events.jsonl', artifactDir: 'artifacts' } }, {})
  assert.equal(verify.isError, false)
  assert.equal(verify.value.status, 'verified')
  assert.equal(verify.value.artifact.verifiedByReadBack, true)
  process.stdout.write(`${JSON.stringify({ ok: true, dshTools: names, status: verify.value.status, artifact: verify.value.artifact })}\n`)
} finally {
  await ctx.fiber.dispose()
}
