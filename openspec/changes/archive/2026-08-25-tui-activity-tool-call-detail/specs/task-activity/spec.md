## MODIFIED Requirements

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
