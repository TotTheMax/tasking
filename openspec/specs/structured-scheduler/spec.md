## Purpose

结构化任务调度器：派发、reconcile、retry、并发控制。
## Requirements
### Requirement: 单一权威状态的轮询 tick
结构化调度器 SHALL 拥有单一内存 `OrchestratorRuntimeState`(running、claimed、retry_attempts、completed、聚合总量),并 SHALL 通过单一权威变更它。每个 tick SHALL:reconcile 运行中任务、运行派发预校验、拉取候选任务、按派发优先级排序、在有槽位时派发。reconcile SHALL 在每个 tick 的派发之前运行。

#### Scenario: tick 顺序
- **WHEN** 一个 tick 触发
- **THEN** 先 reconcile,再校验,再拉取候选,再派发

#### Scenario: 校验失败跳过派发但保留 reconcile
- **WHEN** 每 tick 校验失败
- **THEN** 跳过该 tick 的派发,reconcile 仍运行

#### Scenario: 轮询间隔动态生效
- **WHEN** 通过重载变更 `polling.interval_ms`
- **THEN** 后续 tick 按新间隔调度

### Requirement: 任务编排状态机
调度器 SHALL 将每个任务的内部 claim 状态跟踪为以下之一:`Unclaimed`、`Claimed`、`Running`、`RetryQueued`、`Released`。任务 SHALL 仅当不在 `running` 且不在 `claimed` 时才被派发。worker 正常退出后,调度器 SHALL 调度一次短续轮 retry(attempt 1),且 SHALL 传播 worker 返回的 session ID（continuation retry 续接已有 session）。异常退出后 SHALL 调度一次指数退避 retry,且 SHALL 传 null session ID。`RunningEntry.session_id` SHALL 在 worker 运行期间从 `AttemptResult` 实时更新(供仪表板展示)。

#### Scenario: 正常退出调度续轮 retry 传播 session ID
- **WHEN** worker 正常退出并返回 session ID
- **THEN** 调度一次续轮 retry(attempt 1,短固定延迟),传播 session ID（续接已有 session），并从 `running` 移除该任务

#### Scenario: 异常退出调度退避 retry 不传 session ID
- **WHEN** worker 异常退出
- **THEN** 调度一次指数退避 retry,attempt 递增,传 null session ID(全新 session)

#### Scenario: 无重复派发
- **WHEN** 任务已在 `running` 或 `claimed`
- **THEN** 不再次派发

### Requirement: 候选选择与派发排序
任务 SHALL 仅当具备 id、identifier、title、state;状态在 `active_states` 且不在 `terminal_states`;匹配配置的 assignee 且含全部 `required_labels`;未运行、未 claim、全局与按状态并发槽位可用;且(对 `Todo` 等价状态)所有 blocker 已 terminal——才可派发。候选 SHALL 按 `priority` 升序、`created_at` 最旧优先、`identifier` 字典序排序。

#### Scenario: 优先级排序
- **WHEN** 两个可派发任务优先级为 2 和 1
- **THEN** 优先级 1 的任务先派发

#### Scenario: 必需标签门控
- **WHEN** 任务缺少配置的某个必需标签
- **THEN** 不派发

#### Scenario: Todo 状态的 blocker 门控
- **WHEN** 一个 Todo 等价任务存在非 terminal blocker
- **THEN** 不派发

### Requirement: 并发控制
调度器 SHALL 强制全局上限(`agent.max_concurrent_agents`)与可选按状态上限(`agent.max_concurrent_agents_by_state`,状态键小写化,非法项忽略)。可用全局槽位 SHALL 为 `max(max_concurrent_agents - running_count, 0)`。

#### Scenario: 全局槽位耗尽
- **WHEN** 运行数等于 `max_concurrent_agents`
- **THEN** 不派发新任务

#### Scenario: 按状态上限覆盖全局
- **WHEN** `max_concurrent_agents_by_state["in progress"]` 为 2 且已有 2 个 in-progress 任务运行
- **THEN** 即使全局有槽位也不再派发 in-progress 任务

