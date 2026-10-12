# task-activity Specification

## Purpose
TBD - created by archiving change tui-task-activity-view. Update Purpose after archive.
## Requirements
### Requirement: opencode 事件增量捕获

`runDefaultSubprocess` SHALL 在 opencode stdout 数据到达时增量解析完整 JSON 行（带行缓冲跨 chunk 拼接，按 `\n` 切分，余数留待下一 chunk），对每条可解析的 opencode 事件经可选 `onOpencodeEvent` 回调上报结构化 `OpencodeEvent`。SHALL 识别事件类型 `text`（`part.text` → `text`）/ `tool_use`（`part.tool` → `tool`）/ `step_start` / `step_finish`（`part.tokens` → `tokens`）；未知类型 SHALL 保留 `type` 字段原样上报不崩溃。非 JSON 行 SHALL 安全跳过。现有 stdout 字符串缓冲与 `extractSessionAndUsage` 行为 SHALL 不变。

对 `tool_use` 事件，SHALL 在 `part.state` 存在时同时提取执行详情：`state.input` → `input`（参数对象，如 bash 的 `command`、write 的 `filePath`）、`state.output` → `output`（stdout）、`state.metadata.exit` → `exit`（退出码）、`state.metadata.truncated` → `truncated`（是否被 opencode 截断）、`state.title` → `title`（友好摘要）、`state.status` → `status`、`state.time.start/end` → `durationMs`（耗时毫秒）。`part.state` 或其任一字段缺失时 SHALL 优雅降级——仅保留既有字段（`tool` 等）上报，不抛错。执行详情与既有字段一同经 `onOpencodeEvent`/`onActivity` 上报。

#### Scenario: text 事件被捕获

- **WHEN** opencode stdout 输出 `{"type":"text","sessionID":"ses_x","part":{"text":"hello"}}`
- **THEN** `onOpencodeEvent` 收到 `{ type:"text", text:"hello", sessionId:"ses_x" }`

#### Scenario: tool_use 事件被捕获

- **WHEN** opencode stdout 输出 `{"type":"tool_use","sessionID":"ses_x","part":{"tool":"read"}}`
- **THEN** `onOpencodeEvent` 收到 `{ type:"tool_use", tool:"read", sessionId:"ses_x" }`

#### Scenario: tool_use 执行详情被捕获

- **WHEN** opencode stdout 输出 `{"type":"tool_use","sessionID":"ses_x","part":{"tool":"bash","state":{"status":"completed","input":{"command":"echo hi"},"output":"hi\n","metadata":{"exit":0,"truncated":false},"title":"echo hi","time":{"start":1000,"end":1500}}}}`
- **THEN** `onOpencodeEvent` 收到 `{ type:"tool_use", tool:"bash", input:{command:"echo hi"}, output:"hi\n", exit:0, title:"echo hi", status:"completed", durationMs:500, sessionId:"ses_x" }`

#### Scenario: tool_use 非零退出码被捕获

- **WHEN** tool_use 事件 `state.metadata.exit` 为 `127`
- **THEN** 上报事件的 `exit` 为 `127`（不依赖 `state.status`，因其即使失败也常为 `"completed"`）

#### Scenario: tool_use state 缺失时降级

- **WHEN** opencode stdout 输出 `{"type":"tool_use","sessionID":"ses_x","part":{"tool":"read"}}`（无 `state`）
- **THEN** 收到 `{ type:"tool_use", tool:"read", sessionId:"ses_x" }`，不携带详情字段，不抛错

#### Scenario: step_finish tokens 被捕获

- **WHEN** opencode stdout 输出 `{"type":"step_finish","sessionID":"ses_x","part":{"tokens":{"input":100,"output":10,"total":110}}}`
- **THEN** `onOpencodeEvent` 收到 `{ type:"step_finish", tokens:{input:100,output:10,total:110}, sessionId:"ses_x" }`

#### Scenario: 跨 chunk 的行被正确拼接

- **WHEN** 一个 JSON 事件被分成两个 stdout chunk 到达（如 `{"type":"text","part":{"text":"hel` 然后 `lo"}}\n`）
- **THEN** `onOpencodeEvent` 收到完整解析后的事件，不被分片切断

#### Scenario: 非 JSON 行被跳过

- **WHEN** opencode stdout 含非 JSON 行（如 `not json here`）
- **THEN** 该行被跳过，不调用 `onOpencodeEvent`，不影响后续 JSON 行解析

#### Scenario: 未知事件类型不崩溃

- **WHEN** opencode stdout 输出 `{"type":"some_new_type","sessionID":"ses_x","part":{...}}`
- **THEN** `onOpencodeEvent` 收到 `{ type:"some_new_type", sessionId:"ses_x" }`（其他可选字段缺省），不抛错

#### Scenario: 既有 sessionID 与 tokens 提取不变

- **WHEN** 对同一 stdout 运行 `extractSessionAndUsage`
- **THEN** 返回的 `session_id` 与 `usage` 与引入捕获前完全一致（零回归）

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

