## REMOVED Requirements

### Requirement: Worker 以 opencode run 子进程启动
**Reason**: v2 无 `--dir` 等标志且 run 会话 ask 即拒；worker 不再 spawn `opencode run`。
**Migration**: turn 提交/驱动语义由 `opencode-v2-driver` 能力承接；本 requirement 中 MCP server 通知处理的行为由下方 ADDED requirement 原样保留。

### Requirement: 终止升级与进程组击杀
**Reason**: 无子进程树，超时/中止改走 `session.interrupt` 梯子。
**Migration**: 中断语义由 `opencode-v2-driver` 的"中断梯子"承接；kill grace/进程组击杀代码随 run 路径退役。

### Requirement: rate-limit 提取
**Reason**: v2 轮询数据源（session.get/message.list）不含 rate-limit 载荷。
**Migration**: `state.rate_limits` 停止更新；若将来 v2 暴露用量限额数据再以独立变更恢复。

## MODIFIED Requirements

### Requirement: 有界续轮循环
一次 worker attempt SHALL 运行续轮循环，上限为 `agent.max_turns`。turn 1 SHALL 使用完整渲染的任务 prompt 并经 `session.create` 创建新 opencode 会话（详见 opencode-v2-driver 能力），创建所得 session ID SHALL 写入 workspace sidecar 文件。turn 2+ SHALL 对同一 session 继续 `session.prompt` 并 SHALL 仅发送续轮指引（不重发原 prompt）。每次 turn 成功后，worker SHALL 重新检查任务的 tracker 状态；若仍活跃且 turn 计数低于 `max_turns`，SHALL 启动续轮。worker 正常退出后，调度器 SHALL 调度一次短续轮 retry 以重新检查活跃度，continuation retry SHALL 续接已有 session（传入上次 worker 返回的 session ID），不创建全新 session。

#### Scenario: worker 内 turn 2+ 续接同一 session
- **WHEN** 同一 worker 内 turn 1 成功完成且任务仍活跃且低于 `max_turns`
- **THEN** 对同一 sessionID 发起 `session.prompt` 续轮，agent 保持完整对话上下文

#### Scenario: continuation retry 续接已有 session
- **WHEN** worker 正常退出后 continuation retry 触发
- **THEN** 新 worker 复用上次返回的 sessionID 续接同一 session，使用全量 prompt

#### Scenario: 最大 turn 上限封顶循环
- **WHEN** 续轮循环达到 `agent.max_turns`
- **THEN** worker 不再发起后续 turn

#### Scenario: session ID 从 turn 1 写入 sidecar
- **WHEN** turn 1 的 `session.create` 成功
- **THEN** 返回的 session ID 写入 workspace sidecar 文件

### Requirement: Attempt 生命周期与失败分类
每次 attempt SHALL 经历阶段:准备工作区、构建 prompt、驱动 turn、完成、以及 succeeded/failed/timed_out/stalled/canceled_by_reconciliation 之一。turn 墙钟超时(`opencode.turn_timeout_ms`,等待审批期间暂停)SHALL 使 attempt 失败并分类为 `turn_timeout`。不活跃超时(`opencode.inactivity_timeout_ms`,等待审批期间暂停)SHALL 使 attempt 失败并分类为 `inactivity_timeout`。turn 终态为 failed SHALL 使 attempt 失败。attempt 结果 SHALL 包含会话的 session ID(若可用)。

#### Scenario: 墙钟超时使 attempt 失败
- **WHEN** 一次 turn 的执行时长(不含审批等待)超过 `opencode.turn_timeout_ms`
- **THEN** attempt 被分类为 timed_out 并失败,错误标注为 `turn_timeout`

#### Scenario: 不活跃超时使 attempt 失败
- **WHEN** 一次 turn 在 `opencode.inactivity_timeout_ms` 时间内轮询无任何新消息(且无 pending 审批)
- **THEN** attempt 被分类为 timed_out 并失败,错误标注为 `inactivity_timeout`

#### Scenario: 会话失败终态使 attempt 失败
- **WHEN** 轮询得到 `outcome: "failed"`
- **THEN** attempt 被分类为失败

#### Scenario: 结果携带 session ID
- **WHEN** attempt 完成
- **THEN** 结果包含该会话的 session ID(若可用)

### Requirement: 聚合 token 与运行时记账
worker SHALL 从轮询数据提取 token 用量：会话终态 tokens 与消息级 `tokens`（`{input, output, reasoning, cache{read,write}}`，无 `total` 字段）。合计口径 SHALL 为 `input + output + reasoning`（cache 读写不计入用量合计）。worker SHALL 在编排器状态中累积聚合 input/output/total token 与运行时秒数（total 为上述合计口径）。用量不可用时，worker SHALL 回退到计时。若暴露，SHALL 跟踪最新见到的 rate-limit 载荷。