### Requirement: retry 与指数退避
调度器在创建新 retry 前 SHALL 取消该任务已存在的 retry timer。失败驱动 retry SHALL 使用 `delay = min(10000 * 2^(attempt - 1), agent.max_retry_backoff_ms)`。干净退出后的续轮 retry SHALL 使用 1000ms 短固定延迟。continuation retry SHALL 携带 worker 返回的 session ID（续接已有 session）;failure retry 和 stalled retry SHALL 携带 null session ID。`onRetry` 入口 SHALL 立即释放 claim(`claimed.delete`),然后检查 eligibility。retry 处理 SHALL 重新拉取活跃候选,任务缺失或不再活跃则释放 claim 并检查是否 terminal 以清理 workspace(从 sidecar 读取 session ID),无槽位则重新入队,符合条件且有槽位则派发（continuation retry 传播 session ID,failure retry 传 null）。

#### Scenario: 退避公式
- **WHEN** 在 attempt 3 调度一次失败驱动 retry
- **THEN** 延迟为 `min(10000 * 2^2, max_retry_backoff_ms)`,session ID 为 null

#### Scenario: 续轮 retry 传播 session ID
- **WHEN** worker 正常退出后调度续轮 retry
- **THEN** retry 携带 worker 返回的 session ID,派发时传入 attempt,续接已有 session

#### Scenario: onRetry 入口释放 claim
- **WHEN** retry timer 触发
- **THEN** 立即释放 claim,然后检查 eligibility,避免 isDispatchEligible 因 stale claim 失败

#### Scenario: 任务缺失时 retry 释放并清理
- **WHEN** retry timer 触发且任务已不在活跃候选中,且为 continuation retry
- **THEN** 释放 claim,查询 tracker 确认 terminal 后从 sidecar 读取 session ID 清理 workspace + session

#### Scenario: 无槽位时 retry 重新入队
- **WHEN** retry timer 触发,任务仍活跃,但无槽位
- **THEN** 以递增 attempt 重新调度 retry,原因为 `no available orchestrator slots`

### Requirement: 活动运行 reconcile
调度器 SHALL 每 tick 运行 reconcile,含两部分:停滞检测(距上次活动超过 `opencode.stall_timeout_ms` 则终止并 retry;`<= 0` 时禁用),以及 tracker 状态刷新(terminal→终止并清理工作区目录、active→更新快照、其他→终止但不清理)。terminal 清理 SHALL 删除该任务实际的 per-task 工作区目录(路径解析为 `<workspace.root>/<sanitized_identifier>`,与启动 terminal 清理一致),并 SHALL 在删除前运行 `before_remove` hook。状态刷新失败 SHALL 保留 worker 运行并在下个 tick 重试。

#### Scenario: 停滞检测
- **WHEN** 某运行任务无活动时间超过 `stall_timeout_ms`
- **THEN** 终止 worker 并调度 retry

#### Scenario: terminal 状态触发工作区删除
- **WHEN** 某运行任务的 tracker 状态变为 terminal
- **THEN** 终止 worker,从磁盘删除其 per-task 工作区目录,且 `before_remove` hook 先于删除运行

#### Scenario: terminal 清理使用派发时承载的工作区路径
- **WHEN** reconcile 判定某运行任务转为 terminal
- **THEN** 使用运行态条目在派发时记录的 `workspace_path` 删除目录,而非在 reconcile 时按当前配置重新推算路径

#### Scenario: terminal 清理对缺失目录安全 no-op
- **WHEN** reconcile terminal 分支发现 `workspace_path` 指向的目录已不存在(如 `after_create` 失败回滚后)
- **THEN** 不抛错、不运行 `before_remove`,worker 仍被终止并从 running 移除

#### Scenario: 非活跃状态停止但不清理
- **WHEN** 某运行任务的 tracker 状态既非 active 也非 terminal
- **THEN** 终止 worker 但不清理工作区

#### Scenario: 状态刷新失败保留 worker
- **WHEN** 状态刷新 tracker 调用失败
- **THEN** 保留 worker 运行,reconcile 下个 tick 重试

### Requirement: 启动时 terminal 工作区清理
启动时,调度器 SHALL 查询 tracker 中处于 terminal 状态的任务并删除对应工作区目录。若 terminal 状态拉取失败,SHALL 记录警告并继续启动。

