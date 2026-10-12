## REMOVED Requirements

### Requirement: rate-limit 提取
**Reason**: 从未接线实现。Jira Data Center 不返回限流响应头，worker 也未从 opencode 事件流提取 rate-limit 载荷。`state.rate_limits` 始终为 null，TUI 始终显示 `unavailable`。保留死代码增加维护负担。
**Migration**: 移除 `RateLimits` 接口、`createEmptyRateLimits`、`OrchestratorRuntimeState.rate_limits`、`RuntimeSnapshot.rate_limits`、HTTP 响应中的 `rate_limits` 字段。无外部消费者依赖该字段。

## MODIFIED Requirements

### Requirement: 运行时状态快照
daemon SHALL 暴露同步运行时快照(供 `tasking status` 与任何 HTTP dashboard 使用),返回:`running`(运行中行列表,含 `session_id`、`turn_count`、标识符、状态、时间、token)、`retrying`(retry 队列行列表,含 attempt/due/error)、`codex_totals`(input/output/total token、seconds_running)。运行中行的 `session_id` SHALL 从 `RunningEntry.session_id` 实时填充(由 worker 从 JSON 事件流提取)。token 字段 SHALL 反映从 JSON `step_finish` 事件累加的真实用量。快照失败模式 SHALL 为 `timeout` 或 `unavailable`。

#### Scenario: 快照反映运行与重试
- **WHEN** 有活动与重试任务时调用 `tasking status`
- **THEN** 快照列出两者及文档化字段

#### Scenario: 快照含 session ID
- **WHEN** 某运行中任务已提取 session ID
- **THEN** 快照中该任务的 `session_id` 字段为实际值(非 null)

#### Scenario: 快照超时被暴露
- **WHEN** 快照无法及时产出
- **THEN** 暴露 `timeout` 错误模式
