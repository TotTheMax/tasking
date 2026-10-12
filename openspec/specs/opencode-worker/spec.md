## Purpose

opencode run 工作进程：turn 循环、session 续轮、token 统计。
## Requirements
### Requirement: Worker 以 opencode run 子进程启动
worker 层 SHALL 将每次任务 attempt 作为 `opencode run` 子进程启动。MCP server（`jira-server.ts`）SHALL 正确处理 MCP 通知消息：对无 `id` 字段的 JSON-RPC 消息（通知）SHALL NOT 返回任何响应；SHALL 处理 `notifications/initialized`（静默确认）和 `ping`（返回空 result）；主循环 SHALL 对未知消息静默忽略而非返回错误或崩溃。

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

### Requirement: 严格变量的 prompt 渲染
worker SHALL 使用严格模板引擎渲染 `WORKFLOW.md` prompt 模板,以 `task`(或 `issue`)、`attempt`、`terminal_states` 与 `active_states` 为输入变量。未知变量 SHALL 导致渲染失败。未知 filter SHALL 导致渲染失败。渲染失败 SHALL 导致当前 attempt 失败。`terminal_states` 和 `active_states` SHALL 为预 join 的逗号分隔字符串(如 `"Done, Closed, Cancelled"` 和 `"待办, 处理中, 合并中"`),由 `renderPrompt` 调用点从 `config.tracker.terminal_states` 和 `config.tracker.active_states` 数组 `.join(", ")` 后传入。

#### Scenario: 渲染 task、attempt、terminal_states 与 active_states
- **WHEN** 渲染首次 attempt
- **THEN** 模板收到 task 对象、`attempt` 为 null/缺失、`terminal_states` 为逗号分隔的终态名称字符串、`active_states` 为逗号分隔的活跃状态名称字符串

#### Scenario: active_states 从配置数组预 join
- **WHEN** `config.tracker.active_states` 为 `["待办", "处理中"]` 且渲染 prompt
- **THEN** `RenderContext.active_states` 为 `"待办, 处理中"`

#### Scenario: terminal_states 从配置数组预 join
- **WHEN** `config.tracker.terminal_states` 为 `["Done", "Closed"]` 且渲染 prompt
- **THEN** `RenderContext.terminal_states` 为 `"Done, Closed"`

#### Scenario: 未知变量失败
- **WHEN** 模板引用未定义变量
- **THEN** 渲染失败,attempt 失败

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

### Requirement: Attempt 生命周期与失败分类
每次 attempt SHALL 经历阶段:准备工作区、构建 prompt、启动 agent、完成、以及 succeeded/failed/timed_out/stalled/canceled_by_reconciliation 之一。turn 墙钟超时(`opencode.turn_timeout_ms`)SHALL 使 attempt 失败并分类为 `turn_timeout`。不活跃超时(`opencode.inactivity_timeout_ms`)SHALL 使 attempt 失败并分类为 `inactivity_timeout`。子进程异常退出 SHALL 使 attempt 失败。调度器 SHALL 将 worker 结果转换为显式状态转换。attempt 结果 SHALL 包含从 JSON 事件流提取的 session ID(若可用)。

#### Scenario: 墙钟超时使 attempt 失败
- **WHEN** 一次 `opencode run` 调用总时长超过 `opencode.turn_timeout_ms`
- **THEN** attempt 被分类为 timed_out 并失败，错误标注为 `turn_timeout`

#### Scenario: 不活跃超时使 attempt 失败
- **WHEN** 一次 `opencode run` 调用在 `opencode.inactivity_timeout_ms` 时间内无 stdout/stderr 输出
- **THEN** attempt 被分类为 timed_out 并失败，错误标注为 `inactivity_timeout`

#### Scenario: 异常退出使 attempt 失败
- **WHEN** `opencode run` 子进程异常退出
- **THEN** attempt 被分类为失败

#### Scenario: 结果携带 session ID
- **WHEN** attempt 完成
- **THEN** 结果包含从 JSON 事件流提取的 session ID(若可用)

### Requirement: Attempt 前后运行 hook
worker SHALL 在每次 attempt 前运行 `hooks.before_run`(失败/超时中止 attempt),在每次 attempt 后运行 `hooks.after_run`(失败/超时记录并忽略),`hooks.timeout_ms` SHALL 适用于每个 hook 执行。

#### Scenario: before_run 失败中止 attempt
- **WHEN** `before_run` 以非零退出
- **THEN** 中止当前 attempt

#### Scenario: after_run 失败被忽略
- **WHEN** attempt 后 `after_run` 以非零退出
- **THEN** 记录失败,attempt 结果不变

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

