## ADDED Requirements

### Requirement: Worker 以 opencode run 子进程启动
worker 层 SHALL 将每次任务 attempt 作为 `opencode run` 子进程启动,带 `--dir <workspace>`(以 per-task 工作区为 cwd)、`--agent <build>`(配置的 agent profile)、以及渲染后的 prompt 作为末尾参数。所启动进程的 cwd SHALL 为 per-task 工作区路径。opencode 调用命令 SHALL 可通过 `opencode.command` 配置(默认 `opencode run`)。

#### Scenario: Worker cwd 为工作区
- **WHEN** 为某任务启动 worker
- **THEN** `opencode run` 进程 cwd 等于 per-task 工作区路径

#### Scenario: 可配置命令
- **WHEN** `opencode.command` 设为自定义前缀
- **THEN** 使用该前缀启动 worker 子进程

### Requirement: 严格变量的 prompt 渲染
worker SHALL 使用严格模板引擎渲染 `WORKFLOW.md` prompt 模板,以 `task`(或 `issue`)与 `attempt` 为输入变量。未知变量 SHALL 导致渲染失败。未知 filter SHALL 导致渲染失败。渲染失败 SHALL 导致当前 attempt 失败。

#### Scenario: 渲染 task 与 attempt
- **WHEN** 渲染首次 attempt
- **THEN** 模板收到 task 对象且 `attempt` 为 null/缺失

#### Scenario: 未知变量失败
- **WHEN** 模板引用未定义变量
- **THEN** 渲染失败,attempt 失败

### Requirement: 有界续轮循环
一次 worker attempt SHALL 运行续轮循环,上限为 `agent.max_turns`。首次调用 SHALL 使用完整渲染的任务 prompt。`opencode run` 调用成功后,worker SHALL 重新检查任务的 tracker 状态;若仍活跃且 turn 计数低于 `max_turns`,SHALL 启动一次携带续轮指引的续轮调用(不重发原 prompt)。worker 正常退出后,调度器 SHALL 调度一次短续轮 retry 以重新检查活跃度。

#### Scenario: 活跃时续轮
- **WHEN** 一次 `opencode run` 调用成功完成且任务仍活跃且低于 `max_turns`
- **THEN** 启动一次携带续轮指引的续轮调用

#### Scenario: 最大 turn 上限封顶循环
- **WHEN** 续轮循环达到 `agent.max_turns`
- **THEN** worker 不再启动后续调用

### Requirement: Attempt 生命周期与失败分类
每次 attempt SHALL 经历阶段:准备工作区、构建 prompt、启动 agent、完成、以及 succeeded/failed/timed_out/stalled/canceled_by_reconciliation 之一。turn 超时(`opencode.turn_timeout_ms`)SHALL 使 attempt 失败。子进程异常退出 SHALL 使 attempt 失败。调度器 SHALL 将 worker 结果转换为显式状态转换。

#### Scenario: turn 超时使 attempt 失败
- **WHEN** 一次 `opencode run` 调用超过 `opencode.turn_timeout_ms`
- **THEN** attempt 被分类为 timed_out 并失败

#### Scenario: 异常退出使 attempt 失败
- **WHEN** `opencode run` 子进程异常退出
- **THEN** attempt 被分类为失败

### Requirement: Attempt 前后运行 hook
worker SHALL 在每次 attempt 前运行 `hooks.before_run`(失败/超时中止 attempt),在每次 attempt 后运行 `hooks.after_run`(失败/超时记录并忽略),`hooks.timeout_ms` SHALL 适用于每个 hook 执行。

#### Scenario: before_run 失败中止 attempt
- **WHEN** `before_run` 以非零退出
- **THEN** 中止当前 attempt

#### Scenario: after_run 失败被忽略
- **WHEN** attempt 后 `after_run` 以非零退出
- **THEN** 记录失败,attempt 结果不变

### Requirement: 聚合 token 与运行时记账
worker SHALL 在 `opencode run` 输出可用时从中提取 token 用量,并 SHALL 在编排器状态中累积聚合 input/output/total token 与运行时秒数。用量不可用时,worker SHALL 回退到进程级计时。若暴露,SHALL 跟踪最新见到的 rate-limit 负载。

#### Scenario: 用量可用时提取
- **WHEN** `opencode run` 发出结构化用量
- **THEN** 聚合 token 总量递增

#### Scenario: 回退到计时
- **WHEN** 未发出用量
- **THEN** 仍从进程计时累积运行时秒数

### Requirement: Agent runner 契约
agent runner 每次 attempt SHALL:创建/复用工作区、构建 prompt、启动 `opencode run` 会话、向编排器转发 worker 事件,并在出错时使 attempt 失败以便编排器 retry。成功后 SHALL 保留工作区。

#### Scenario: 出错使 attempt 失败
- **WHEN** agent runner 在 attempt 中遇错
- **THEN** attempt 失败,由编排器决定 retry 行为

#### Scenario: 成功后保留工作区
- **WHEN** attempt 成功
- **THEN** 不删除工作区目录
