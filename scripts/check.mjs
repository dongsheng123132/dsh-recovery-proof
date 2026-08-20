import { readFile } from 'node:fs/promises'

const required = ['package.json', '.codex-plugin/plugin.json', '.mcp.json', 'index.js', 'lib/recovery-proof.mjs', 'bin/dsh-recovery-proof.mjs', 'cordis.patch.yml', 'mcp-server.mjs', 'examples/basic/recovery.manifest.json', 'examples/basic/recovery.events.jsonl', 'README.md', 'README.zh-CN.md', 'SECURITY.md']
const files = Object.fromEntries(await Promise.all(required.map(async file => [file, await readFile(new URL(`../${file}`, import.meta.url), 'utf8')])))
const pkg = JSON.parse(files['package.json'])
const plugin = JSON.parse(files['.codex-plugin/plugin.json'])
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('missing DSH bundle patch')
if (plugin.name !== pkg.name || plugin.version !== pkg.version) throw new Error('package/plugin identity mismatch')
if (plugin.mcpServers !== './.mcp.json') throw new Error('Codex plugin must declare the MCP companion')
if (!files['.mcp.json'].includes('mcp-server.mjs')) throw new Error('MCP declaration is missing its server')
if (pkg.scripts?.preinstall || pkg.scripts?.install || pkg.scripts?.postinstall || pkg.scripts?.prepare) throw new Error('lifecycle scripts are forbidden')
if (/export\s+default\b/.test(files['index.js'])) throw new Error('default export is forbidden: stock DSH Loader must receive namespace inject metadata')
if (!files['cordis.patch.yml'].includes('name: dsh-recovery-proof')) throw new Error('bundle does not mount dsh-recovery-proof')
for (const tool of ['dsh_recovery_proof_inspect', 'dsh_recovery_proof_verify']) {
  if (!files['index.js'].includes(`name: '${tool}'`)) throw new Error(`missing tool ${tool}`)
}
for (const guard of ['FORBIDDEN_FIELD', 'escapes workspaceRoot', 'non-symlink file', 'Content-addressed report failed read-back verification', 'verifiedByReadBack', 'objectContentVerification']) {
  if (!files['lib/recovery-proof.mjs'].includes(guard)) throw new Error(`guard missing: ${guard}`)
}
for (const shared of ['inspectRecoveryManifestJson', 'verifyRecoveryEvidenceJsonl']) {
  if (!files['mcp-server.mjs'].includes(shared)) throw new Error(`MCP must use shared core ${shared}`)
}
process.stdout.write(`${JSON.stringify({ ok: true, requiredFiles: required.length, dshBundle: pkg.dsh.bundle.patch, codexManifest: true, tools: 2, guards: 6, mcp: true, namespaceLoaderSafe: true, lifecycleScripts: false })}\n`)
