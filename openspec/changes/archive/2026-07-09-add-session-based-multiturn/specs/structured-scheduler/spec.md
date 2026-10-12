## MODIFIED Requirements

### Requirement: 任务编排状态机
调度器 SHALL 将每个任务的内部 claim 状态跟踪为以下之一:`Unclaimed`、`Claimed`、`Running`、`RetryQueued`、`Released`。任务 SHALL 仅当不在 `running` 且不在 `claimed` 时才被派发。worker 正常退出后,调度器 SHALL 调度一次短续轮 retry(attempt 1),并 SHALL 传入 worker 返回的 session ID 以供续轮 retry 续接同一 session。异常退出后 SHALL 调度一次指数退避 retry,且 SHALL 传 null session ID(全新 session)。`RunningEntry.session_id` SHALL 在 worker 运行期间从 `AttemptResult` 实时更新。

#### Scenario: 正常退出调度续轮 retry 并传 session ID
- **WHEN** worker 正常退出且返回非空 session ID
- **THEN** 调度一次续轮 retry(attempt 1,短固定延迟),传入 session ID,并从 `running` 移除该任务

#### Scenario: 异常退出调度退避 retry 不传 session ID
- **WHEN** worker 异常退出
- **THEN** 调度一次指数退避 retry,attempt 递增,传 null session ID(全新 session)

#### Scenario: 无重复派发
- **WHEN** 任务已在 `running` 或 `claimed`
- **THEN** 不再次派发

### Requirement: retry 与指数退避
调度器在创建新 retry 前 SHALL 取消该任务已存在的 retry timer。失败驱动 retry SHALL 使用 `delay = min(10000 * 2^(attempt - 1), agent.max_retry_backoff_ms)`,且 SHALL 携带 null session ID。干净退出后的续轮 retry SHALL 使用 1000ms 短固定延迟,且 SHALL 携带 worker 返回的 session ID。retry 处理 SHALL 重新拉取活跃候选,任务缺失或不再活跃则释放 claim,无槽位则重新入队,符合条件且有槽位则派发。派发时 SHALL 将 retry 携带的 session ID 传入 `RunAttemptOptions`,使 attempt 的首次 turn 可通过 `-s <sessionID>` 续接。

#### Scenario: 退避公式
- **WHEN** 在 attempt 3 调度一次失败驱动 retry
- **THEN** 延迟为 `min(10000 * 2^2, max_retry_backoff_ms)`,session ID 为 null

#### Scenario: 续轮 retry 携带 session ID
- **WHEN** worker 正常退出后调度续轮 retry
- **THEN** retry 携带 worker 返回的 session ID,派发时传入 attempt

#### Scenario: 任务缺失时 retry 释放
- **WHEN** retry timer 触发且任务已不在活跃候选中
- **THEN** 释放 claim

#### Scenario: 无槽位时 retry 重新入队
- **WHEN** retry timer 触发,任务仍活跃,但无槽位
- **THEN** 以递增 attempt 重新调度 retry,原因为 `no available orchestrator slots`

## ADDED Requirements

### Requirement: Session ID 在调度器中传播
调度器 SHALL 在 `AttemptResult` 中接收 session ID,并 SHALL 根据退出状态决定是否传播:正常退出(continuation)时传播 session ID 至 `RetryEntry`;异常退出(failure)或停滞超时(stalled)时传播 null。`dispatch` 方法 SHALL 将 session ID 写入 `RunningEntry.session_id`。`onRetry` SHALL 将 retry 携带的 session ID 传递至 `dispatch` 再至 `runAttempt`。

#### Scenario: AttemptResult 携带 session ID
- **WHEN** worker attempt 完成
- **THEN** 结果包含 session ID(从 JSON 事件流提取或 null)

#### Scenario: continuation 传播 session ID
- **WHEN** 正常退出调度续轮 retry
- **THEN** RetryEntry 的 session ID 为 worker 返回的值

#### Scenario: failure 不传播 session ID
- **WHEN** 异常退出调度退避 retry
- **THEN** RetryEntry 的 session ID 为 null

#### Scenario: 停滞终止不传播 session ID
- **WHEN** 停滞超时终止 worker 并调度 retry
- **THEN** RetryEntry 的 session ID 为 null
