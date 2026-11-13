# task-activity Specification

## Purpose
TBD - created by archiving change tui-task-activity-view. Update Purpose after archive.
## Requirements
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

### Requirement: 活动数据存储

tasking SHALL 提供内存环形缓冲 `ActivityStore`，按 `task_id` 存储带 `turn` 与 `ts` 的 `ActivityEvent`（`{ ts, turn, type, text?, tool?, tokens?, title?, input?, output?, exit?, status?, durationMs?, truncated? }`，新增字段均为可选、向后兼容）。单 task 上限 500 事件，超限丢弃最旧。SHALL 提供 `record(taskId, evt)` / `recent(taskId, limit?)` / `clear(taskId)`。scheduler SHALL 在 worker 退出时清除该 task 的缓冲。

#### Scenario: 记录与读取

- **WHEN** 对 task `T1` 连续 `record` 3 个事件后 `recent("T1")`
- **THEN** 返回该 3 个事件，按记录顺序

#### Scenario: 上限丢弃最旧

- **WHEN** 对 task `T1` `record` 501 个事件后 `recent("T1")`
- **THEN** 返回 500 个事件，最早的 1 个被丢弃

#### Scenario: 不同 task 隔离

- **WHEN** 对 `T1`、`T2` 各 `record` 事件后分别 `recent`
- **THEN** 各自只看到自己的事件

#### Scenario: 清除

- **WHEN** 对 `T1` `record` 后 `clear("T1")` 再 `recent("T1")`
- **THEN** 返回空数组

#### Scenario: 未记录 task 返回空

- **WHEN** 对从未 `record` 的 `T9` 调用 `recent("T9")`
- **THEN** 返回空数组

#### Scenario: 工具详情字段随事件存储与读取

- **WHEN** 对 `T1` `record` 一个含 `title`/`input`/`output`/`exit`/`durationMs` 的 tool_use 事件后 `recent("T1")`
- **THEN** 返回的事件原样携带这些详情字段

### Requirement: 活动数据 HTTP 端点

HTTP dashboard SHALL 暴露 `GET /api/v1/<identifier>/activity`，返回 `{ activity: ActivityEvent[] }`。`identifier` 为 issue 标识或 task_id，解析方式与 `GET /api/v1/<identifier>` 一致。`?limit=N` 控制返回条数，默认 200、上限 500。该路由 SHALL 置于 `GET /api/v1/<identifier>` 兜底路由之前匹配。无 `activityStore` 时 SHALL 返回 404 `activity_not_available`。

#### Scenario: 返回运行中 task 的活动

- **WHEN** task `TAS-17` 正在运行且有活动事件，请求 `GET /api/v1/TAS-17/activity`
- **THEN** 返回 200 与 `{ activity: [...] }`

#### Scenario: limit 裁剪

- **WHEN** task 有 300 个事件，请求 `GET /api/v1/<id>/activity?limit=10`
- **THEN** 返回最近 10 个事件

#### Scenario: limit 上限

- **WHEN** 请求 `?limit=9999`
- **THEN** 至多返回 500 个事件

#### Scenario: 未知 task 404

- **WHEN** 请求 `GET /api/v1/NOPE/activity` 且无此运行 task
- **THEN** 返回 404 `issue_not_found`

#### Scenario: 兜底路由不被活动路由遮蔽

- **WHEN** 请求 `GET /api/v1/TAS-17`（无 `/activity` 后缀）
- **THEN** 仍走原 per-issue 兜底路由，返回运行详情（含新增 model/agent/variant）

### Requirement: per-issue 详情暴露 model/agent/variant

`GET /api/v1/<identifier>` 与 `GET /api/v1/state` 的 running 行 SHALL 包含 `agent` / `model` / `variant`（`string | null`），取自该 turn 解析的 opencode 配置（tasking 传给 opencode 的值）。

#### Scenario: running 行含 model 字段

- **WHEN** task `TAS-17` 正在运行且某 turn 解析得 `model="anthropic/claude-sonnet-4-5"`、`agent="build"`、`variant="high"`
- **THEN** `GET /api/v1/TAS-17` 与 `GET /api/v1/state` 的该 running 行含三者

#### Scenario: 未配置 model 为 null

- **WHEN** task 运行但 `config.opencode.model` 未设
- **THEN** 该行 `model` 为 `null`，`agent`/`variant` 仍按解析值

### Requirement: TUI 活动视图模式

TUI SHALL 在 `detail-running` 模式支持 `a` 键进入新 `activity` 模式。`activity` 模式 SHALL 渲染头部（task 标识、model、agent、variant、当前 turn、tokens total）与可滚动事件列表（助手文本、工具调用、step tokens），支持 `j/k`/`↑/↓`/`PgUp`/`PgDn` 滚动与 `Esc/q` 返回 `detail-running`。进程内 TUI 直读 `ActivityStore`；远端 TUI 进入该模式时 1Hz 拉取活动端点。

#### Scenario: a 键进入活动视图

- **WHEN** 在 `detail-running` 模式按 `a`
- **THEN** 进入 `activity` 模式，渲染该 task 的活动事件

#### Scenario: 活动视图显示助手文本与工具调用

- **WHEN** task 有 `text` 与 `tool_use` 事件且进入活动视图
- **THEN** 事件列表同时渲染助手文本行与工具调用行

#### Scenario: 活动视图头部显示 model

- **WHEN** 进入活动视图且当前 turn 解析得 model/agent/variant
- **THEN** 头部渲染 model、agent、variant 与 turn、tokens

#### Scenario: Esc/q 返回详情

- **WHEN** 在 `activity` 模式按 `Esc` 或 `q`
- **THEN** 返回 `detail-running` 模式

#### Scenario: 滚动

- **WHEN** 活动事件超过视口高度
- **THEN** `j/k`/`↑/↓`/`PgUp`/`PgDn` 可滚动浏览，follow 时自动跟随最新

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

