# DSH Recovery Proof

[![CI](https://github.com/dongsheng123132/dsh-recovery-proof/actions/workflows/ci.yml/badge.svg)](https://github.com/dongsheng123132/dsh-recovery-proof/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/github/license/dongsheng123132/dsh-recovery-proof)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-%E2%89%A522-339933?logo=nodedotjs&logoColor=white)](package.json)
[![Awesome DSH Plugins](https://img.shields.io/badge/Awesome_DSH-verified_lab-0969da)](https://github.com/dongsheng123132/awesome-dsh-plugins#2origin-plugin-lab)

A read-only recovery-drill evidence verifier for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness). It does **not** restore files, create checkpoints, or replace recovery executors such as Turn Rewind or Checkpoint Rewind. It verifies that an external drill left reproducible evidence. Version 0.2.0 is also a formal Codex plugin with a proof-only MCP server, and its namespace export is regression-tested against the stock DSH Web Loader.

## What it proves

- every referenced prestate, rescue, restored or rollback object is a regular workspace file with the declared SHA-256 and revision;
- recovery, failed-apply rollback and stale-plan rejection follow the manifest's exact phase sequence;
- rescue evidence exists before apply, failed apply is followed by successful rollback, and stale plans are rejected;
- accumulated structural event duration remains within each scenario's RTO threshold;
- missing/stale evidence and every failed rule are disclosed in a content-addressed JSON report.

Inputs are explicit JSON/JSONL files. Secret-, token-, prompt-, chat- and content-shaped fields are rejected. Object contents are never included in output. The verifier writes only to the explicit workspace-relative `artifactDir`, using an atomic write and SHA-256 read-back check.

## Install and compose

```sh
dsh plugin install github:dongsheng123132/dsh-recovery-proof
dsh plugin compose dsh-recovery-proof
```

The bundle registers `dsh_recovery_proof_inspect` and `dsh_recovery_proof_verify`. The package intentionally exports a Cordis namespace (`name`, `inject`, `apply`) rather than a default function so the stock Loader retains the `tools` injection declaration.

## CLI

```sh
dsh-recovery-proof inspect --workspace-root ./examples/basic --manifest recovery.manifest.json
dsh-recovery-proof verify --workspace-root ./examples/basic --manifest recovery.manifest.json --events recovery.events.jsonl --artifact-dir artifacts
```

Exit code `0` means the command ran and verification passed, `2` means the evidence was processed but failed policy, and `1` means invalid or unsafe input.

## Manifest and events

See [`examples/basic`](examples/basic). A manifest pins `system.revision`, content-addressed objects, and explicit scenarios with `expectedPhases`, `requiredObjectIds`, and `maxRtoMs`. Events contain only structural facts: unique idempotency key, scenario, sequence, phase, status, duration and object references.

## Codex and proof-only MCP

The repository retains a validated `.codex-plugin/plugin.json` and declares the stdio server in `.mcp.json`. MCP exposes:

- `recovery_manifest_inspect` for bounded inline manifest validation;
- `recovery_evidence_verify` for bounded inline JSONL phase/RTO/rollback/stale-plan checks.

Both MCP tools reuse the same validation core as DSH and CLI, but never access the filesystem, dereference object paths, write an artifact or execute a recovery action. Their result explicitly states that object-content verification was not performed. Use the DSH or CLI surface when object hashes and the content-addressed report must be verified against a workspace.

## Security boundary

All input paths and the output directory must remain under `workspaceRoot`; symlink inputs and symlink output directories are rejected. No shell is spawned, no network is used, no recovery action is executed, and there are no install lifecycle scripts.

## Development

```sh
npm test
npm run check
npm run smoke:plugin
npm run smoke:mcp

# Requires a built DeepSeek Harness checkout.
DSH_CHECKOUT=/path/to/deepseek-harness npm run smoke:dsh
DSH_CHECKOUT=/path/to/deepseek-harness DSH_HOME=/path/to/isolated-home npm run smoke:web-loader
```

MIT
