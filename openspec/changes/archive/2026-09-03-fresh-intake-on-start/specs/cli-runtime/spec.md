## MODIFIED Requirements

### Requirement: start --fresh 以新机器方式启动飞书桥
`tasking start` SHALL 支持 `--fresh` option：仅在 `feishu.enabled` 时生效——在桥启动（首次 Sweep 前）执行新机模式重置（清空本地 intake 游标 + 按 Jira 现状对账过期 binding，见 `comment-bridge` 能力）。`feishu.enabled=false` 时 `--fresh` SHALL 打印一行提示（说明仅飞书桥启用时生效）并照常以 0 继续启动。`--fresh` SHALL 与 `--detach`、`--tui` 正交组合。CLI help 的 start 段 SHALL 列出 `--fresh` 及其含义。

#### Scenario: fresh 且飞书启用 → 桥以新机模式启动
- **WHEN** `feishu.enabled=true` 且调用 `tasking start --fresh`
- **THEN** `bridge.start()` 前执行 `freshStartReset()`，首次 Sweep 即按冷启动探测语义运行，不回放停机窗口历史

#### Scenario: fresh 且飞书未启用 → 提示并继续
- **WHEN** `feishu.enabled=false` 且调用 `tasking start --fresh`
- **THEN** 打印「`--fresh` 仅在 feishu.enabled 时生效」提示，daemon 照常以 0 继续启动（no-op）

#### Scenario: help 列出 --fresh
- **WHEN** 调用 `tasking start -h`
- **THEN** 输出含 `--fresh` 及其说明