### Requirement: Agent runner 契约
agent runner 每次 attempt SHALL:创建/复用工作区、构建 prompt、启动 `opencode run` 会话、向编排器转发 worker 事件,并在出错时使 attempt 失败以便编排器 retry。成功后 SHALL 保留工作区。

#### Scenario: 出错使 attempt 失败
- **WHEN** agent runner 在 attempt 中遇错
- **THEN** attempt 失败,由编排器决定 retry 行为

#### Scenario: 成功后保留工作区
- **WHEN** attempt 成功
- **THEN** 不删除工作区目录

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

### Requirement: turn 事件发射
worker SHALL 在 turn 循环内每个 turn 开始时通过 `events.onEvent` 回调发射 `turn_started` 事件(含 turn 编号),在每个 turn 结束时发射 `turn_completed` 事件(含 token 用量)。调度器 SHALL 使用 `turn_started` 事件递增 `RunningEntry.turn_count`。

#### Scenario: turn 开始时发射事件
- **WHEN** runner 的 turn 循环开始一个新 turn
- **THEN** 通过 `events.onEvent` 发射 `{event: "turn_started", turn: <n>}`

#### Scenario: turn 结束时发射事件
- **WHEN** runner 的 turn 循环结束一个 turn
- **THEN** 通过 `events.onEvent` 发射 `{event: "turn_completed", turn: <n>, usage: {...}}`

### Requirement: rate-limit 提取
worker SHALL 从 `opencode run --format json` 事件流中解析 rate-limit 相关字段(若存在),并 SHALL 通过 `events.onEvent` 回调将 rate-limit 载荷传给调度器。调度器 SHALL 更新 `state.rate_limits`。

#### Scenario: 事件流含 rate-limit
- **WHEN** opencode JSON 输出含 rate-limit 载荷
- **THEN** worker 通过 `events.onEvent` 传递 rate-limit 信息

#### Scenario: 事件流无 rate-limit
- **WHEN** opencode JSON 输出不含 rate-limit 载荷
- **THEN** 不传递 rate-limit 信息,`state.rate_limits` 保持不变

### Requirement: 错误分类
worker SHALL 将 attempt 失败分类为以下类别之一:`invalid_workspace_cwd`、`spawn_failed`、`turn_timeout`、`inactivity_timeout`、`agent_exit_error`、`stalled`。每个类别 SHALL 在 `AttemptResult` 的 `error` 字段中标注。调度器 SHALL 使用错误类别决定 retry 行为。

#### Scenario: 墙钟超时分类
- **WHEN** opencode run 子进程总时长超过 `turn_timeout_ms`
- **THEN** attempt 错误分类为 `turn_timeout`

#### Scenario: 不活跃超时分类
- **WHEN** opencode run 子进程在 `inactivity_timeout_ms` 时间内无输出
- **THEN** attempt 错误分类为 `inactivity_timeout`

#### Scenario: spawn 失败分类
- **WHEN** `opencode run` 命令无法启动
- **THEN** attempt 错误分类为 `spawn_failed`

#### Scenario: 异常退出分类
- **WHEN** `opencode run` 子进程以非零退出码退出
- **THEN** attempt 错误分类为 `agent_exit_error`

### Requirement: 不活跃超时
worker SHALL 对 `opencode run` 子进程实施不活跃超时监控：当 `opencode.inactivity_timeout_ms` > 0 时，SHALL 在子进程启动后启动不活跃计时器，并在每次收到 stdout 或 stderr 数据时重置该计时器。计时器触发时 SHALL 以 SIGTERM 终止子进程并标记为超时。当 `opencode.inactivity_timeout_ms` = 0 时 SHALL 禁用不活跃超时监控。不活跃超时与墙钟超时（`turn_timeout_ms`）独立运行，先触发者先终止子进程。worker SHALL 在不活跃超时触发时将 attempt 错误分类为 `inactivity_timeout`。

#### Scenario: 持续输出时不触发不活跃超时
- **WHEN** `opencode.inactivity_timeout_ms` 为 600000（10min）且子进程持续在 10 分钟内产出 stdout 或 stderr 数据
- **THEN** 不活跃计时器被持续重置，不触发超时

#### Scenario: 静默后触发不活跃超时
- **WHEN** `opencode.inactivity_timeout_ms` 为 600000（10min）且子进程超过 10 分钟未产出任何 stdout/stderr 数据
- **THEN** 不活跃计时器触发，子进程被 SIGTERM 终止，attempt 错误分类为 `inactivity_timeout`

#### Scenario: 禁用不活跃超时
- **WHEN** `opencode.inactivity_timeout_ms` 为 0
- **THEN** 不启动不活跃计时器，仅依赖墙钟超时和 stall 检测