#### Scenario: 合计口径不含 cache
- **WHEN** 某步 tokens 为 `{input:100, output:10, reasoning:5, cache:{read:6016, write:0}}`
- **THEN** 该步用量合计为 115（100+10+reasoning 5），cache 值不计入

#### Scenario: 会话终态 tokens 入账
- **WHEN** turn 结算时 `session.get` 返回 tokens
- **THEN** 会话累计用量写入编排器状态与 sidecar

#### Scenario: 回退到计时
- **WHEN** 轮询数据不含 tokens 字段
- **THEN** 仍从驱动器计时累积运行时秒数,session ID 为已知值

### Requirement: Session 生命周期管理
worker SHALL 管理 opencode session 的完整生命周期:turn 1 经 `session.create` 创建新 session;worker 内 turn 2+ 对同一 session 继续 `session.prompt`;worker 退出后 continuation retry 续接已有 session（传入上次 worker 返回的 session ID）;session ID SHALL 写入 workspace sidecar 文件供清理使用;任务进入 terminal 状态并触发工作区清理时,SHALL 从 sidecar 文件读取 last session ID 并经 api 执行会话删除。

#### Scenario: turn 1 创建 session 并写入 sidecar
- **WHEN** attempt 的首次 `session.create` 成功
- **THEN** session ID 写入 `.tasking-session.json`

#### Scenario: worker 内 session 续接保持上下文
- **WHEN** turn 2+ 对同一 session 继续 prompt
- **THEN** agent 拥有前序 turn 的完整对话上下文

#### Scenario: 任务 terminal 时从 sidecar 读取并清理 session
- **WHEN** 任务进入 terminal 状态触发工作区清理
- **THEN** 从 `.tasking-session.json` 读取 last session ID,经 api 删除该会话,再删除工作区

#### Scenario: session 清理失败不阻塞
- **WHEN** 会话删除调用失败或 sidecar 文件缺失
- **THEN** 记录警告并继续工作区删除

### Requirement: 不活跃超时
worker SHALL 对 turn 实施不活跃超时监控：当 `opencode.inactivity_timeout_ms` > 0 时，SHALL 以轮询周期间的消息 diff 时间戳作为活跃信号，超时触发时走中断梯子（见 opencode-v2-driver）并标记为超时。存在 pending 审批单期间 SHALL 暂停不活跃计时（由审批预算接管）。当 `opencode.inactivity_timeout_ms` = 0 时 SHALL 禁用不活跃超时监控。

#### Scenario: 持续产出时不触发不活跃超时
- **WHEN** `opencode.inactivity_timeout_ms` 为 600000 且轮询持续发现新消息
- **THEN** 不活跃计时被持续重置,不触发超时

#### Scenario: 静默后触发不活跃超时
- **WHEN** `opencode.inactivity_timeout_ms` 为 600000 且超过 10 分钟轮询无新消息(无 pending 审批)
- **THEN** 走中断梯子,attempt 错误分类为 `inactivity_timeout`

#### Scenario: 等待审批期间暂停
- **WHEN** 存在 pending 审批单且超过不活跃阈值
- **THEN** 不活跃计时暂停,不误判超时

#### Scenario: 禁用不活跃超时
- **WHEN** `opencode.inactivity_timeout_ms` 为 0
- **THEN** 不启动不活跃计时,仅依赖墙钟超时和 stall 检测

### Requirement: 每 turn 解析 per-task agent
worker 的 turn 循环 SHALL 在每个 turn 前，调用共享纯函数 `resolveAgent(currentTask, config)` 解析该 turn 的 agent。turn 1 SHALL 将解析结果注入 `session.create` 的 agent 参数；turn 2+ 若解析结果与会话当前 agent 不同，SHALL 经会话切换接口在 turn 边界切换。`currentTask` SHALL 为该 turn 最新可见的 Task（turn 1 为派发时的 task，turn 2+ 为 `trackerStateChecker` 刷新后的 Task）。因此运行中切换 agent（由 `/agent <name>` 改 label 触发）SHALL 在下一 turn 边界生效——当前正在运行的 turn 不被中断。解析产出未知 agent 警告时 SHALL 记录日志但不 SHALL 中止 turn 或 attempt。

#### Scenario: turn 1 用任务 agent 标签
- **WHEN** 派发一个含 `agent:review` 标签的任务且 `opencode.agents` 含 `review`
- **THEN** turn 1 的 `session.create` 携带 agent=review

