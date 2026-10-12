## Context

`tasking` 的 TUI（`src/observability/terminal-dashboard.ts`，手写 ANSI，无框架）有 5 个模式：`overview` / `detail-running` / `detail-retry` / `logs` / `config`。详情视图（`formatRunningDetail*`，`:648-762`）几乎只读——仅 `Esc/q`/`Ctrl-C` 绑定（`processKey` `:143-254`），大量按键空闲；只显示 `last_event`/`last_message`/`tokens`/`session_id`/`turn_count`，看不到 agent 的实际对话与工具调用，也无模型信息。

opencode 以 `opencode run --format json` 逐 turn 子进程启动（`runner.ts:78-102` `buildOpencodeCommand`，`:104-178` `runDefaultSubprocess`，`:212+` `runAttempt` turn 循环）。stdout 是换行分隔的 JSON 事件流，事件类型包括 `step_start` / `step_finish`（`part.tokens`）/ `text`（`part.text`，助手文本）/ `tool_use`（`part.tool`，工具调用）。但 `extractSessionAndUsage`（`:185-210`）只取 `sessionID` + `step_finish` tokens，**丢弃 text/tool_use**。worker 已有 `child.stdout.on("data")`（`:141-156`，分 inactivity 与 else 两支），可增量解析。session 经 `-s <id>` flag + `.tasking-session.json` sidecar 跨 turn 续接；turn 间 prompt = `buildContinuationGuidance`（`prompt.ts:185`）。

TUI 数据流：进程内 `tasking start --tui` 直读 `scheduler.state`（`cli/index.ts:266-273`）；远端 `tasking tui` 1Hz 轮询 `GET /api/v1/state`（`http-dashboard.ts:144`）+ `GET /api/v1/logs`（`:165`）。HTTP 路由表 `:128-220`，per-issue 兜底 `GET /api/v1/<identifier>`（`:202-211` → `lookupIssue` `:222-268`）。无向运行中任务发消息的端点；stdin 在 `runDefaultSubprocess` 被显式 ignore（`:115` `stdio:["ignore","pipe","pipe"]`）；README 明确"需要用户输入的 run 视为硬失败"。

官方 `@opencode-ai/sdk`（v1.18.21，opencode 自带）暴露 `session.messages`（读对话）/ `session.prompt`（注入）/ `event.subscribe`（SSE 实时）/ `createOpencodeServer`（拉起无头 server）；CLI 有 `opencode serve`。但 tasking 当前完全没用 server/SDK，是 spawn-per-turn。opencode 把完整会话存进 `~/.local/share/opencode/opencode.db`（SQLite，含 `session`/`session_message`/`part` 表）。

已与人确认的决策（grill 答复"都按推荐的来，Q1 补充显示模型"）：① 需求1 用 **A 捕获并渲染**；② 需求2 本期**只分析不实现**；③ 活动视图与详情页**显示使用的模型**。

## Goals / Non-Goals

**Goals:**
- TUI 详情页一键（`a`）进入"活动视图"，近实时看到 agent 的助手文本、工具调用、step tokens，以及当前 model/agent/variant。
- 详情页本身也显示 model/agent/variant。
- 数据自包含：增量解析 opencode stdout，不耦合 opencode 内部 SQLite schema、不引入 SDK 依赖、不改 spawn-per-turn 模型。
- 与 tasking 现有"内存状态 + HTTP dashboard + 1Hz 轮询"架构一致；零回归现有 scheduler/worker 语义。

**Non-Goals:**
- 不实现需求2（向运行中任务输入提示词）——仅在本文档分析可行性与必要性。
- 不改 config schema、不改 poll/reconcile/retry 语义、不改 spawn-per-turn turn 模型。
- 不做真·实时 SSE 推送（1Hz 轮询已与现有 TUI 一致，足够"近实时"）。
- 不持久化活动历史跨 attempt（缓冲随 `RunningEntry` 生命周期，`onWorkerExit` 清除——活动视图只服务于"运行中"任务）。
- 不替换 opencode 自己的 TUI（"原始 opencode tui"是参照目标，非集成对象）。

