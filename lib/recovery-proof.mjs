import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

const FORBIDDEN_KEYS = /^(authorization|secret|token|password|credential|chat|prompt|message|content|text|claim)$/i
const PHASES = new Set(['snapshot', 'plan', 'rescue', 'apply', 'rollback', 'verify', 'mutate', 'reject-stale'])
const ROLES = new Set(['prestate', 'checkpoint', 'rescue', 'restored', 'rollback', 'journal'])

export class RecoveryProofError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'RecoveryProofError'
    this.code = code
    this.details = details
  }
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
  return value
}
const stableJson = (value) => `${JSON.stringify(stable(value), null, 2)}\n`

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RecoveryProofError('INVALID_SCHEMA', `${label} must be an object`)
}

function assertNoSecrets(value, at = '$') {
  if (Array.isArray(value)) return value.forEach((item, i) => assertNoSecrets(item, `${at}[${i}]`))
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) throw new RecoveryProofError('FORBIDDEN_FIELD', `Forbidden field at ${at}.${key}`)
    assertNoSecrets(child, `${at}.${key}`)
  }
}

async function safeWorkspaceFile(workspaceRoot, relativePath, label) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) throw new RecoveryProofError('UNSAFE_PATH', `${label} must be a non-empty workspace-relative path`)
  const root = await realpath(workspaceRoot)
  const target = path.resolve(root, relativePath)
  const rel = path.relative(root, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new RecoveryProofError('UNSAFE_PATH', `${label} escapes workspaceRoot`)
  const stats = await lstat(target)
  if (stats.isSymbolicLink() || !stats.isFile()) throw new RecoveryProofError('UNSAFE_PATH', `${label} must be a regular, non-symlink file`)
  const resolved = await realpath(target)
  const resolvedRel = path.relative(root, resolved)
  if (resolvedRel.startsWith('..') || path.isAbsolute(resolvedRel)) throw new RecoveryProofError('UNSAFE_PATH', `${label} resolves outside workspaceRoot`)
  return { root, target: resolved }
}

async function safeArtifactDir(workspaceRoot, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) throw new RecoveryProofError('UNSAFE_PATH', 'artifactDir must be a non-empty workspace-relative path')
  const root = await realpath(workspaceRoot)
  const target = path.resolve(root, relativePath)
  const rel = path.relative(root, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new RecoveryProofError('UNSAFE_PATH', 'artifactDir escapes workspaceRoot')
  await mkdir(target, { recursive: true })
  const stats = await lstat(target)
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new RecoveryProofError('UNSAFE_PATH', 'artifactDir must be a real directory')
  const resolved = await realpath(target)
  const resolvedRel = path.relative(root, resolved)
  if (resolvedRel.startsWith('..') || path.isAbsolute(resolvedRel)) throw new RecoveryProofError('UNSAFE_PATH', 'artifactDir resolves outside workspaceRoot')
  return resolved
}

function validateManifest(manifest) {
  assertPlainObject(manifest, 'manifest')
  assertNoSecrets(manifest)
  if (manifest.schemaVersion !== 1) throw new RecoveryProofError('INVALID_SCHEMA', 'schemaVersion must be 1')
  assertPlainObject(manifest.system, 'system')
  if (typeof manifest.system.name !== 'string' || typeof manifest.system.revision !== 'string') throw new RecoveryProofError('INVALID_SCHEMA', 'system.name and system.revision are required strings')
  if (!Array.isArray(manifest.objects) || !Array.isArray(manifest.scenarios)) throw new RecoveryProofError('INVALID_SCHEMA', 'objects and scenarios must be arrays')
  const objectIds = new Set()
  for (const [i, object] of manifest.objects.entries()) {
    assertPlainObject(object, `objects[${i}]`)
    if (typeof object.id !== 'string' || objectIds.has(object.id)) throw new RecoveryProofError('INVALID_SCHEMA', `objects[${i}].id must be unique`)
    if (!ROLES.has(object.role) || typeof object.path !== 'string' || !/^[a-f0-9]{64}$/.test(object.sha256) || typeof object.revision !== 'string') throw new RecoveryProofError('INVALID_SCHEMA', `objects[${i}] has invalid role, path, sha256 or revision`)
    objectIds.add(object.id)
  }
  const scenarioIds = new Set()
  for (const [i, scenario] of manifest.scenarios.entries()) {
    assertPlainObject(scenario, `scenarios[${i}]`)
    if (typeof scenario.id !== 'string' || scenarioIds.has(scenario.id)) throw new RecoveryProofError('INVALID_SCHEMA', `scenarios[${i}].id must be unique`)
    if (!['recover', 'failed-apply-rollback', 'stale-plan-rejection'].includes(scenario.kind)) throw new RecoveryProofError('INVALID_SCHEMA', `scenarios[${i}].kind is unsupported`)
    if (!Array.isArray(scenario.expectedPhases) || scenario.expectedPhases.length === 0 || scenario.expectedPhases.some((phase) => !PHASES.has(phase))) throw new RecoveryProofError('INVALID_SCHEMA', `scenarios[${i}].expectedPhases is invalid`)
    if (!Array.isArray(scenario.requiredObjectIds) || scenario.requiredObjectIds.some((id) => !objectIds.has(id))) throw new RecoveryProofError('INVALID_SCHEMA', `scenarios[${i}].requiredObjectIds contains an unknown object`)
    if (!Number.isSafeInteger(scenario.maxRtoMs) || scenario.maxRtoMs < 0) throw new RecoveryProofError('INVALID_SCHEMA', `scenarios[${i}].maxRtoMs must be a non-negative integer`)
    scenarioIds.add(scenario.id)
  }
  return manifest
}