#### Scenario: 不活跃超时与墙钟超时独立
- **WHEN** 不活跃超时设为 10min、墙钟超时设为 1h，且子进程在 10 分钟内持续输出
- **THEN** 不活跃计时器不触发，子进程可存活至墙钟超时（1h）

#### Scenario: 不活跃超时先于墙钟触发
- **WHEN** 不活跃超时设为 10min、墙钟超时设为 1h，且子进程在启动后立即静默
- **THEN** 不活跃计时器在 10min 时先触发，墙钟计时器被清理

### Requirement: 技能文件在 workspace 中的位置约定
opencode 技能文件 SHALL 位于 workspace 的 `.opencode/skills/<name>/SKILL.md`。技能文件 SHALL 由开发仓库自带（预放在仓库的 `.opencode/skills/` 目录），随 `after_create` hook 的 `git clone` 进入 workspace。tasking SHALL NOT 在 workspace 初始化时注入或覆盖技能文件——`injectMcpConfig` 只操作 `.opencode/opencode.json`，不碰 `.opencode/skills/`。

#### Scenario: 技能文件由仓库自带
- **WHEN** workspace 通过 `after_create` hook 的 `git clone` 初始化
- **THEN** `.opencode/skills/` 目录内容来自仓库，tasking 不注入

#### Scenario: injectMcpConfig 不影响技能
- **WHEN** `injectMcpConfig` 合并 `.opencode/opencode.json`
- **THEN** `.opencode/skills/` 目录保持不变

### Requirement: 每 turn 解析 per-task agent
worker 的 turn 循环 SHALL 在每个 turn 构造 `opencode run` 命令前，调用共享纯函数 `resolveAgent(currentTask, config)` 解析该 turn 的 agent，并 SHALL 将解析结果注入 `buildOpencodeCommand` 的 `--agent` 参数（覆盖 `config.opencode.agent`）。`currentTask` SHALL 为该 turn 最新可见的 Task（turn 1 为派发时的 task，turn 2+ 为 `trackerStateChecker` 刷新后的 Task）。因此运行中切换 agent（由 `/agent <name>` 改 label 触发）SHALL 在下一 turn 边界生效——当前正在运行的 `opencode run` turn 不被中断，turn 结束后循环从刷新的 Task 重新解析 agent。解析产出未知 agent 警告时 SHALL 记录日志但不 SHALL 中止 turn 或 attempt。

#### Scenario: turn 1 用任务 agent 标签
- **WHEN** 派发一个含 `agent:review` 标签的任务且 `opencode.agents` 含 `review`
- **THEN** turn 1 的 `opencode run` 命令含 `--agent Review`

#### Scenario: 运行中切换下一 turn 生效
- **WHEN** 任务 turn 1 用 `agent:build` 运行中，期间 `/agent review` 改了 issue 标签，turn 1 完成后 `trackerStateChecker` 刷新到含 `agent:review` 的 Task
- **THEN** turn 2 的 `opencode run` 命令含 `--agent Review`（当前 turn 未被中断）

#### Scenario: 无标签每 turn 用默认
- **WHEN** 任务无 `agent:` 标签
- **THEN** 每个 turn 的 `opencode run` 命令含 `--agent <opencode.agent>`（与原行为一致）

#### Scenario: 未知 agent 不中止 turn
- **WHEN** 任务标签含 `agent:foo` 且 `opencode.agents` 非空不含 `foo`
- **THEN** 记录未知 agent 警告，该 turn 仍以默认 agent 启动，attempt 不失败

### Requirement: 可选 model 与 variant 标志

worker SHALL 在构建 `opencode run` 命令时，仅当 `opencode.model` 非空时追加 `--model <model>` 参数，仅当 `opencode.variant` 非空时追加 `--variant <variant>` 参数。两个选项 SHALL 彼此独立，可只配其一或都不配。两者皆未配置时 SHALL NOT 追加任何对应参数，命令与改动前完全一致。

#### Scenario: 未配置 model 与 variant 时不追加参数
- **WHEN** `opencode.model` 与 `opencode.variant` 均为 `null`（或空串）
- **THEN** 构建的命令不包含 `--model` 或 `--variant` 参数，与既有命令完全一致

#### Scenario: 仅配置 model
- **WHEN** `opencode.model` 为 `anthropic/claude-sonnet-4-5` 且 `opencode.variant` 未配置
- **THEN** 构建的命令包含 `--model` 与 `anthropic/claude-sonnet-4-5`，不包含 `--variant`

#### Scenario: 仅配置 variant
- **WHEN** `opencode.variant` 为 `high` 且 `opencode.model` 未配置
- **THEN** 构建的命令包含 `--variant` 与 `high`，不包含 `--model`