#### Scenario: terminal 清理删除工作区
- **WHEN** daemon 启动且某被跟踪任务已 terminal
- **THEN** 删除该任务的工作区目录

#### Scenario: terminal 拉取失败非致命
- **WHEN** 启动时 terminal 状态拉取失败
- **THEN** 记录警告并继续启动

### Requirement: 结构化热循环中无 LLM
结构化调度器 SHALL NOT 在 轮询/派发/reconcile/retry 路径中调用任何 LLM。route-agent/triage 能力 SHALL NOT 从结构化派发路径可达。

#### Scenario: 结构化路径确定性
- **WHEN** 结构化调度器轮询、派发、reconcile、retry
- **THEN** 这些操作不派生任何 LLM 子进程

### Requirement: 内存状态与重启恢复
调度器状态(running、claimed、retry_attempts)SHALL 仅存于内存,重启时 SHALL NOT 从持久存储恢复。恢复 SHALL 由 tracker 驱动(重新轮询活跃任务、复用已保留工作区、运行启动 terminal 清理)。retry timer SHALL NOT 跨重启存活。

#### Scenario: 重启后从 tracker 重新派发
- **WHEN** daemon 重启且先前运行的任务在 tracker 中仍活跃
- **THEN** 通过轮询重新发现这些任务并作为新 attempt 重新派发

#### Scenario: retry timer 不跨重启存活
- **WHEN** daemon 重启
- **THEN** 前一进程的 retry timer 不再活跃

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

### Requirement: turn 计数跟踪
调度器 SHALL 在 `RunningEntry` 上维护 `turn_count`(初始为 0),并在收到 worker 发出的 `turn_started` 事件时递增。`turn_count` SHALL 反映当前 worker 生命周期内已启动的 turn 数。快照 SHALL 暴露正确的 `turn_count` 值。

#### Scenario: turn 开始时递增
- **WHEN** runner 在 turn 循环内发出 `turn_started` 事件
- **THEN** scheduler 的 `onEvent` 回调递增 `entry.turn_count`

#### Scenario: 快照反映正确 turn 计数
- **WHEN** 某 worker 已启动 3 个 turn
- **THEN** 快照中该任务的 `turn_count` 为 3

#### Scenario: 新 worker 重置 turn 计数
- **WHEN** 新的 worker attempt 启动(continuation retry 或新 dispatch)
- **THEN** `turn_count` 从 0 开始

### Requirement: refresh 触发
调度器 SHALL 暴露 `requestRefresh()` 方法,设置一个内部 refresh 标志。`tick()` SHALL 在开头检查该标志,若为 true 则立即执行(不等下一个 poll interval)。多次 `requestRefresh()` 调用 SHALL 被合并(coalesced)。`requestRefresh()` 在无进行中 tick 时 SHALL 立即自驱动执行一轮 tick;`tick()` 进行中到达的 refresh SHALL 在该轮结束后立即再执行一轮。tick SHALL 具备重入保护:进行中的 tick 与新触发的 tick SHALL NOT 并发重叠(interval 定时 tick 撞上进行中的 tick 时 SHALL 跳过)。调度器 SHALL NOT 自持轮询定时器(tick 由 Daemon 驱动;refresh 自驱动的 out-of-band tick 除外)。

#### Scenario: refresh 立即触发 tick
- **WHEN** 调用 `requestRefresh()` 且当前无待处理 refresh、无进行中 tick
- **THEN** 下一个 tick 立即执行(不等 poll interval)

#### Scenario: 多次 refresh 合并
- **WHEN** 连续调用 `requestRefresh()` 两次
- **THEN** 仅触发一次额外 tick

#### Scenario: tick 进行中的 refresh 结束后补跑
- **WHEN** 一轮 tick 正在执行,期间调用 `requestRefresh()`
- **THEN** 该轮 tick 结束后立即再执行一轮(标志被消费,不丢失)

#### Scenario: 重入跳过
- **WHEN** interval 定时 tick 在一轮 out-of-band tick 进行中触发
- **THEN** 该 interval tick 被跳过,SHALL NOT 并发执行

