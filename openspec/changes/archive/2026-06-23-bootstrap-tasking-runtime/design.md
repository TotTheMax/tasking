## Context

`tasking` 是一个新的 TypeScript CLI daemon,从两个任务流编排 coding-agent 工作。它移植了 Symphony SPEC(OpenAI 的 Elixir 参考实现,轮询 Linear 并按 issue 跑 Codex app-server)中经过验证的协调模型,并新增一个 Symphony 缺失的能力:面向非结构化源的 LLM route agent。

现状:全新项目。`openspec/specs/` 为空;这是初始 bootstrap。

干系人:希望从 Jira 工单和飞书聊天驱动 opencode coding agent、且无需人工中转的工程团队。

沿用自 Symphony SPEC 的关键约束:
- scheduler/runner 是 tracker 的*读取者*与 agent 的*运行者*;工单写入由 agent 通过工具完成,而非编排器业务逻辑(Symphony §1 边界)。
- 调度状态在内存中;重启恢复由 tracker + 文件系统驱动,而非 DB 驱动(Symphony §14.3)。
- 三条安全不变式不可妥协:agent cwd == 工作区路径、工作区位于 root 内、工作区 key 已清洗(Symphony §9.5)。
- `WORKFLOW.md` 是仓库拥有的 prompt + 运行时配置契约,支持动态重载(Symphony §5、§6.2)。

相比 Symphony 的三个有意替换:
1. Linear → Jira(JQL 候选拉取,REST 归一化)。
2. Codex app-server(stdio 上的 JSON-RPC)→ `opencode run` 子进程(一次性 prompt → stdout/exit)。
3. Elixir → TypeScript(用于 npx 分发并直接复用 opencode 的 TS 生态)。

相比 Symphony 的一个增量:面向非结构化飞书消息的 route agent + inbox。

## Goals / Non-Goals

**Goals:**
- 单一 `tasking` CLI(npx 分发),运行托管两个调度器的 daemon。
- 结构化路径(Jira):确定性 轮询/派发/reconcile/retry,热循环中不含 LLM,镜像 Symphony §7–§8。
- 非结构化路径(飞书 v1 IM 文本):按 tick 有界的 route agent,将 inbox 条目分诊为共享任务模型并派发。
- 两条路径汇聚到共享的归一化 `Task` 模型、共享的工作区管理器、共享的 `opencode run` worker。
- 通过 `opencode run --dir <workspace>` 子进程实现 OS 级 per-task 隔离。
- 一套测试流程(核心 + 扩展 + 真实集成 profile),改编自 Symphony §17。

**Non-Goals:**
- 无 Web UI 或多租户控制面(Symphony §2.2)。
- 无持久调度 DB;仅内存状态(Symphony §14.3)。重启 = 重新轮询。
- 编排器无 first-class tracker 写 API;写入留在 agent/工具层(Symphony §11.5)。
- 本次变更不含飞书富文本/卡片/事件,仅 v1 IM 文本 + @mention 过滤。
- 不含 Linear 适配器(v1 结构化仅 Jira)。
- 不含 SSH 远程 worker 扩展(Symphony 附录 A)。
- 不保证配置重载后保留在途 agent 会话(Symphony §6.2)。
- 不是通用工作流引擎或分布式作业调度器(Symphony §2.2)。

## Decisions

### 决策 1:TypeScript + npx 分发
**选择:** 用 TypeScript 实现,发布到 npm,通过 `npx tasking` 分发。

**理由:** opencode 本身是 TypeScript;用户希望复用 opencode 能力并以 npx 包发布。TS 为配置层提供原生类型,与 opencode plugin 共享生态,`npx` 分发契合运维模型(无需安装 daemon)。运行时为 Node 22 LTS。

**备选方案:**
- *Elixir(直接移植 Symphony):* 并发与原 daemon 模型很强,但无原生 npx 分发且无 opencode TS 直接复用。已排除。
- *Go:* 单二进制分发有吸引力,但失去 opencode TS plugin 直接复用,且用户已明确提议 TS。已排除。

### 决策 2:Worker = `opencode run` 子进程(而非 app-server 协议)
**选择:** 以 `opencode run --dir <workspace> --agent <build> "<rendered prompt>"` 启动 worker,把每次运行视为一次 attempt。通过在 `agent.max_turns` 内再次调用 `opencode run` 并携带续轮指引来驱动续轮,而非持有一个长生命周期的 app-server 会话。

