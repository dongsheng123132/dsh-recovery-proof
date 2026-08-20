import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const manifestJson = await readFile('examples/basic/recovery.manifest.json', 'utf8')
const eventsJsonl = await readFile('examples/basic/recovery.events.jsonl', 'utf8')
const forbiddenEvents = `${eventsJsonl.trim()}\n${JSON.stringify({ eventVersion: 1, idempotencyKey: 'secret-event', scenarioId: 'recover', seq: 99, phase: 'verify', status: 'ok', durationMs: 1, objectIds: [], apiToken: 'do-not-echo' })}\n`
const child = spawn(process.execPath, ['mcp-server.mjs'], { cwd: process.cwd(), shell: false, stdio: ['pipe', 'pipe', 'inherit'] })
let output = ''
child.stdout.setEncoding('utf8')
child.stdout.on('data', chunk => { output += chunk })
const request = value => child.stdin.write(`${JSON.stringify(value)}\n`)
request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
request({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
request({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'recovery_manifest_inspect', arguments: { manifestJson } } })
request({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'recovery_evidence_verify', arguments: { manifestJson, eventsJsonl } } })
request({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'recovery_evidence_verify', arguments: { manifestJson, eventsJsonl: forbiddenEvents } } })
child.stdin.end()
await new Promise((resolve, reject) => {
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`MCP exited ${code}`)))
  child.on('error', reject)
})
const messages = output.trim().split(/\r?\n/).map(JSON.parse)
assert.equal(messages[0].result.serverInfo.version, '0.2.0')
assert.deepEqual(messages[1].result.tools.map(({ name }) => name), ['recovery_manifest_inspect', 'recovery_evidence_verify'])
assert.equal(messages[2].result.structuredContent.filesystemAccess, false)
assert.equal(messages[3].result.structuredContent.status, 'structurally-verified')
assert.equal(messages[3].result.structuredContent.objectContentVerification, 'not-performed')
assert.match(messages[4].error.message, /Forbidden field/)
assert.doesNotMatch(output, /do-not-echo/)
process.stdout.write(`${JSON.stringify({ ok: true, tools: messages[1].result.tools.map(({ name }) => name), proofOnly: true, secretFieldRejected: true })}\n`)