#### Scenario: 运行中切换下一 turn 生效
- **WHEN** 任务 turn 1 用 `agent:build` 运行中，期间 `/agent review` 改了 issue 标签，turn 1 完成后 `trackerStateChecker` 刷新到含 `agent:review` 的 Task
- **THEN** turn 2 边界会话切换为 review（当前 turn 未被中断）

#### Scenario: 无标签每 turn 用默认
- **WHEN** 任务无 `agent:` 标签
- **THEN** 每个 turn 的 agent 为 `opencode.agent`（与原行为一致）

#### Scenario: 未知 agent 不中止 turn
- **WHEN** 任务标签含 `agent:foo` 且 `opencode.agents` 非空不含 `foo`
- **THEN** 记录未知 agent 警告，该 turn 仍以默认 agent 启动，attempt 不失败

### Requirement: 可选 model 与 variant 标志

worker SHALL 在创建会话时，仅当 `opencode.model` 非空时将 model 拆为 `Model.Ref` 的 `{id, providerID}`（`provider/model` 按 `/` 拆分），仅当 `opencode.variant` 非空时附 `variant` 字段。两个配置 SHALL 彼此独立，可只配其一或都不配。两者皆未配置时 `Model.Ref` SHALL 省略 model 字段（用服务端默认）。

#### Scenario: 未配置 model 与 variant 时用服务端默认
- **WHEN** `opencode.model` 与 `opencode.variant` 均为 `null`（或空串）
- **THEN** `session.create` 不携带 model，由服务端默认模型执行

#### Scenario: 仅配置 model
- **WHEN** `opencode.model` 为 `anthropic/claude-sonnet-4-5` 且 `opencode.variant` 未配置
- **THEN** model ref 为 `{id:"claude-sonnet-4-5", providerID:"anthropic"}`，无 variant 字段

#### Scenario: 同时配置 model 与 variant
- **WHEN** `opencode.model` 为 `anthropic/claude-sonnet-4-5` 且 `opencode.variant` 为 `high`
- **THEN** model ref 为 `{id:"claude-sonnet-4-5", providerID:"anthropic", variant:"high"}`

### Requirement: opencode 活动事件捕获与上报

`runAttempt` SHALL 逐 turn 驱动会话（经 opencode-v2-driver），并把轮询 message diff 产生的活动事件带上 `turn` 编号经 `RunAttemptOptions.onActivity` 上报。`runAttempt` SHALL 在 `turn_started` WorkerEvent 中携带该 turn 解析出的 `agent`（`resolveAgent` 结果）、`model`（`config.opencode.model`）、`variant`（`config.opencode.variant`）。

#### Scenario: onActivity 收到带 turn 的事件

- **WHEN** `runAttempt` 在 turn 3 运行且轮询 diff 发现一条 assistant 文本消息
- **THEN** `onActivity` 收到 `{ ts, turn:3, type:"text", text }`（或对应结构）

#### Scenario: turn_started 携带 agent/model/variant

- **WHEN** turn 解析得 agent=`build`、model=`anthropic/claude-sonnet-4-5`、variant=`high`
- **THEN** `turn_started` WorkerEvent 含 `agent`、`model`、`variant` 三字段

#### Scenario: 未配置 model 时 variant 仍上报

- **WHEN** `config.opencode.model` 为空、variant=`high`
- **THEN** `turn_started` 的 `model` 为 `null`、`variant` 为 `"high"`、`agent` 为解析值

## ADDED Requirements

### Requirement: MCP server 通知与工具调用处理
MCP server（`jira-server.ts`）SHALL 正确处理 MCP 通知消息：对无 `id` 字段的 JSON-RPC 消息（通知）SHALL NOT 返回任何响应；SHALL 处理 `notifications/initialized`（静默确认）和 `ping`（返回空 result）；主循环 SHALL 对未知消息静默忽略而非返回错误或崩溃；握手完成后 SHALL 正常执行 `tools/call`。

#### Scenario: MCP 通知不返回响应
- **WHEN** MCP 客户端发送 `notifications/initialized`（无 id 字段）
- **THEN** server 不向 stdout 写入任何响应

#### Scenario: MCP ping 返回响应
- **WHEN** MCP 客户端发送 `ping` 请求（有 id 字段）
- **THEN** server 返回 `{ jsonrpc: "2.0", id: <id>, result: {} }`

#### Scenario: MCP 未知通知静默忽略
- **WHEN** MCP 客户端发送未知方法的通知（无 id 字段）
- **THEN** server 不向 stdout 写入任何响应，不崩溃

#### Scenario: MCP 工具调用正常
- **WHEN** 握手完成后 MCP 客户端发送 `tools/call` 请求
- **THEN** server 正常执行 `jira_rest` 或 `jira_upload_attachment` 并返回结果