**理由:** Symphony 的设计与 Codex app-server JSON-RPC 协议(thread/turn 生命周期、流式事件、token 记账、客户端工具)强耦合。opencode 的 `run` 子命令是更简单的一次性 prompt→结果接口。实现一套完整的 app-server 协议客户端去对接 opencode 是一项庞大且脆弱的工程,超出范围。`run` 形式满足用户明确要求("启动任务 agent 可以用 opencode run 的形式"),并提供每次 attempt 干净的 OS 级进程隔离。

**与 Symphony 的差异后果:**
- worker 生命周期内无跨 turn 的持久 thread 复用。续轮 = 一次新的 `opencode run` 调用,携带引用先前工作区状态的续轮 prompt。可接受,因为工作区(文件系统 + git)是跨 turn 的持久上下文,而非 agent thread。
- token/运行时记账来自 `opencode run` stdout/exit + 进程级计时,而非流式协议事件。我们尽可能从 opencode 结构化输出提取用量,回退到进程级计时。
- "turn 计数"映射为一次 attempt 续轮循环内的调用次数,受 `agent.max_turns` 上限约束。

**备选方案:**
- *若 opencode 暴露 app-server 模式则封装之:* 最贴近 Symphony,但 `run` 是 opencode 文档化的稳定入口,协议耦合是维护风险。暂缓。
- *每任务一次 `opencode run` 且无续轮循环:* 更简单,但丢失 Symphony "重新检查 tracker 状态并在仍活跃时续轮"的行为(§7.1)。已排除;保留有界续轮循环。

### 决策 3:双源双调度,共享任务模型
**选择:** 一个 `Task` 归一化目标。结构化调度器(Jira)与非结构化 router(飞书→route agent)都产出 `Task` 记录,交给相同的 派发/工作区/worker 路径。

**理由:** 保持 Symphony 协调核心对两条流可复用。结构化路径保持确定性(无 LLM 成本);非结构化路径*仅*用 LLM 把聊天转成 `Task` + 派发决策,再交给同一确定性 worker 路径。这契合用户"双源双调度"框架,并将 LLM 成本限制在分诊环节。

**备选方案:**
- *两源统一用 LLM router:* 已排除——用户明确要求 Jira 路径保持确定性("Jira 路径保持确定性"、"纯开销")。
- *完全分离、无共享模型的流水线:* 已排除——重复工作区/worker/安全逻辑。

### 决策 4:Route agent 以 opencode 子进程运行,按 tick 有界
**选择:** Route agent 本身通过 `opencode run` 启动,使用自定义 `--agent` profile(triage agent)与有界 prompt。按 tick(或外部 cron 触发)对 inbox 运行。它将 `inbox.pop_untriaged`、`inbox.mark_decision`、`feishu.reply` 作为 opencode plugin 工具暴露,使 LLM 能在其受沙箱保护的运行内读取/决策/回复。

**理由:** 复用 opencode 的 agent + 工具模型来做路由,而非手写 LLM 调用。inbox 是 plugin 读写的一张 SQLite 表,因此即使调度状态在内存中,分诊状态在 route-agent 调用间也是持久的。按 tick 有界防止成本失控。

**备选方案:**
- *Route agent 作为进程内 LLM SDK 调用:* 控制力更强,但失去 opencode 的工具/权限模型并重造 prompt + 工具调用处理。已排除。
- *Route agent 作为常驻 daemon thread:* 状态管理更复杂;按 tick 有界运行更简单且对 v1 足够。

### 决策 5:Inbox = SQLite(持久);调度状态 = 内存
**选择:** 非结构化分诊 inbox 是一个 SQLite DB(文件位于配置的数据目录下)。编排器的 running/claimed/retry 状态按 Symphony §14.3 保持内存。

**理由:** 非结构化条目从飞书异步到达,必须在 route-agent 与调度器重启后存活;内存 inbox 会在重启时丢失未分诊工作。调度器状态则相反,可通过重新轮询 tracker 恢复(Symphony 验证过的模型),故保持内存。inbox 是相比 Symphony 的唯一持久化增量。

**Schema(v1):** 表 `inbox_items`,字段 `id`(PK)、`source`(如 `feishu`)、`source_msg_id`(幂等键,UNIQUE)、`received_at`、`raw_payload`(JSON)、`status`(`untriaged`|`decided`|`dispatched`|`rejected`)、`decision`(JSON,route agent 的分类 + 归一化 Task)、`decided_at`、`task_id`(派发后外键)。`source_msg_id` 幂等防止同一条飞书消息重复接入。

