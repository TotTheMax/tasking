## ADDED Requirements

### Requirement: turn 事件发射
worker SHALL 在 turn 循环内每个 turn 开始时通过 `events.onEvent` 回调发射 `turn_started` 事件(含 turn 编号),在每个 turn 结束时发射 `turn_completed` 事件(含 token 用量)。调度器 SHALL 使用 `turn_started` 事件递增 `RunningEntry.turn_count`。

#### Scenario: turn 开始时发射事件
- **WHEN** runner 的 turn 循环开始一个新 turn
- **THEN** 通过 `events.onEvent` 发射 `{event: "turn_started", turn: <n>}`

#### Scenario: turn 结束时发射事件
- **WHEN** runner 的 turn 循环结束一个 turn
- **THEN** 通过 `events.onEvent` 发射 `{event: "turn_completed", turn: <n>, usage: {...}}`

### Requirement: rate-limit 提取
worker SHALL 从 `opencode run --format json` 事件流中解析 rate-limit 相关字段(若存在),并 SHALL 通过 `events.onEvent` 回调将 rate-limit 载荷传给调度器。调度器 SHALL 更新 `state.rate_limits`。

#### Scenario: 事件流含 rate-limit
- **WHEN** opencode JSON 输出含 rate-limit 载荷
- **THEN** worker 通过 `events.onEvent` 传递 rate-limit 信息

#### Scenario: 事件流无 rate-limit
- **WHEN** opencode JSON 输出不含 rate-limit 载荷
- **THEN** 不传递 rate-limit 信息,`state.rate_limits` 保持不变

### Requirement: 错误分类
worker SHALL 将 attempt 失败分类为以下类别之一:`invalid_workspace_cwd`、`spawn_failed`、`turn_timeout`、`agent_exit_error`、`stalled`。每个类别 SHALL 在 `AttemptResult` 的 `error` 字段中标注。调度器 SHALL 使用错误类别决定 retry 行为。

#### Scenario: turn 超时分类
- **WHEN** opencode run 子进程超过 `turn_timeout_ms`
- **THEN** attempt 错误分类为 `turn_timeout`

#### Scenario: spawn 失败分类
- **WHEN** `opencode run` 命令无法启动
- **THEN** attempt 错误分类为 `spawn_failed`

#### Scenario: 异常退出分类
- **WHEN** `opencode run` 子进程以非零退出码退出
- **THEN** attempt 错误分类为 `agent_exit_error`
