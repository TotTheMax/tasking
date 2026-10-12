## ADDED Requirements

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
调度器 SHALL 将每个任务的内部 claim 状态跟踪为以下之一:`Unclaimed`、`Claimed`、`Running`、`RetryQueued`、`Released`。任务 SHALL 仅当不在 `running` 且不在 `claimed` 时才被派发。worker 正常退出后,调度器 SHALL 调度一次短续轮 retry(attempt 1)。异常退出后 SHALL 调度一次指数退避 retry。

#### Scenario: 正常退出调度续轮 retry
- **WHEN** worker 正常退出
- **THEN** 调度一次续轮 retry(attempt 1,短固定延迟),并从 `running` 移除该任务

#### Scenario: 异常退出调度退避 retry
- **WHEN** worker 异常退出
- **THEN** 调度一次指数退避 retry,attempt 递增

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
调度器在创建新 retry 前 SHALL 取消该任务已存在的 retry timer。失败驱动 retry SHALL 使用 `delay = min(10000 * 2^(attempt - 1), agent.max_retry_backoff_ms)`。干净退出后的续轮 retry SHALL 使用 1000ms 短固定延迟。retry 处理 SHALL 重新拉取活跃候选,任务缺失或不再活跃则释放 claim,无槽位则重新入队,符合条件且有槽位则派发。

#### Scenario: 退避公式
- **WHEN** 在 attempt 3 调度一次失败驱动 retry
- **THEN** 延迟为 `min(10000 * 2^2, max_retry_backoff_ms)`

#### Scenario: 任务缺失时 retry 释放
- **WHEN** retry timer 触发且任务已不在活跃候选中
- **THEN** 释放 claim

#### Scenario: 无槽位时 retry 重新入队
- **WHEN** retry timer 触发,任务仍活跃,但无槽位
- **THEN** 以递增 attempt 重新调度 retry,原因为 `no available orchestrator slots`

### Requirement: 活动运行 reconcile
调度器 SHALL 每 tick 运行 reconcile,含两部分:停滞检测(距上次活动超过 `opencode.stall_timeout_ms` 则终止并 retry;`<= 0` 时禁用),以及 tracker 状态刷新(terminal→终止并清理,active→更新快照,其他→终止不清理)。状态刷新失败 SHALL 保留 worker 运行并在下个 tick 重试。

#### Scenario: 停滞检测
- **WHEN** 某运行任务无活动时间超过 `stall_timeout_ms`
- **THEN** 终止 worker 并调度 retry

#### Scenario: terminal 状态触发清理
- **WHEN** 某运行任务的 tracker 状态变为 terminal
- **THEN** 终止 worker 并清理其工作区

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