## Decisions

1. **架构选 A 捕获并渲染**：增量解析 opencode stdout 事件流 → `ActivityStore` 内存环形缓冲 → HTTP 端点 → TUI 活动视图。近实时（事件边产生边入缓冲，TUI 1Hz 轮询，同现有 TUI 数据延迟）。worker 仍是 spawn-per-turn，低风险、自包含、不耦合 opencode 内部。备选 B（opencode server 模型 + `@opencode-ai/sdk`：`session.messages`/`event.subscribe` 真·实时、`session.prompt` 真·注入）风险高（worker spawn→server+client 大改，turn/abort/timeout/retry 语义重写，新增 SDK 依赖+版本耦合，每 task 一个 server 端口）——留作未来真·实时/#2-真·注入的增强。备选 C（直读 opencode.db `session_message`/`part`）脆弱耦合 opencode 内部 schema、全局共享 DB——否决。详见 ADR 0012。

2. **`ActivityStore` 独立模块，非放 `RunningEntry`**：每 `task_id` 一个环形缓冲（上限 500），`record`/`recent`/`clear`。独立于 `RunningEntry` 使后者保持精简（不被序列化进 `RuntimeSnapshot`），HTTP 端点直查 store 自然，且 in-process/远端 TUI 对称访问。scheduler 持有实例，`onWorkerExit` 清除（与"调度状态在内存"一致）。备选放 `RunningEntry` 上——否决（`RunningEntry` 变重，序列化须排除缓冲）。

3. **增量解析放 `runDefaultSubprocess` 内**：新增可选 `onOpencodeEvent?: (evt: OpencodeEvent) => void` 尾参；带行缓冲（`stdoutLineBuffer`，跨 chunk 拼接，按 `\n` 切完整行解析，余数留下一 chunk）；inactivity 与 else 两支共用一个 `handleStdoutChunk` 助手。现有 stdout 字符串缓冲与 `extractSessionAndUsage` 完全不变（零回归）。备选在 turn 结束后整体解析 `result.stdout`——否决（无 turn 进行中近实时；长 turn 时活动视图长时间无新内容，不符"了解当前运行情况"）。

4. **`spawnRunner` 类型加可选回调尾参**：`(cmd, cwd, timeout, inactivityTimeout, signal?, onOpencodeEvent?) => Promise<SubprocessResult>`。TS 允许参数更少的函数赋值给参数更多的类型，故现有 5 参 test mock 仍满足类型（零回归）。worker turn 循环调用 `spawnRunner` 时构造闭包，捕获 `turn` 与 `opencodeForTurn`/`config.opencode`，把 `OpencodeEvent` 包装成带 `turn` 的 `ActivityEvent` 经 `RunAttemptOptions.onActivity` 上报。

5. **模型/agent 来源 = tasking 传给 opencode 的值（权威）**：`RunningEntry` + `RuntimeSnapshot` running 行 + `lookupIssue` 加 `agent`/`model`/`variant`（`string | null`）。worker 在 `turn_started` WorkerEvent 携带三者（`resolveAgent` 解析的 agent + `config.opencode.model`/`variant`），scheduler `onEvent` 写回 entry；`buildSnapshot` 映射。活动视图头部与详情页均读此。备选从 opencode stdout 事件取 model——否决（tasking 传出的值即用户配置，权威且无需依赖 opencode 事件 schema 的 model 字段）。

6. **HTTP 端点 `GET /api/v1/<id>/activity?limit=N`**：返回 `{ activity: ActivityEvent[] }`，置于现有 `GET /api/v1/<identifier>` 兜底路由之前（先匹配 `/<id>/activity` 后缀，否则走兜底）。`HttpDashboardOptions` 加 `activityStore?`。`limit` 默认 200、上限 500（仿 logs 端点）。

