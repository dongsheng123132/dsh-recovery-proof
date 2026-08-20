#!/usr/bin/env node
import readline from 'node:readline'
import { inspectRecoveryManifestJson, verifyRecoveryEvidenceJsonl } from './lib/recovery-proof.mjs'

const MAX_LINE_BYTES = 3 * 1024 * 1024
const tools = [
  {
    name: 'recovery_manifest_inspect',
    description: 'Validate a bounded inline recovery manifest and return only structural policy, counts and SHA-256 evidence without filesystem access.',
    inputSchema: { type: 'object', required: ['manifestJson'], additionalProperties: false, properties: { manifestJson: { type: 'string', maxLength: 1_048_576 } } }
  },
  {
    name: 'recovery_evidence_verify',
    description: 'Verify bounded inline structural recovery events against an inline manifest. Does not dereference objects, write reports or execute a restore.',
    inputSchema: {
      type: 'object', required: ['manifestJson', 'eventsJsonl'], additionalProperties: false,
      properties: { manifestJson: { type: 'string', maxLength: 1_048_576 }, eventsJsonl: { type: 'string', maxLength: 1_048_576 } }
    }
  }
]

function call(name, args) {
  if (name === 'recovery_manifest_inspect') return inspectRecoveryManifestJson(args.manifestJson)
  if (name === 'recovery_evidence_verify') return verifyRecoveryEvidenceJsonl(args.manifestJson, args.eventsJsonl)
  throw new Error('Unknown tool')
}

const send = value => process.stdout.write(`${JSON.stringify(value)}\n`)
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of lines) {
  if (!line.trim() || Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) continue
  let request
  try { request = JSON.parse(line) } catch { continue }
  if (request.id === undefined) continue
  try {
    if (request.method === 'initialize') {
      send({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'dsh-recovery-proof', version: '0.2.0' } } })
    } else if (request.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: request.id, result: { tools } })
    } else if (request.method === 'tools/call') {
      const result = call(request.params?.name, request.params?.arguments ?? {})
      send({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result } })
    } else {
      send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } })
    }
  } catch (error) {
    send({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: error.message, data: { code: error.code ?? 'INVALID_RECOVERY_EVIDENCE' } } })
  }
}
