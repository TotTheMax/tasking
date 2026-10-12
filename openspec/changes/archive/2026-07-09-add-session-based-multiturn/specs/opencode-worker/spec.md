## MODIFIED Requirements

### Requirement: Worker 以 opencode run 子进程启动
worker 层 SHALL 将每次任务 attempt 作为 `opencode run` 子进程启动,带 `--dir <workspace>`(以 per-task 工作区为 cwd)、`--format json`(结构化事件流输出)、`--agent <build>`(配置的 agent profile)、以及渲染后的 prompt 作为末尾参数。当 worker 接收到已有 session ID 时,SHALL 额外传入 `-s <sessionID>` 以续接同一 session。所启动进程的 cwd SHALL 为 per-task 工作区路径。opencode 调用命令 SHALL 可通过 `opencode.command` 配置(默认 `opencode run`)。

#### Scenario: Worker cwd 为工作区
- **WHEN** 为某任务启动 worker
- **THEN** `opencode run` 进程 cwd 等于 per-task 工作区路径

#### Scenario: 可配置命令
- **WHEN** `opencode.command` 设为自定义前缀
- **THEN** 使用该前缀启动 worker 子进程

#### Scenario: JSON 格式输出
- **WHEN** worker 启动 `opencode run`
- **THEN** 命令参数含 `--format json`

#### Scenario: 续接已有 session
- **WHEN** worker 接收到非空 session ID(如 continuation retry)
- **THEN** 命令参数含 `-s <sessionID>`

#### Scenario: 全新 session
- **WHEN** worker 未接收到 session ID(首次 attempt 或失败 retry)
- **THEN** 命令参数不含 `-s`,opencode 创建新 session

### Requirement: 有界续轮循环
一次 worker attempt SHALL 运行续轮循环,上限为 `agent.max_turns`。首次调用 SHALL 使用完整渲染的任务 prompt。`opencode run` 调用 SHALL 使用 `--format json` 输出模式。turn 1 完成后,worker SHALL 从 JSON 事件流中提取 session ID。turn 2+ SHALL 使用 `-s <sessionID>` 续接同一 session,使 agent 跨 turn 保持完整对话上下文,并 SHALL 仅发送简短续轮指引(不重发原 prompt)。每次 `opencode run` 调用成功后,worker SHALL 重新检查任务的 tracker 状态;若仍活跃且 turn 计数低于 `max_turns`,SHALL 启动续轮调用。worker 正常退出后,调度器 SHALL 调度一次短续轮 retry 以重新检查活跃度,并 SHALL 传入 session ID 供续轮 retry 续接。

#### Scenario: 活跃时 session 续轮
- **WHEN** 一次 `opencode run` 调用成功完成且任务仍活跃且低于 `max_turns`
- **THEN** 使用 `-s <sessionID>` 启动续轮调用,agent 保持完整对话上下文

#### Scenario: 最大 turn 上限封顶循环
- **WHEN** 续轮循环达到 `agent.max_turns`
- **THEN** worker 不再启动后续调用

#### Scenario: session ID 从 turn 1 提取
- **WHEN** turn 1 的 `opencode run --format json` 产出 JSON 事件流
- **THEN** worker 从事件中提取 session ID 用于后续 turn

### Requirement: Attempt 生命周期与失败分类
每次 attempt SHALL 经历阶段:准备工作区、构建 prompt、启动 agent、完成、以及 succeeded/failed/timed_out/stalled/canceled_by_reconciliation 之一。turn 超时(`opencode.turn_timeout_ms`)SHALL 使 attempt 失败。子进程异常退出 SHALL 使 attempt 失败。调度器 SHALL 将 worker 结果转换为显式状态转换。attempt 结果 SHALL 包含从 JSON 事件流提取的 session ID(若可用)。

#### Scenario: turn 超时使 attempt 失败
- **WHEN** 一次 `opencode run` 调用超过 `opencode.turn_timeout_ms`
- **THEN** attempt 被分类为 timed_out 并失败

#### Scenario: 异常退出使 attempt 失败
- **WHEN** `opencode run` 子进程异常退出
- **THEN** attempt 被分类为失败

#### Scenario: 结果携带 session ID
- **WHEN** attempt 完成
- **THEN** 结果包含从 JSON 事件流提取的 session ID(若可用)

### Requirement: 聚合 token 与运行时记账
worker SHALL 从 `opencode run --format json` 输出的 JSON 事件流中提取 token 用量,SHALL 遍历所有 `step_finish` 类型事件并累加 `part.tokens` 中的 `input`、`output`、`total` 字段,并 SHALL 在编排器状态中累积聚合 input/output/total token 与运行时秒数。worker SHALL 同时从 JSON 事件流中提取 session ID(取第一个包含 `sessionID` 字段的事件的值)。用量不可用时,worker SHALL 回退到进程级计时。若暴露,SHALL 跟踪最新见到的 rate-limit 负载。

#### Scenario: 从 step_finish 累加 token
- **WHEN** `opencode run --format json` 发出多个 `step_finish` 事件
- **THEN** 聚合 token 总量递增所有 step 的 token 之和

#### Scenario: 提取 session ID
- **WHEN** JSON 事件流包含 `sessionID` 字段
- **THEN** 提取该值作为当前 session 的 ID

#### Scenario: 回退到计时
- **WHEN** 未发出 JSON 事件或解析失败
- **THEN** 仍从进程计时累积运行时秒数,session ID 为 null

## ADDED Requirements

### Requirement: Session 生命周期管理
worker SHALL 管理 opencode session 的完整生命周期:turn 1 创建新 session 并从 JSON 事件流提取 session ID;turn 2+ 通过 `-s <sessionID>` 续接同一 session;attempt 结果 SHALL 返回 session ID 供调度器决策;任务进入 terminal 状态并触发工作区清理时,SHALL 执行 `opencode session delete <sessionID>` 清理 session。

#### Scenario: turn 1 创建 session
- **WHEN** attempt 的首次 `opencode run --format json` 完成
- **THEN** 从 JSON 事件流提取 session ID

#### Scenario: session 续接保持上下文
- **WHEN** turn 2+ 使用 `-s <sessionID>` 续接
- **THEN** agent 拥有前序 turn 的完整对话上下文

#### Scenario: 任务 terminal 时清理 session
- **WHEN** 任务进入 terminal 状态触发工作区清理
- **THEN** 先执行 `opencode session delete <sessionID>` 再删除工作区

#### Scenario: session 清理失败不阻塞
- **WHEN** `opencode session delete` 失败
- **THEN** 记录警告并继续工作区删除
