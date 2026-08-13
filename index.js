import { defineTool } from '@deepseek-ai/dsh-tools'
import { inspectRecoveryDrill, verifyRecoveryDrill } from './lib/recovery-proof.mjs'

export const name = 'dsh-recovery-proof'
export const inject = ['tools']

const renderJson = (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
const base = (config, args) => ({ workspaceRoot: config.workspaceRoot ?? process.cwd(), manifestPath: args.manifestPath, eventsPath: args.eventsPath, artifactDir: args.artifactDir })

export function createDefinitions(_ctx, config = {}) {
  return [
    defineTool({
      name: 'dsh_recovery_proof_inspect',
      description: 'Inspect a recovery drill manifest without executing a restore. Returns scenario/stage policy, referenced object hashes and manifest SHA-256, never object contents.',
      parameters: { manifestPath: { type: 'string', required: true, description: 'Recovery drill manifest relative to workspaceRoot.' } },
      output: { schema: { type: 'json' }, render: renderJson },
      execute(args) { return inspectRecoveryDrill(base(config, args)) }
    }),
    defineTool({
      name: 'dsh_recovery_proof_verify',
      description: 'Read-only verification of recovery JSONL evidence: exact stage order, object revision/hash freshness, rescue-before-apply, rollback after failure, stale-plan rejection and RTO. Writes only a content-addressed report to artifactDir and read-back verifies it.',
      parameters: {
        manifestPath: { type: 'string', required: true, description: 'Recovery drill manifest relative to workspaceRoot.' },
        eventsPath: { type: 'string', required: true, description: 'Structural recovery events JSONL relative to workspaceRoot.' },
        artifactDir: { type: 'string', required: true, description: 'Only report directory that may be written, relative to workspaceRoot.' }
      },
      output: { schema: { type: 'json' }, render: renderJson },
      execute(args) { return verifyRecoveryDrill(base(config, args)) }
    })
  ]
}

export function apply(ctx, config = {}) {
  for (const definition of createDefinitions(ctx, config)) ctx.tools.register(definition)
}

export default apply