7. **TUI 活动模式**：`TuiMode` 加 `"activity"`；`detail-running`（仅运行中）新键 `a` → `enterActivity()`（记录 `detailId`，设 mode）；`formatActivity` 头部（task id、model、agent、variant、turn、tokens total）+ 可滚动事件列表（助手文本 / 工具调用 / step tokens），复用 logs 模式滚动机制（`j/k`/`↑/↓`、`PgUp`/`PgDn`、follow）；`Esc/q` 返回 `detail-running`。`processKey` 的 `j/k`/`Esc/q` 分支加 activity 模式分支。进程内 TUI 直读 `activityStore.recent(detailId)`；远端 TUI 进入该模式时 1Hz 拉活动端点（仿 `fetchLogs`，`cli/index.ts:589-614`）。详情页 footer 提示从 `Esc/q back` 扩为 `Esc/q back · a 活动`。

8. **需求2 只分析不实现**（见下节）。

## 需求2 可行性与必要性分析（仅分析，不实现）

**可行性：**
- A（捕获并渲染）下：在 `RunningEntry` 加"待注入提示"缓冲；worker 在下个 turn 构造 `buildContinuationGuidance`（`prompt.ts:185`）前拼接该消息 → **turn 边界注入**（非 turn 进行中实时）。低风险，契合现有 turn 模型。注入点明确：`runner.ts:278-287` 的 prompt 选择 + `prompt.ts:185` 的 continuation 字符串。需 TUI 详情页加输入键（如 `i`）+ 一个 HTTP `POST /api/v1/<id>/message` 端点写缓冲。
- B（opencode server 模型）下：`session.prompt` / `TuiAppendPrompt` 可向运行中 session 真·实时注入（opencode 提示词队列）。但需先采纳备选 B（worker 大改）。
- 现有替代：Feishu→Jira 评论桥（`src/bridge/comment-bridge.ts`）已让人发 Jira 评论，agent 在**下个 turn** 经 Jira MCP 读取——一条异步纠偏路径已存在（飞书用户已在用）。

**必要性：**中等。对纠偏跑偏的 agent 有用，但 (a) 部分重复已有 Jira 评论纠偏路径；(b) agent 本质是自治守护进程，频繁人工注入背离设计意图。

**结论：**本期不实现。若将来实现，采纳 A 下的 turn 边界注入（小增量），并执行已确认策略——以 sentinel `💬 {user} via TUI:` 镜像成 Jira 评论保可追溯（与飞书桥归属模式一致），使人干预在 tracker 可见可审计。

## Risks / Trade-offs

- [近实时非真·实时] → 1Hz 轮询，最长 ~1s 显示延迟，与现有 TUI 全部数据一致。可接受；真·实时需 SSE（未来，备选 B）。
- [活动缓冲随 attempt 生命周期清除] → `onWorkerExit` 清缓冲后无法回看已完成任务。可接受：活动视图契约就是"运行中"任务的透明；已完成任务看 `tasking.log` + Jira。
- [stdout 行跨 chunk 拼接] → 行缓冲正确处理 JSON 行被 TCP/chunk 切断；非 JSON 行（opencode 偶发非 JSON 输出）安全跳过（`parseOpencodeLine` 返回 null）。
- [`spawnRunner` 类型扩展] → 加可选尾参，旧 5 参 mock 仍可赋值（TS 协变），零回归；测试覆盖 6 参路径。
- [opencode 事件 schema 版本耦合] → 只依赖稳定事件类型（`text`/`tool_use`/`step_start`/`step_finish`，见 `tests/worker.test.ts` 已固化）；未知类型原样保留 `type` 字段不崩溃，渲染时降级显示。
- [环形缓冲上限 500] → 长 attempt 超 500 事件丢弃最旧；可接受（活动视图关注近期行为；详情页 token/turn 计数仍精确，独立于缓冲）。

## Migration Plan

纯增量：`npm run build` 产出新 CLI；运行中任务的 stdout 自动被捕获，TUI 详情页 `a` 进入活动视图。无 config schema/存储迁移；无新依赖。`ActivityStore` 是 scheduler 内存态，重启即空（与现有调度状态一致）。回滚 = revert 分支。
