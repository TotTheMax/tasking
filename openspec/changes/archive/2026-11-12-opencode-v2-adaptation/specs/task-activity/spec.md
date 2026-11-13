## MODIFIED Requirements

### Requirement: opencode 事件增量捕获

驱动器轮询层 SHALL 在 `session.message.list` 的 diff 中识别新增/变更的 assistant 消息，并把其 `content[]` 条目转换为结构化活动事件：`type:"text"`（text 条目 → `text`）与 `type:"tool"`（tool 条目 → `tool`，工具名从条目取）。未知条目类型 SHALL 保留原样上报不崩溃。对 `type:"tool"` 条目，SHALL 同时提取执行详情：`state.input` → `input`（参数对象，如 shell 的 `command`）、`state.metadata.exit` → `exit`（退出码）、`state.metadata.truncated` → `truncated`、`state.time.created/ran/completed` → `durationMs`（completed-reated 耗时毫秒）。`state` 或其任一字段缺失时 SHALL 优雅降级——仅保留既有字段上报，不抛错。转换后的事件经 `onActivity` 上报，消费侧（ActivityStore、卡片、TUI）接口不变。

#### Scenario: text 消息被捕获

- **WHEN** 轮询 diff 发现一条 assistant 消息含 `content:[{type:"text", text:"hello"}]`
- **THEN** `onActivity` 收到 `{ type:"text", text:"hello" }`

#### Scenario: 工具条目详情被捕获

- **WHEN** 轮询 diff 发现 tool 条目 `state:{input:{command:"echo x"}, metadata:{exit:0}, time:{created:t1, completed:t2}}`
- **THEN** 活动事件含 `tool`、`input.command="echo x"`、`exit=0`、`durationMs=t2-t1`

#### Scenario: 未知条目类型不崩溃

- **WHEN** 消息含未知的 `content` 条目类型
- **THEN** 该条目以原 type 上报或被跳过，不抛错

### Requirement: 逐步 token 用量实时累计

worker SHALL 在轮询发现携带 `tokens` 的消息/会话用量时，经 `events.onEvent` 上报 `step_usage` 事件（`usage` 为 `{ input_tokens, output_tokens, total_tokens }`，total 为 input+output+reasoning 合计口径）。scheduler SHALL 将 `step_usage` 的 usage 累计到该 task 的 `RunningEntry`，使进行中的 turn 内 per-task token 实时更新。`turn_completed` 事件 SHALL 不携带 `usage`，避免重复计数。

#### Scenario: turn 内实时累计

- **WHEN** 一个 turn 内轮询发现两个携带 tokens 的消息（usage 分别为 `{100,10,110}`、`{50,5,55}`）
- **THEN** 该 task 的 `RunningEntry` 累计为 `{150,15,165}`，且发生在 turn 结束前即可读取

#### Scenario: turn_completed 不再计 usage

- **WHEN** 收到 `turn_completed` 事件（无 usage 字段）
- **THEN** 不向 `RunningEntry` 累计任何 token

### Requirement: 会话级 token 持久化

session sidecar SHALL 存储累计 token（`input_tokens` / `output_tokens` / `total_tokens`，可选字段）。worker SHALL 在每次 turn 完成写入 sidecar 时携带「恢复基线 + 本次 attempt 累计」的会话累计值。scheduler 派发时 SHALL 从 sidecar 恢复 token 到新建的 `RunningEntry`，使重试与 daemon 重启后 per-task token 显示会话生命周期累计值而非清零。

#### Scenario: 重启后恢复 token

- **WHEN** 某 task 的 sidecar 含 `totalTokens=81737` 且 daemon 重启后重新派发该 task
- **THEN** 新建 `RunningEntry` 的 `total_tokens` 初始为 81737，叠加本次运行增量

#### Scenario: 旧 sidecar 无 token 字段

- **WHEN** 旧版 sidecar 仅有 `session_id`/`turn_count`
- **THEN** 恢复 token 为 0，不报错

#### Scenario: 后续 attempt 累加到会话值

- **WHEN** 恢复基线 81737 后本次 attempt 又消耗 5000
- **THEN** sidecar 与 `RunningEntry` 的累计变为 86737
