# DSH Recovery Proof

[![CI](https://github.com/dongsheng123132/dsh-recovery-proof/actions/workflows/ci.yml/badge.svg)](https://github.com/dongsheng123132/dsh-recovery-proof/actions/workflows/ci.yml)
[![MIT 许可证](https://img.shields.io/github/license/dongsheng123132/dsh-recovery-proof)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-%E2%89%A522-339933?logo=nodedotjs&logoColor=white)](package.json)
[![Awesome DSH Plugins](https://img.shields.io/badge/Awesome_DSH-%E5%B7%B2%E9%AA%8C%E8%AF%81%E5%AE%9E%E9%AA%8C-0969da)](https://github.com/dongsheng123132/awesome-dsh-plugins/blob/main/README.zh-CN.md#2origin-%E6%8F%92%E4%BB%B6%E5%AE%9E%E9%AA%8C%E5%AE%A4)

面向 DeepSeek Harness 的只读恢复演练证据核验插件。它不恢复文件、不创建检查点，也不替代 Turn Rewind / Checkpoint Rewind 等恢复执行器；它专门验证外部恢复演练是否留下了可复核证据。v0.2.0 同时是正式 Codex 插件，带独立 proof-only MCP，并用真实 stock DSH Web Loader 防回归。

它会核验对象 SHA-256 与 revision、恢复/失败回滚/陈旧计划拒绝的精确阶段顺序、救援副本先于 apply、RTO 阈值，并把缺失或陈旧证据完整披露到内容寻址 JSON 报告。输入中的 secret、token、prompt、chat、content 等字段会被拒绝，对象正文不会进入输出。

```sh
dsh plugin install github:dongsheng123132/dsh-recovery-proof
dsh plugin compose dsh-recovery-proof

dsh-recovery-proof verify --workspace-root ./examples/basic --manifest recovery.manifest.json --events recovery.events.jsonl --artifact-dir artifacts
```

插件注册 `dsh_recovery_proof_inspect` 与 `dsh_recovery_proof_verify` 两个 DSH 工具。入口只导出 Cordis namespace（`name`、`inject`、`apply`），不再导出会让 stock Loader 丢失 `tools` 注入元数据的 default 函数。

Codex MCP 另提供 `recovery_manifest_inspect` 和 `recovery_evidence_verify`。它们只验证最大 1 MiB 的内联 manifest/结构化 JSONL，不访问文件系统、不解引用对象、不写报告、不执行恢复；结果会明确披露“未核验对象正文”。若要对 workspace 中的对象 SHA-256 和内容寻址报告做真实回读，请使用 DSH 或 CLI 表面。

所有持久化表面的路径都必须位于 `workspaceRoot` 内，拒绝符号链接；不启动 shell、不访问网络、不执行恢复动作。详见英文 README、`SECURITY.md` 与 `examples/basic`。

MIT
