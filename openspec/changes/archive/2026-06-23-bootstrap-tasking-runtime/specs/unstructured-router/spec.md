## ADDED Requirements

### Requirement: Route agent 分诊非结构化 inbox 条目
非结构化 router SHALL 运行一个 route agent(一个使用 triage agent profile 的 `opencode run` 子进程),消费未分诊 inbox 条目,将每个分类为决策,把可执行项归一化为共享 `Task` 模型,并通过 `inbox.mark_decision` 工具记录决策。每次 route-agent 运行 SHALL 受 `router.batch_size` 条目与 `router.timeout_ms` 约束。

#### Scenario: 未分诊条目变为 Task
- **WHEN** route-agent 运行发现一个描述可执行工作的未分诊 inbox 条目
- **THEN** 该条目状态变为 `decided`,决策含归一化 `Task` 与派发意图

#### Scenario: 未分诊条目被拒绝
- **WHEN** route-agent 运行发现一个不可执行的未分诊条目
- **THEN** 该条目状态变为 `rejected`,记录原因

#### Scenario: 批量有界
- **WHEN** 未分诊条目数超过 `router.batch_size`
- **THEN** 单次 route-agent 运行最多处理 `router.batch_size` 条

#### Scenario: Route agent 超时
- **WHEN** route-agent 运行超过 `router.timeout_ms`
- **THEN** 终止运行,未处理条目保持 `untriaged` 待下次运行

### Requirement: Route agent 以 opencode plugin 暴露 inbox 工具
router SHALL 将 route-agent 工具 `inbox.pop_untriaged`、`inbox.mark_decision`、`feishu.reply` 作为 opencode plugin 暴露。`inbox.pop_untriaged` SHALL 按 FIFO 顺序返回未分诊条目。`inbox.mark_decision` SHALL 记录决策并推进条目状态。`feishu.reply` SHALL 向源飞书会话发送回复。

#### Scenario: pop_untriaged 返回条目
- **WHEN** route agent 调用 `inbox.pop_untriaged` 且存在未分诊条目
- **THEN** 按 received_at 顺序返回最多 `router.batch_size` 条

#### Scenario: mark_decision 推进状态
- **WHEN** route agent 调用 `inbox.mark_decision` 带条目 id 与决策
- **THEN** 条目状态变为 `decided`,决策被持久化

#### Scenario: feishu.reply 发送消息
- **WHEN** route agent 调用 `feishu.reply` 带会话 id 与文本
- **THEN** 向该飞书会话发送一条回复

### Requirement: Route agent 按 tick 有界且可触发
router SHALL 每 tick(或由 `tasking triage`/外部 cron 触发时)运行 route-agent 调用,SHALL 有界约束为同一时刻最多一个 route-agent 子进程运行,除非另行配置。结构化派发路径 SHALL NOT 被 route-agent 执行阻塞。

#### Scenario: 触发即运行分诊
- **WHEN** 调用 `tasking triage`
- **THEN** 排队/执行一次 route-agent 运行

#### Scenario: 不阻塞结构化路径
- **WHEN** route-agent 运行进行中
- **THEN** 结构化调度器继续独立轮询与派发

### Requirement: 决策任务经共享 worker 路径派发
当 route-agent 决策产出带派发意图的 `Task` 时,router SHALL 将该 `Task` 交给结构化调度器所用的同一 worker/派发路径(受全局与按状态并发约束),并 SHALL 将 inbox 条目标记为 `dispatched`,记录所得 `task_id`。

#### Scenario: 决策任务被派发
- **WHEN** route-agent 决策产出可派发 `Task`
- **THEN** 该任务交给共享 worker 路径,inbox 条目标记为 `dispatched`

#### Scenario: 派发受并发约束
- **WHEN** 决策任务交给派发但全局槽位已耗尽
- **THEN** 与结构化任务一样等待/retry,而非绕过并发

### Requirement: Inbox 幂等与持久
router SHALL 将 inbox 条目持久化到持久存储(SQLite),以源消息 id 为键带 UNIQUE 约束,使同一源消息的重复接入为无操作。未分诊条目 SHALL 在 route-agent 与 daemon 重启后均存活。

#### Scenario: 重复接入幂等
- **WHEN** 同一条飞书消息被接入两次
- **THEN** 仅存在一个 inbox 条目,不发生重复分诊

#### Scenario: Inbox 跨重启存活
- **WHEN** daemon 重启且 inbox 有未分诊条目
- **THEN** 这些条目仍可供下次 route-agent 运行使用
