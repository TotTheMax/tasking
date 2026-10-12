## ADDED Requirements

### Requirement: 逐步 token 用量实时累计

worker SHALL 在解析到 `step_finish` 事件且含 `part.tokens` 时，除上报活动事件外，SHALL 经 `events.onEvent` 上报 `step_usage` 事件（`usage` 为 `{ input_tokens, output_tokens, total_tokens }`）。scheduler SHALL 将 `step_usage` 的 usage 累计到该 task 的 `RunningEntry`，使进行中的 turn 内 per-task token 实时更新。`turn_completed` 事件 SHALL 不再携带 `usage`，避免与 `step_usage` 重复计数。

#### Scenario: turn 内实时累计

- **WHEN** 一个 turn 内收到两个 `step_usage`（usage 分别为 `{100,10,110}`、`{50,5,55}`）
- **THEN** 该 task 的 `RunningEntry` 累计为 `{150,15,165}`，且发生在 turn 结束前即可读取

#### Scenario: turn_completed 不再计 usage

- **WHEN** 收到 `turn_completed` 事件（无 usage 字段）
- **THEN** 不向 `RunningEntry` 累计任何 token

### Requirement: 会话级 token 持久化

session sidecar SHALL 存储累计 token（`input_tokens` / `output_tokens` / `total_tokens`，可选字段，向后兼容旧 sidecar）。worker SHALL 在每次 turn 完成写入 sidecar 时携带「恢复基线 + 本次 attempt 累计」的会话累计值。scheduler 派发时 SHALL 从 sidecar 恢复 token 到新建的 `RunningEntry`，使重试与 daemon 重启后 per-task token 显示会话生命周期累计值而非清零。

#### Scenario: 重启后恢复 token

- **WHEN** 某 task 的 sidecar 含 `totalTokens=81737` 且 daemon 重启后重新派发该 task
- **THEN** 新建 `RunningEntry` 的 `total_tokens` 初始为 81737，叠加本次运行增量

#### Scenario: 旧 sidecar 无 token 字段

- **WHEN** 旧版 sidecar 仅有 `session_id`/`turn_count`
- **THEN** 恢复 token 为 0，不报错

#### Scenario: 后续 attempt 累加到会话值

- **WHEN** 恢复基线 81737 后本次 attempt 又消耗 5000
- **THEN** sidecar 与 `RunningEntry` 的累计变为 86737