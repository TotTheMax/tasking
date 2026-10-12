## MODIFIED Requirements

### Requirement: 运行时状态快照
daemon SHALL 暴露同步运行时快照(供 `tasking status` 与任何 HTTP dashboard 使用),返回:`running`(运行中行列表,含 `session_id`、`turn_count`、标识符、状态、时间、token)、`retrying`(retry 队列行列表,含 attempt/due/error)、`codex_totals`(input/output/total token、seconds_running)、以及 `rate_limits`(若可用,最新 rate-limit 负载)。运行中行的 `session_id` SHALL 从 `RunningEntry.session_id` 实时填充(由 worker 从 JSON 事件流提取)。token 字段 SHALL 反映从 JSON `step_finish` 事件累加的真实用量。快照失败模式 SHALL 为 `timeout` 或 `unavailable`。

#### Scenario: 快照反映运行与重试
- **WHEN** 有活动与重试任务时调用 `tasking status`
- **THEN** 快照列出两者及文档化字段

#### Scenario: 快照含 session ID
- **WHEN** 某运行中任务已提取 session ID
- **THEN** 快照中该任务的 `session_id` 字段为实际值(非 null)

#### Scenario: 快照超时被暴露
- **WHEN** 快照无法及时产出
- **THEN** 暴露 `timeout` 错误模式

### Requirement: token 与运行时记账正确性
daemon SHALL 从 `opencode run --format json` 的 JSON 事件流中提取 token 用量,SHALL 遍历所有 `step_finish` 事件累加 `part.tokens` 字段(input、output、total),并 SHALL 跨已结束会话累积聚合 token 总量与运行时秒数,并 SHALL 在快照时加上活动会话的流逝时间。来自 worker 输出的绝对总量 SHALL 以 delta 跟踪以避免重复计数。运行时总量 SHALL 在快照时作为实时聚合上报。

#### Scenario: 从 JSON 事件流提取 token
- **WHEN** `opencode run --format json` 发出 `step_finish` 事件
- **THEN** 累加其 `part.tokens` 字段至聚合总量

#### Scenario: 跨会话累积聚合
- **WHEN** 某会话结束
- **THEN** 其运行时秒数与 token 总量加到累计已结束会话总量

#### Scenario: 快照含活动时间
- **WHEN** 有会话运行时取快照
- **THEN** 上报的运行时含活动会话流逝时间
