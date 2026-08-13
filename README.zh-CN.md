# DSH Recovery Proof

面向 DeepSeek Harness 的只读恢复演练证据核验插件。它不恢复文件、不创建检查点，也不替代 Turn Rewind / Checkpoint Rewind 等恢复执行器；它专门验证外部恢复演练是否留下了可复核证据。

它会核验对象 SHA-256 与 revision、恢复/失败回滚/陈旧计划拒绝的精确阶段顺序、救援副本先于 apply、RTO 阈值，并把缺失或陈旧证据完整披露到内容寻址 JSON 报告。输入中的 secret、token、prompt、chat、content 等字段会被拒绝，对象正文不会进入输出。

```sh
dsh plugin install github:dongsheng123132/dsh-recovery-proof
dsh plugin compose dsh-recovery-proof

dsh-recovery-proof verify --workspace-root ./examples/basic --manifest recovery.manifest.json --events recovery.events.jsonl --artifact-dir artifacts
```

插件注册 `dsh_recovery_proof_inspect` 与 `dsh_recovery_proof_verify` 两个工具。所有路径都必须位于 `workspaceRoot` 内，拒绝符号链接；不启动 shell、不访问网络、不执行恢复动作。详见英文 README 与 `examples/basic`。

MIT
