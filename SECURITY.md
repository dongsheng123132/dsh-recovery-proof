# Security policy

`dsh-recovery-proof` verifies recovery-drill evidence; it never performs a restore.

- DSH and CLI file access is confined to an explicit `workspaceRoot`. Input files must be regular, non-symlink files. The only write surface is an explicit workspace-relative `artifactDir`, and reports are content-addressed and verified after write.
- The MCP server is proof-only: it accepts bounded inline manifest JSON and structural event JSONL, does not access the filesystem or network, and does not execute recovery commands.
- Manifest and event fields shaped like credentials, prompts, chats, messages, claims, text, or content are rejected. Object contents and secret values are never copied into reports or errors.
- The package has no install lifecycle scripts and spawns no shell.

Report vulnerabilities privately through GitHub Security Advisories for this repository. Do not include live secrets, production backups, or original business data in a report.