async function loadManifest(workspaceRoot, manifestPath) {
  const { target } = await safeWorkspaceFile(workspaceRoot, manifestPath, 'manifestPath')
  const bytes = await readFile(target)
  let value
  try { value = JSON.parse(bytes.toString('utf8')) } catch { throw new RecoveryProofError('INVALID_JSON', 'manifestPath is not valid JSON') }
  return { manifest: validateManifest(value), manifestSha256: sha256(bytes) }
}

function validateEvent(event, line, scenarioIds, seenKeys) {
  assertPlainObject(event, `event line ${line}`)
  assertNoSecrets(event, `$event[${line}]`)
  if (event.eventVersion !== 1 || typeof event.idempotencyKey !== 'string' || seenKeys.has(event.idempotencyKey)) throw new RecoveryProofError('INVALID_EVENT', `line ${line}: eventVersion must be 1 and idempotencyKey unique`)
  if (!scenarioIds.has(event.scenarioId) || !Number.isSafeInteger(event.seq) || event.seq < 1 || !PHASES.has(event.phase) || !['ok', 'failed', 'rejected'].includes(event.status)) throw new RecoveryProofError('INVALID_EVENT', `line ${line}: invalid scenarioId, seq, phase or status`)
  if (!Number.isSafeInteger(event.durationMs) || event.durationMs < 0) throw new RecoveryProofError('INVALID_EVENT', `line ${line}: durationMs must be a non-negative integer`)
  if (!Array.isArray(event.objectIds) || event.objectIds.some((id) => typeof id !== 'string')) throw new RecoveryProofError('INVALID_EVENT', `line ${line}: objectIds must be strings`)
  seenKeys.add(event.idempotencyKey)
  return event
}

async function loadEvents(workspaceRoot, eventsPath, manifest) {
  const { target } = await safeWorkspaceFile(workspaceRoot, eventsPath, 'eventsPath')
  const raw = await readFile(target, 'utf8')
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const scenarioIds = new Set(manifest.scenarios.map(({ id }) => id))
  const seenKeys = new Set()
  return { events: lines.map((line, i) => {
    let value
    try { value = JSON.parse(line) } catch { throw new RecoveryProofError('INVALID_JSONL', `eventsPath line ${i + 1} is not valid JSON`) }
    return validateEvent(value, i + 1, scenarioIds, seenKeys)
  }), eventsSha256: sha256(raw) }
}

async function inspectObjects(workspaceRoot, objects) {
  const results = []
  for (const object of objects) {
    try {
      const { target } = await safeWorkspaceFile(workspaceRoot, object.path, `object ${object.id}.path`)
      const actualSha256 = sha256(await readFile(target))
      results.push({ id: object.id, role: object.role, revision: object.revision, expectedSha256: object.sha256, actualSha256, status: actualSha256 === object.sha256 ? 'current' : 'stale' })
    } catch (error) {
      if (error?.code === 'ENOENT') results.push({ id: object.id, role: object.role, revision: object.revision, expectedSha256: object.sha256, actualSha256: null, status: 'missing' })
      else throw error
    }
  }
  return results
}

