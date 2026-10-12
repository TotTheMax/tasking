## ADDED Requirements

### Requirement: opencode 活动事件捕获与上报

`runAttempt` SHALL 逐 turn 调用 opencode（spawn-per-turn，session 经 `-s` 跨 turn 续接），并在 turn 内经 `runDefaultSubprocess` 的 `onOpencodeEvent` 回调把解析出的 opencode 事件带上 `turn` 编号经 `RunAttemptOptions.onActivity` 上报。`runAttempt` SHALL 在 `turn_started` WorkerEvent 中携带该 turn 解析出的 `agent`（`resolveAgent` 结果）、`model`（`config.opencode.model`）、`variant`（`config.opencode.variant`）。现有 `extractSessionAndUsage` 的 sessionID 与 tokens 提取 SHALL 不变。`spawnRunner` 注入点 SHALL 接受可选 `onOpencodeEvent` 尾参；参数更少的现有 mock 仍 SHALL 满足类型。

#### Scenario: onActivity 收到带 turn 的事件

- **WHEN** `runAttempt` 在 turn 3 运行且 opencode stdout 产生一个 `text` 事件
- **THEN** `onActivity` 收到 `{ ts, turn:3, type:"text", text }`（或对应结构）

#### Scenario: turn_started 携带 agent/model/variant

- **WHEN** turn 解析得 agent=`build`、model=`anthropic/claude-sonnet-4-5`、variant=`high`
- **THEN** `turn_started` WorkerEvent 含 `agent`、`model`、`variant` 三字段

#### Scenario: 未配置 model 时 variant 仍上报

- **WHEN** `config.opencode.model` 为空、variant=`high`
- **THEN** `turn_started` 的 `model` 为 `null`、`variant` 为 `"high"`、`agent` 为解析值

#### Scenario: 既有 spawnRunner mock 不破坏

- **WHEN** 注入的 `spawnRunner` 仅声明 5 个参数（不含 onOpencodeEvent）
- **THEN** 类型检查通过，runAttempt 仍可用（回调经默认 spawnRunner 路径到达 `runDefaultSubprocess`）
