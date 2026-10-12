## MODIFIED Requirements

### Requirement: 任务编排状态机
调度器 SHALL 将每个任务的内部 claim 状态跟踪为以下之一:`Unclaimed`、`Claimed`、`Running`、`RetryQueued`、`Released`。任务 SHALL 仅当不在 `running` 且不在 `claimed` 时才被派发。worker 正常退出后,调度器 SHALL 调度一次短续轮 retry(attempt 1),且 SHALL 传 null session ID(continuation retry 创建全新 session)。异常退出后 SHALL 调度一次指数退避 retry,且 SHALL 传 null session ID。`RunningEntry.session_id` SHALL 在 worker 运行期间从 `AttemptResult` 实时更新(供仪表板展示)。

#### Scenario: 正常退出调度续轮 retry 不传 session ID
- **WHEN** worker 正常退出
- **THEN** 调度一次续轮 retry(attempt 1,短固定延迟),传 null session ID(全新 session),并从 `running` 移除该任务

#### Scenario: 异常退出调度退避 retry 不传 session ID
- **WHEN** worker 异常退出
- **THEN** 调度一次指数退避 retry,attempt 递增,传 null session ID(全新 session)

#### Scenario: 无重复派发
- **WHEN** 任务已在 `running` 或 `claimed`
- **THEN** 不再次派发

### Requirement: retry 与指数退避
调度器在创建新 retry 前 SHALL 取消该任务已存在的 retry timer。失败驱动 retry SHALL 使用 `delay = min(10000 * 2^(attempt - 1), agent.max_retry_backoff_ms)`。干净退出后的续轮 retry SHALL 使用 1000ms 短固定延迟。所有 retry(continuation 和 failure)SHALL 携带 null session ID。`onRetry` 入口 SHALL 立即释放 claim(`claimed.delete`),然后检查 eligibility。retry 处理 SHALL 重新拉取活跃候选,任务缺失或不再活跃则释放 claim 并检查是否 terminal 以清理 workspace(从 sidecar 读取 session ID),无槽位则重新入队,符合条件且有槽位则派发(传 null session ID)。

#### Scenario: 退避公式
- **WHEN** 在 attempt 3 调度一次失败驱动 retry
- **THEN** 延迟为 `min(10000 * 2^2, max_retry_backoff_ms)`,session ID 为 null

#### Scenario: 续轮 retry 不携带 session ID
- **WHEN** worker 正常退出后调度续轮 retry
- **THEN** retry 携带 null session ID,派发时传入 attempt,attempt 创建全新 session

#### Scenario: onRetry 入口释放 claim
- **WHEN** retry timer 触发
- **THEN** 立即释放 claim,然后检查 eligibility,避免 isDispatchEligible 因 stale claim 失败

#### Scenario: 任务缺失时 retry 释放并清理
- **WHEN** retry timer 触发且任务已不在活跃候选中,且为 continuation retry
- **THEN** 释放 claim,查询 tracker 确认 terminal 后从 sidecar 读取 session ID 清理 workspace + session

#### Scenario: 无槽位时 retry 重新入队
- **WHEN** retry timer 触发,任务仍活跃,但无槽位
- **THEN** 以递增 attempt 重新调度 retry,原因为 `no available orchestrator slots`
