## Why

TUI 任务详情视图当前对运行中的任务几乎不透明：只显示 `last_event` / `last_message` / `tokens` / `session_id` / `turn_count`，看不到 agent 实际说了什么、调了什么工具、用的什么模型。opencode 以 `opencode run --format json` 逐 turn 子进程启动，stdout 是换行分隔的 JSON 事件流（`text`=助手文本 / `tool_use`=工具调用 / `step_finish`=tokens），但 tasking 当前只提取 `sessionID` + tokens，**丢弃了全部交互内容**（`runner.ts:185-210`）。详情视图按键也几乎全空闲（仅 `Esc/q`）。

TAS-17 需求1 要求一个快捷键显示当前任务运行情况（交互上下文、工具调用），对用户透明友好；并补充显示使用的模型。需求2（向运行中任务输入提示词）非必须，本期仅分析可行性与必要性。

已与人确认（grill 答复）：架构选 **A 捕获并渲染**（增量解析 opencode stdout 事件流 → 每 task 内存环形缓冲 → 新 HTTP 端点 → TUI 新"活动视图"模式）；需求2 本期**只分析不实现**；使用的模型需要在活动视图与详情页显示。

## What Changes

- **opencode 事件捕获（worker）**：`runDefaultSubprocess` 新增可选 `onOpencodeEvent` 回调，在 stdout 数据到达时增量解析完整 JSON 行（带行缓冲跨 chunk），把结构化事件（`text`/`tool_use`/`step_start`/`step_finish`）实时回调出来；现有 stdout 字符串缓冲与 `extractSessionAndUsage` 不变（零回归）。
- **活动数据模型**：新模块 `src/observability/activity-store.ts`——每 `task_id` 一个内存环形缓冲（上限 500 事件），`record` / `recent` / `clear`。`ActivityEvent = { ts, turn, type, text?, tool?, tokens? }`。scheduler 持有一个实例，worker 经新 `RunAttemptOptions.onActivity` 回调写入；`onWorkerExit` 清除该 task 的缓冲（与"调度状态在内存"一致）。
- **模型/agent 显示**：`RunningEntry` + `RuntimeSnapshot` running 行 + `lookupIssue` 增加 `agent` / `model` / `variant` 字段（来自每 turn 解析的 opencode 配置，权威源于 tasking 传给 opencode 的值）；worker 在 `turn_started` 事件携带三者，scheduler `onEvent` 写回 entry。
- **HTTP 端点**：`GET /api/v1/<identifier>/activity?limit=N` → `{ activity: ActivityEvent[] }`，置于现有 `/api/v1/<identifier>` 兜底路由之前。`HttpDashboardOptions` 加 `activityStore?`。
- **TUI 活动视图**：`TuiMode` 加 `"activity"`；详情页（`detail-running`）新键 `a` → 进入活动视图；`formatActivity` 渲染头部（task id、model、agent、variant、turn、tokens）＋可滚动事件列表（助手文本/工具调用/step tokens），复用 logs 模式的 `j/k`/`PgUp`/`PgDn` 滚动 + `Esc/q` 返回。详情页补 `Agent/Model/Variant` 行与 `a 活动视图` 提示。进程内 TUI 直读 `ActivityStore`；远端 TUI 进入该模式时拉取活动端点（1Hz，仿 fetchLogs）。
- **需求2 分析（不实现）**：`design.md` 记录可行性与必要性——turn 边界注入（待注入提示缓冲 → continuation guidance 拼接）可行且低风险，真·实时注入需 server 模型（备选 B）；必要性中等（部分重复已有 Jira 评论→下 turn MCP 读取的异步纠偏路径）；若将来实现，策略为以 sentinel `💬 {user} via TUI:` 镜像回 Jira 评论以保可追溯。
- **文档/项目记忆**：`CONTEXT.md` 补 `活动视图` / `opencode 事件流` 术语；`docs/adr/0012-task-activity-capture-render.md` 记录捕获并渲染（A）优于 server 模型（B）与直读 opencode.db（C）的决策；`docs/architecture.md` / `docs/usage.md` 同步活动视图按键与端点。

## Capabilities

### New Capabilities

- `task-activity`：运行中任务的 opencode 交互流捕获（worker 增量解析 stdout 事件 → `ActivityStore` 环形缓冲）、`GET /api/v1/<id>/activity` 端点、TUI `"activity"` 模式（键 `a`）渲染助手文本/工具调用/tokens/模型，以及 per-issue 详情暴露 `agent`/`model`/`variant`。

### Modified Capabilities

- `opencode-worker`：`runDefaultSubprocess` SHALL 增量解析 opencode stdout 事件并经 `onOpencodeEvent` 回调；`runAttempt` SHALL 经 `onActivity` 把带 `turn` 的 `ActivityEvent` 上报；`turn_started` WorkerEvent SHALL 携带 `agent`/`model`/`variant`。
- `terminal-dashboard`：`detail-running` SHALL 显示 `Agent/Model/Variant` 并支持 `a` 键进入活动视图；新 `activity` 模式 SHALL 滚动渲染 `ActivityEvent[]`，`Esc/q` 返回详情。

## Impact

- `src/worker/runner.ts`：`buildOpencodeCommand` 不变；`runDefaultSubprocess` 加 `onOpencodeEvent` 回调 + 行缓冲；新增 `parseOpencodeLine`；`RunAttemptOptions` 加 `onActivity`；`spawnRunner` 类型加可选回调尾参（旧 5 参 mock 仍可赋值，零回归）；turn 循环调用 spawnRunner 时传入回调；`turn_started` 事件携带 agent/model/variant。
- `src/observability/activity-store.ts`：新文件。
- `src/observability/http-dashboard.ts`：`HttpDashboardOptions` 加 `activityStore?`；新 `/api/v1/<id>/activity` 路由（置于兜底前）；`lookupIssue` running 分支加 `agent`/`model`/`variant`。
- `src/observability/snapshot.ts`：running 行映射加 `agent`/`model`/`variant`。
- `src/observability/terminal-dashboard.ts`：`TuiMode` 加 `activity`；`TerminalDashboardOptions` 加 `activityStore?` / `fetchActivity?`；`processKey` 加 `a`（detail-running）+ `j/k`/`Esc/q` 在 activity 模式；新 `enterActivity`/`exitActivity`/`formatActivity`/`scrollActivity` + 远端 fetch；`formatRunningDetailFromState`/`FromSnapshot` 补 model 行与按键提示。
- `src/shared/types.ts`：`RunningEntry` + `RuntimeSnapshot` running 行加 `agent`/`model`/`variant`（`string | null`）。
- `src/scheduler/scheduler.ts`：持有 `ActivityStore`；`runWorker` 传 `onActivity`；`onEvent` 写回 agent/model/variant；`onWorkerExit` 清缓冲。
- `src/cli/index.ts`：构造 `HttpDashboard` / `TerminalDashboard` 时注入 `activityStore`（in-process 直连，远端经 fetchActivity）。
- `tests/`：`worker.test.ts` 加 `parseOpencodeLine` + 增量回调 + `onActivity` 用例；新 `activity-store.test.ts`；`http-dashboard.test.ts`（若存在）加 activity 端点 + per-issue model 字段；`terminal-dashboard` 渲染快照加 activity 模式与 model 行。
- `docs/architecture.md`、`docs/usage.md`：活动视图按键与端点；`CONTEXT.md`、`docs/adr/0012-*.md`。
- 无新增运行时依赖；纯增量，不改 config schema、不动 scheduler 的 poll/reconcile/retry 语义、不改 spawn-per-turn 模型。