function verifyScenarios(manifest, events) {
  const knownObjects = new Set(manifest.objects.map(({ id }) => id))
  return manifest.scenarios.map((scenario) => {
    const actual = events.filter((event) => event.scenarioId === scenario.id).sort((a, b) => a.seq - b.seq)
    const findings = []
    const phases = actual.map(({ phase }) => phase)
    const seqs = actual.map(({ seq }) => seq)
    if (JSON.stringify(phases) !== JSON.stringify(scenario.expectedPhases)) findings.push({ code: 'PHASE_SEQUENCE_MISMATCH', expected: scenario.expectedPhases, actual: phases })
    if (seqs.some((seq, i) => seq !== i + 1)) findings.push({ code: 'NON_CONTIGUOUS_SEQUENCE', actual: seqs })
    const unknown = [...new Set(actual.flatMap(({ objectIds }) => objectIds).filter((id) => !knownObjects.has(id)))]
    if (unknown.length) findings.push({ code: 'UNKNOWN_OBJECT_REFERENCE', objectIds: unknown })
    const observed = new Set(actual.flatMap(({ objectIds }) => objectIds))
    const missing = scenario.requiredObjectIds.filter((id) => !observed.has(id))
    if (missing.length) findings.push({ code: 'MISSING_REQUIRED_OBJECT', objectIds: missing })
    const totalDurationMs = actual.reduce((sum, { durationMs }) => sum + durationMs, 0)
    if (totalDurationMs > scenario.maxRtoMs) findings.push({ code: 'RTO_EXCEEDED', maxRtoMs: scenario.maxRtoMs, actualRtoMs: totalDurationMs })
    if (scenario.kind === 'recover' && actual.some(({ status }) => status !== 'ok')) findings.push({ code: 'RECOVERY_NOT_SUCCESSFUL' })
    if (scenario.kind === 'failed-apply-rollback') {
      if (!actual.some(({ phase, status }) => phase === 'apply' && status === 'failed')) findings.push({ code: 'FAILED_APPLY_NOT_EVIDENCED' })
      if (!actual.some(({ phase, status }) => phase === 'rollback' && status === 'ok')) findings.push({ code: 'ROLLBACK_NOT_EVIDENCED' })
    }
    if (scenario.kind === 'stale-plan-rejection' && !actual.some(({ phase, status }) => phase === 'reject-stale' && status === 'rejected')) findings.push({ code: 'STALE_PLAN_REJECTION_NOT_EVIDENCED' })
    return { id: scenario.id, kind: scenario.kind, status: findings.length ? 'failed' : 'verified', expectedPhases: scenario.expectedPhases, actualPhases: phases, maxRtoMs: scenario.maxRtoMs, actualRtoMs: totalDurationMs, findings }
  })
}

async function writeReport(workspaceRoot, artifactDir, report) {
  const directory = await safeArtifactDir(workspaceRoot, artifactDir)
  const body = stableJson(report)
  const digest = sha256(body)
  const filename = `recovery-proof-${digest}.json`
  const target = path.join(directory, filename)
  const temporary = path.join(directory, `.${filename}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, body, { encoding: 'utf8', flag: 'wx' })
    try { await rename(temporary, target) } catch (error) {
      if (error.code !== 'EEXIST') throw error
      await unlink(temporary)
    }
    const reread = await readFile(target, 'utf8')
    if (sha256(reread) !== digest) throw new RecoveryProofError('WRITE_VERIFY_FAILED', 'Content-addressed report failed read-back verification')
    return { path: path.relative(await realpath(workspaceRoot), target).replaceAll(path.sep, '/'), sha256: digest }
  } finally {
    try { await unlink(temporary) } catch {}
  }
}

export async function inspectRecoveryDrill({ workspaceRoot = process.cwd(), manifestPath }) {
  const { manifest, manifestSha256 } = await loadManifest(workspaceRoot, manifestPath)
  return { schemaVersion: 1, operation: 'inspect', readOnly: true, system: manifest.system, manifestSha256, objects: manifest.objects.map(({ id, role, revision, sha256: expectedSha256 }) => ({ id, role, revision, expectedSha256 })), scenarios: manifest.scenarios }
}

export async function verifyRecoveryDrill({ workspaceRoot = process.cwd(), manifestPath, eventsPath, artifactDir }) {
  const { manifest, manifestSha256 } = await loadManifest(workspaceRoot, manifestPath)
  const { events, eventsSha256 } = await loadEvents(workspaceRoot, eventsPath, manifest)
  const objects = await inspectObjects(workspaceRoot, manifest.objects)
  const scenarios = verifyScenarios(manifest, events)
  const report = {
    schemaVersion: 1,
    operation: 'verify',
    readOnlyRecovery: true,
    system: manifest.system,
    inputs: { manifestSha256, eventsSha256 },
    status: objects.every(({ status }) => status === 'current') && scenarios.every(({ status }) => status === 'verified') ? 'verified' : 'failed',
    disclosure: { missingObjectIds: objects.filter(({ status }) => status === 'missing').map(({ id }) => id), staleObjectIds: objects.filter(({ status }) => status === 'stale').map(({ id }) => id) },
    objects,
    scenarios
  }
  const artifact = await writeReport(workspaceRoot, artifactDir, report)
  return { ...report, artifact }
}