#### Scenario: 同时配置 model 与 variant
- **WHEN** `opencode.model` 为 `anthropic/claude-sonnet-4-5` 且 `opencode.variant` 为 `high`
- **THEN** 构建的命令依次包含 `--model anthropic/claude-sonnet-4-5` 与 `--variant high`，位于 `--agent` 之后、prompt 之前

### Requirement: opencode 活动事件捕获与上报

`runAttempt` SHALL 逐 turn 调用 opencode（spawn-per-turn，session 经 `-s` 跨 turn 续接），并在 turn 内经 `runDefaultSubprocess` 的 `onOpencodeEvent` 回调把解析出的 opencode 事件带上 `turn` 编号经 `RunAttemptOptions.onActivity` 上报。`runAttempt` SHALL 在 `turn_started` WorkerEvent 中携带该 turn 解析出的 `agent`（`resolveAgent` 结果）、`model`（`config.opencode.model`）、`variant`（`config.opencode.variant`）。现有 `extractSessionAndUsage` 的 sessionID 与 tokens 提取 SHALL 不变。`spawnRunner` 注入点 SHALL 接受可选 `onOpencodeEvent` 尾参；参数更少的现有 mock 仍 SHALL 满足类型。

#### Scenario: onActivity 收到带 turn 的事件

- **WHEN** `runAttempt` 在 turn 3 运行且 opencode stdout 产生一个 `text` 事件
- **THEN** `onActivity` 收到 `{ ts, turn:3, type:"text", text }`（或对应结构）

#### Scenario: turn_started 携带 agent/model/variant

- **WHEN** turn 解析得 agent=`build`、model=`anthropic/claude-sonnet-4-5`、variant=`high`
- **THEN** `turn_started` WorkerEvent 含 `agent`、`model`、`variant` 三字段

#### Scenario: 未配置 model 时 variant 仍上报

- **WHEN** `config.opencode.model` 为空、variant=`high`
- **THEN** `turn_started` 的 `model` 为 `null`、`variant` 为 `"high"`、`agent` 为解析值

#### Scenario: 既有 spawnRunner mock 不破坏

- **WHEN** 注入的 `spawnRunner` 仅声明 5 个参数（不含 onOpencodeEvent）
- **THEN** 类型检查通过，runAttempt 仍可用（回调经默认 spawnRunner 路径到达 `runDefaultSubprocess`）

### Requirement: 终止升级与进程组击杀
worker SHALL 以独立进程组方式启动 `opencode run` 子进程(detached)。墙钟或不活跃超时触发时,worker SHALL 先仅对子进程(组 leader)发 SIGTERM;若在 kill grace(固定 10000ms,SHALL NOT 暴露为 WORKFLOW.md 配置;实现层 SHALL 可参数化注入供测试)内子进程未退出,SHALL 升级为对整个进程组发 SIGKILL。宽限期间子进程恢复输出 SHALL NOT 撤销升级;宽限定时器 SHALL 幂等(多个超时源先后触发时只设一次)。abort 信号路径(scheduler stall 兜底、daemon 停机)SHALL 直接对整个进程组发 SIGKILL,无宽限。子进程正常退出 SHALL 清理全部定时器(含宽限定时器)。worker SHALL 在逐行解析 stdout 事件流时增量累计 session ID 与 token 用量,SHALL NOT 为此对全量 stdout 做逐 turn 重复解析;注入式 spawnRunner 仅返回 stdout 时 SHALL 走全量解析回退。

#### Scenario: 拒签 SIGTERM 的子进程被组杀
- **WHEN** 子进程捕获并忽略 SIGTERM 且持续运行,墙钟超时触发
- **THEN** SIGTERM 后经 kill grace 子进程仍未退出,整个进程组被 SIGKILL,spawnRunner Promise 以超时结果 resolve

#### Scenario: 宽限内优雅退出则不升级
- **WHEN** 墙钟/不活跃超时发 SIGTERM 后,子进程在 kill grace 内自行退出
- **THEN** 不发生 SIGKILL,close 正常清理全部定时器,attempt 按超时分类

#### Scenario: abort 直接组杀
- **WHEN** AbortSignal 触发(scheduler stall 或 daemon 停机)
- **THEN** 整个进程组被 SIGKILL,无 SIGTERM、无宽限

#### Scenario: 会话与用量单遍累计
- **WHEN** 一轮 turn 的 stdout 含多个 JSON 事件(含 `step_finish` token 与 `sessionID`)
- **THEN** session ID 与累计用量由流式单遍解析得出,与全量 `extractSessionAndUsage` 对同一输入的结果一致

#### Scenario: 仅返回 stdout 的注入式 runner 回退
- **WHEN** 测试注入的 spawnRunner 只提供 `stdout`(无 `sessionAndUsage`)
- **THEN** runAttempt 经 `extractSessionAndUsage(stdout)` 回退取值,行为与现状一致

