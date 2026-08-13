#!/usr/bin/env node
import { inspectRecoveryDrill, verifyRecoveryDrill } from '../lib/recovery-proof.mjs'

const [command, ...rest] = process.argv.slice(2)
const args = Object.fromEntries(rest.reduce((pairs, item, i) => item.startsWith('--') ? [...pairs, [item.slice(2), rest[i + 1]]] : pairs, []))

function usage() {
  process.stderr.write('Usage:\n  dsh-recovery-proof inspect --workspace-root DIR --manifest FILE\n  dsh-recovery-proof verify --workspace-root DIR --manifest FILE --events FILE --artifact-dir DIR\n')
}

try {
  let result
  if (command === 'inspect' && args.manifest) result = await inspectRecoveryDrill({ workspaceRoot: args['workspace-root'] ?? process.cwd(), manifestPath: args.manifest })
  else if (command === 'verify' && args.manifest && args.events && args['artifact-dir']) result = await verifyRecoveryDrill({ workspaceRoot: args['workspace-root'] ?? process.cwd(), manifestPath: args.manifest, eventsPath: args.events, artifactDir: args['artifact-dir'] })
  else { usage(); process.exitCode = 1 }
  if (result) {
    process.stdout.write(`${JSON.stringify(result)}\n`)
    if (command === 'verify' && result.status !== 'verified') process.exitCode = 2
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, code: error.code ?? 'ERROR', error: error.message })}\n`)
  process.exitCode = 1
}
