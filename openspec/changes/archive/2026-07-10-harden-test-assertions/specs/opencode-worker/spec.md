## MODIFIED Requirements

### Requirement: 有界续轮循环
一次 worker attempt SHALL 运行续轮循环，上限为 `agent.max_turns`。turn 1 SHALL 使用完整渲染的任务 prompt 并创建新 opencode session。`opencode run` 调用 SHALL 使用 `--format json` 输出模式。turn 1 完成后，worker SHALL 从 JSON 事件流中提取 session ID 并写入 workspace sidecar 文件。turn 2+ SHALL 使用 `-s <sessionID>` 续接同一 session（同一 worker 内），并 SHALL 仅发送续轮指引（不重发原 prompt）。每次 `opencode run` 调用成功后，worker SHALL 重新检查任务的 tracker 状态；若仍活跃且 turn 计数低于 `max_turns`，SHALL 启动续轮调用。worker 正常退出后，调度器 SHALL 调度一次短续轮 retry 以重新检查活跃度，continuation retry SHALL 续接已有 session（传入上次 worker 返回的 session ID），不创建全新 session。

#### Scenario: worker 内 turn 2+ 续接同一 session
- **WHEN** 同一 worker 内 turn 1 成功完成且任务仍活跃且低于 `max_turns`
- **THEN** 使用 `-s <sessionID>` 启动续轮调用，agent 保持完整对话上下文

#### Scenario: continuation retry 续接已有 session
- **WHEN** worker 正常退出后 continuation retry 触发
- **THEN** 新 worker 的 turn 1 传入 `-s <sessionID>`（上次 worker 返回的值），续接同一 session，使用全量 prompt

#### Scenario: 最大 turn 上限封顶循环
- **WHEN** 续轮循环达到 `agent.max_turns`
- **THEN** worker 不再启动后续调用

#### Scenario: session ID 从 turn 1 提取并写入 sidecar
- **WHEN** turn 1 的 `opencode run --format json` 产出 JSON 事件流
- **THEN** worker 从事件中提取 session ID 并写入 workspace sidecar 文件

### Requirement: 聚合 token 与运行时记账
worker SHALL 从 `opencode run --format json` 输出的 JSON 事件流中提取 token 用量，SHALL 遍历所有 `step_finish` 类型事件并取最后一个 `step_finish` 的 `part.tokens` 中的 `input`、`output`、`total` 字段作为该次 `opencode run` 调用的累积 token 用量（因为 opencode 的 `step_finish` 报告的是 session 级累积值，不是单步增量），并 SHALL 在编排器状态中累积聚合 input/output/total token 与运行时秒数。worker SHALL 同时从 JSON 事件流中提取 session ID（取第一个包含 `sessionID` 字段的事件的值）。用量不可用时，worker SHALL 回退到进程级计时。若暴露，SHALL 跟踪最新见到的 rate-limit 载荷。

#### Scenario: 从最后一个 step_finish 取累积 token
- **WHEN** `opencode run --format json` 发出多个 `step_finish` 事件，token 递增（如 100→150→200）
- **THEN** 取最后一个 `step_finish` 的值（200），不累加所有 step（非 450）

#### Scenario: 单个 step_finish
- **WHEN** `opencode run --format json` 只发出一个 `step_finish` 事件
- **THEN** 取该事件的 token 值

#### Scenario: 提取 session ID
- **WHEN** JSON 事件流包含 `sessionID` 字段
- **THEN** 提取该值作为当前 session 的 ID

#### Scenario: 回退到计时
- **WHEN** 未发出 JSON 事件或解析失败
- **THEN** 仍从进程计时累积运行时秒数，session ID 为 null

### Requirement: Session 生命周期管理
worker SHALL 管理 opencode session 的完整生命周期:turn 1 创建新 session 并从 JSON 事件流提取 session ID;worker 内 turn 2+ 通过 `-s <sessionID>` 续接同一 session;worker 退出后 continuation retry 续接已有 session（传入上次 worker 返回的 session ID）;session ID SHALL 写入 workspace sidecar 文件供清理使用;任务进入 terminal 状态并触发工作区清理时,SHALL 从 sidecar 文件读取 last session ID 并执行 `opencode session delete`。

#### Scenario: turn 1 创建 session 并写入 sidecar
- **WHEN** attempt 的首次 `opencode run --format json` 完成
- **THEN** 从 JSON 事件流提取 session ID 并写入 `.tasking-session.json`

#### Scenario: worker 内 session 续接保持上下文
- **WHEN** turn 2+ 使用 `-s <sessionID>` 续接
- **THEN** agent 拥有前序 turn 的完整对话上下文

#### Scenario: continuation retry 续接已有 session
- **WHEN** worker 退出后 continuation retry 启动新 worker
- **THEN** 新 worker 传入 `-s <sessionID>`（上次 worker 返回的值），续接同一 session，agent 保持完整对话上下文

#### Scenario: 任务 terminal 时从 sidecar 读取并清理 session
- **WHEN** 任务进入 terminal 状态触发工作区清理
- **THEN** 从 `.tasking-session.json` 读取 last session ID,执行 `opencode session delete`,再删除工作区

#### Scenario: session 清理失败不阻塞
- **WHEN** `opencode session delete` 失败或 sidecar 文件缺失
- **THEN** 记录警告并继续工作区删除
