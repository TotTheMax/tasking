## ADDED Requirements

### Requirement: opencode 事件增量捕获

`runDefaultSubprocess` SHALL 在 opencode stdout 数据到达时增量解析完整 JSON 行（带行缓冲跨 chunk 拼接，按 `\n` 切分，余数留待下一 chunk），对每条可解析的 opencode 事件经可选 `onOpencodeEvent` 回调上报结构化 `OpencodeEvent`。SHALL 识别事件类型 `text`（`part.text` → `text`）/ `tool_use`（`part.tool` → `tool`）/ `step_start` / `step_finish`（`part.tokens` → `tokens`）；未知类型 SHALL 保留 `type` 字段原样上报不崩溃。非 JSON 行 SHALL 安全跳过。现有 stdout 字符串缓冲与 `extractSessionAndUsage` 行为 SHALL 不变。

#### Scenario: text 事件被捕获

- **WHEN** opencode stdout 输出 `{"type":"text","sessionID":"ses_x","part":{"text":"hello"}}`
- **THEN** `onOpencodeEvent` 收到 `{ type:"text", text:"hello", sessionId:"ses_x" }`

#### Scenario: tool_use 事件被捕获

- **WHEN** opencode stdout 输出 `{"type":"tool_use","sessionID":"ses_x","part":{"tool":"read"}}`
- **THEN** `onOpencodeEvent` 收到 `{ type:"tool_use", tool:"read", sessionId:"ses_x" }`

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

tasking SHALL 提供内存环形缓冲 `ActivityStore`，按 `task_id` 存储带 `turn` 与 `ts` 的 `ActivityEvent`（`{ ts, turn, type, text?, tool?, tokens? }`）。单 task 上限 500 事件，超限丢弃最旧。SHALL 提供 `record(taskId, evt)` / `recent(taskId, limit?)` / `clear(taskId)`。scheduler SHALL 在 worker 退出时清除该 task 的缓冲。

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