### 决策 6:沿用 Symphony 的 `WORKFLOW.md` 契约,最小差异
**选择:** 保留 `WORKFLOW.md`(front matter + prompt body)、动态重载、校验、prompt 模板渲染,如 Symphony §5–§6。将 `tracker.kind: linear` 替换为 `jira`,将 `codex.*` 配置块替换为 `opencode.*` 块(命令、agent profile、turn 超时)。新增 `router.*` 块用于 route-agent 配置,`feishu.*` 块用于源配置。

**理由:** 最大化复用已验证契约;熟悉 Symphony 的运维者可直接迁移。三处配置差异映射三个替换 + 一个增量。

### 决策 7:进程模型——一个 daemon,两个调度器,共享 worker 池
**选择:** `tasking start` 运行单一 Node 进程。它托管:结构化调度器(Jira 轮询循环)、非结构化 router(飞书接入 + 按 tick route agent)、一个强制全局 + 按状态并发的共享 worker 池、工作区管理器、可观测性。它们共享一个内存 `OrchestratorRuntimeState`(Symphony §4.1.8,扩展 per-source 任务映射)。

**理由:** 单进程简化运维模型,并在两源间共享并发预算。全局并发(`agent.max_concurrent_agents`)封顶 `opencode run` 子进程总数,不分来源。

**备选方案:**
- *两个独立 daemon:* 隔离更强,但运维面翻倍且并发预算分裂。v1 不采用。

### 决策 8:OpenTelemetry 友好的结构化日志 + 可选 HTTP dashboard
**选择:** 结构化日志(JSON 行)输出到 stderr/文件,带 `task_id`/`task_identifier`/`session_id` 上下文(Symphony §13.1)。可选 HTTP dashboard 扩展(`--port` / `server.port`),复用 Symphony §13.7 端点,由内存快照驱动。

**理由:** 运维者必须能在不挂调试器的情况下看到派发/校验失败(Symphony §13.2)。HTTP 扩展是可选的,不参与正确性。

## Risks / Trade-offs

- **[风险] `opencode run` 缺少流式协议事件** → 我们失去 Symphony 从 app-server 事件获得的实时 per-turn token/流式可见性。**缓解:** 尽可能从 opencode 结构化输出提取用量;依赖进程级计时 + exit code 做失败分类;从进程存活度展示 "running" 状态。作为相对 Symphony 的已知可观测性缺口记录在案。
- **[风险] 续轮间无持久 agent thread** → 续轮重新调用 `opencode run` 而非恢复 thread,故 agent 对对话的记忆在 turn 间丢失。**缓解:** 工作区(文件系统、git 状态)是持久上下文;续轮 prompt 汇总先前进展。v1 可接受;若 opencode 暴露稳定的会话恢复则再评估。
- **[风险] 大 inbox 下 route agent 成本/延迟** → 按 tick 的 route-agent 运行可能在大批未分诊条目下变慢或变贵。**缓解:** 按 tick 批量有界(`router.batch_size`)、将条目标记 `decided` 避免重复分诊、封顶 route-agent 运行时(`router.timeout_ms`)。
- **[风险] 飞书 API 认证/事件模型漂移** → 飞书开放平台 API 会演进。**缓解:** 所有飞书调用隔离在 `feishu-source` 适配器后;v1 范围限于 IM 文本 + @mention,表面积很小。
- **[风险] Jira JQL/schema 在不同 Jira 部署间差异**(Cloud vs Data Center)。**缓解:** `jira-tracker` 适配器 v1 对接 Cloud REST v3 API + JQL 并记录部署假设;字段归一化已隔离。
- **[风险] 重启时内存调度状态丢失** → 沿用自 Symphony §14.3。**缓解:** 通过 tracker 重新轮询 + 工作区复用 + inbox 持久化(决策 5)恢复;记录 retry timer 不跨重启存活。
- **[权衡] 单进程共享并发预算** → Jira 洪峰会饿死飞书派发的任务,反之亦然。v1 接受;若需要,per-source 并发上限是未来扩展。
- **[权衡] Hook 脚本完全受信**(沿用 Symphony §15.4)→ hook 在工作区内运行任意 shell。接受;记录在安全姿态中。
