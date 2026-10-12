## Why

团队今天通过两种截然不同的任务流来驱动 coding-agent 工作,而现有单一工具无法同时处理好两者。结构化工作以固定格式工单形式存在于 Jira 中;非结构化工作以临时请求形式从聊天(飞书)中涌入,需要先分诊才能转化为可执行任务。Symphony 已为结构化流证明了可靠的 daemon 模式(轮询 → 建工作区 → 跑 agent),但它仅支持 Linear、仅支持 Codex,且对非结构化源没有答案。我们需要 `tasking`:一个 TypeScript CLI daemon,把 Symphony 经过验证的调度核心移植到 opencode worker,把 Linear 换成 Jira,并新增一个 Symphony 没有的能力——用 LLM route agent 把非结构化飞书消息分诊为可执行任务后再派发。

## What Changes

- **新增 CLI 入口(`tasking`)**,以 npx 包形式分发。子命令:`init`、`start`、`status`、`logs`、`triage`。`start` 启动 daemon 与调度器;其余子命令用于控制与观察 daemon。
- **新增 Symphony 式确定性调度器,处理结构化 Jira 任务。** 移植 Symphony SPEC 中的轮询 tick、内存状态机、claim/running/retry 映射、reconcile、指数退避、以及仓库拥有的 `WORKFLOW.md` 契约。相比 Symphony 的三个替换:Linear → Jira(JQL)、Codex app-server → `opencode run` 子进程、Elixir → TypeScript。
- **新增 LLM route agent,处理非结构化飞书任务。** 一个按 tick 有界运行的 opencode 子进程,消费可分诊的 inbox 条目,分类/归一化为同一任务模型,并决定派发——这是 Symphony 不具备的能力。以 opencode plugin 形式暴露 `inbox.pop_untriaged`、`inbox.mark_decision`、`feishu.reply` 工具。
- **双源双调度架构。** 结构化路径(Jira)保持确定性——热循环中不使用 LLM。非结构化路径(飞书 v1)由 route agent 驱动。两者汇聚到共享的归一化任务模型、共享的工作区管理器、以及共享的 `opencode run` worker。
- **Worker 为 `opencode run` 子进程。** 每个任务获得隔离的 per-task 工作区;worker 以 `opencode run --dir <workspace> --agent <build> "<rendered prompt>"` 形式启动,提供 OS 级进程隔离,并直接复用 opencode 的 coding-agent 能力。
- **仓库拥有的 `WORKFLOW.md` 契约** 从 Symphony 沿用,用于 prompt + 运行时配置,支持动态重载。
- **工作区安全三不变式**(cwd == 工作区、工作区位于 root 内、key 已清洗)完整保留,逐字对应 Symphony §9.5。
- **完整测试流程**:核心一致性单元/集成测试(确定性)+ 扩展一致性(route agent、HTTP)+ 真实集成 profile(Jira/飞书冒烟,CI 中可选)。

## Capabilities

### New Capabilities
- `cli-runtime`:`tasking` CLI 入口、daemon 生命周期(`init`/`start`/`status`/`logs`/`triage`)、配置解析、`WORKFLOW.md` 动态重载、npx 包分发。
- `structured-scheduler`:Symphony 式确定性 轮询/派发/reconcile/retry 调度器,处理结构化 Jira 任务。状态机、并发、退避、终端清理,热循环中不含 LLM。
- `unstructured-router`:route agent + inbox 子系统,处理非结构化飞书任务。按 tick 有界的 opencode 子进程,将 inbox 条目分诊为归一化任务模型并派发。包含 `inbox.*`/`feishu.reply` opencode plugin 工具。
- `opencode-worker`:worker 执行层。按任务启动 `opencode run` 子进程,以 per-task 工作区为 cwd,渲染 prompt,回流事件,强制 max-turns,处理续轮。OS 级进程隔离。
- `workspace-management`:per-task 工作区创建/复用、key 清洗、root 包含性安全不变式、生命周期 hooks(`after_create`/`before_run`/`after_run`/`before_remove`)。两个调度器共享。
- `jira-tracker`:Jira tracker 适配器——JQL 候选拉取、按 ID 状态刷新、终端状态拉取用于启动清理、归一化到共享任务模型。即 Linear→Jira 替换。
- `feishu-source`:飞书源适配器 v1——将带 @mention 过滤的 IM 文本消息接入分诊 inbox,并支持 route agent 回复的 `feishu.reply`。
- `observability`:带任务/会话上下文的结构化日志、运行时状态面(`tasking status`)、token/运行时聚合、可选 HTTP dashboard 扩展。

### Modified Capabilities
<!-- 无——这是初始 bootstrap;openspec/specs/ 为空。 -->

## Impact

- `src/` 下**新代码库**:CLI、daemon、调度器、适配器、worker、工作区、可观测性、plugin 工具。
- 新增 `package.json`,目标 Node 22+,发布到 npm 以支持 `npx tasking` 分发。使用 TypeScript 构建。
- **外部运行时依赖 `opencode`**(宿主机 PATH 上的 `opencode run` 子命令)。Symphony 依赖 `codex app-server`;tasking 改为依赖 `opencode`。
- **外部集成**:Jira REST/JQL API(结构化源)与飞书开放平台 API(非结构化源,v1 仅 IM 文本)。
- **仓库拥有的 `WORKFLOW.md`** 成为 prompt + 运行时配置的契约,按团队版本控制。
- **文件系统**:配置 root 下的 per-task 工作区(默认 `<system-temp>/tasking_workspaces`),以及用于非结构化分诊状态的 inbox SQLite DB。
- **Symphony SPEC 复用**:约 80% 的 Symphony 协调/执行/安全模型通过引用沿用(轮询 tick、状态机、reconcile、retry 退避、工作区隔离、`WORKFLOW.md`、安全不变式)。差异是三个替换(Linear→Jira、Codex→opencode、Elixir→TS)加 route-agent 增量。
- **测试**:一棵 `tests/` 树,镜像 Symphony §17 一致性矩阵,适配 TS/Jira/opencode 技术栈并扩展 route-agent 路径。
