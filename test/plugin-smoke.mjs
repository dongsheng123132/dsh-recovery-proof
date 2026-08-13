import assert from 'node:assert/strict'
import { createDefinitions } from '../index.js'

const definitions = createDefinitions({}, { workspaceRoot: process.cwd() })
assert.deepEqual(definitions.map(({ name }) => name), ['dsh_recovery_proof_inspect', 'dsh_recovery_proof_verify'])
process.stdout.write(`${JSON.stringify({ ok: true, tools: definitions.map(({ name }) => name) })}\n`)
