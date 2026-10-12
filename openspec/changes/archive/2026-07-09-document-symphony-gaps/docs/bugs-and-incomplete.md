# 两边都有但 tasking 有 bug 或不完善

> 以下能力在 tasking 中有代码实现,但存在 bug、缺失关键逻辑、或不完善。

## 1. `turn_count` 恒为 0

**位置:** `scheduler.ts:197`(初始化 `turn_count: 0`)、`scheduler.ts:246-253`(`onEvent` 不递增)

`RunningEntry.turn_count` 在 dispatch 时设为 0,之后永远不变。runner 有本地 turn 计数器但不回传 scheduler。snapshot 读出永远 0。

**Symphony:** `integrate_codex_update` 在收到 `session_started` 事件且 `session_id` 变化时递增。

**修复:** runner 在每个 turn 开始时发 `turn_started` 事件,scheduler `onEvent` 递增。

## 2. `last_message` 恒为 null

**位置:** `scheduler.ts:194`(初始化 `last_message: null`)、`scheduler.ts:246-253`(`onEvent` 只写 `last_event`/`last_event_at`)

`onEvent` 回调不写 `last_message`。运行中快照的 `last_message` 永远是 null。

**Symphony:** `integrate_codex_update` 每事件调用 `summarize_codex_update(update)` 更新 `last_codex_message`。

**修复:** `onEvent` 写入 `event.message` 或人类可读摘要。

## 3. `rate_limits` 永远 null

**位置:** `shared/types.ts:110`(`rate_limits` 字段存在)、`scheduler.ts`(从不写入)

`OrchestratorRuntimeState.rate_limits` 类型存在但从不赋值。

**Symphony:** `apply_codex_rate_limits/2` + `extract_rate_limits/1` 从事件提取并写入 `state.codex_rate_limits`。

**修复:** runner 从 opencode JSON 事件流提取 rate-limit 字段,通过 `onEvent` 传递,scheduler 更新。

## 4. `last_reported_*_tokens` 字段死代码

**位置:** `shared/types.ts:71-73`(字段定义)、`scheduler.ts`(从不读写)

`RunningEntry` 有 `last_reported_input_tokens`/`last_reported_output_tokens`/`last_reported_total_tokens`,但从不读写。token 累加用 `entry.input_tokens += event.usage.input_tokens`——无去重,如果 worker 报告累积绝对值会重复计数。

**Symphony:** `extract_token_delta/2` + `compute_token_delta/4` 用 `max(reported, next)` 做单调去重。

**修复:** `onEvent` 使用 `last_reported_*` 做 delta 计算:`delta = max(0, next - last_reported)`;累加 `delta`;更新 `last_reported = next`。

## 5. per-tick dispatch 预校验缺失

**位置:** `scheduler.ts:138-184`(`tick()` 不调 `validateDispatchConfig`)

`validateDispatchConfig` 在 `validator.ts:9` 定义但只在 `validateStartupConfig` 中调用。`tick()` 从 reconcile 直接跳到 fetch 候选,不做预校验。spec 已要求(场景"校验失败跳过派发但保留 reconcile")。

**Symphony:** `maybe_dispatch` 每次调用 `Config.validate!/0`。

**修复:** `tick()` 在 reconcile 后、fetch 前调 `validateDispatchConfig`。

## 6. `session_id` 不在运行中更新

**位置:** `scheduler.ts:192`(dispatch 时设 `session_id: sessionId ?? null`)、`scheduler.ts:246-253`(`onEvent` 不更新 `session_id`)

`session_id` 只在 dispatch 时设置(通常 null),worker 运行中从事件流提取的 session ID 不回传。只有 `AttemptResult.session_id` 在 worker 结束后才更新。

**Symphony:** `integrate_codex_update` 每事件调用 `session_id_for_update` 更新。

**修复:** runner 通过 `onEvent` 回传 session ID,scheduler 更新 `entry.session_id`。

## 7. reconcile 终止路径不记录 totals

**位置:** `scheduler.ts:427-428`(terminal → abort + delete)、`scheduler.ts:437-438`(非活跃 → abort + delete)

`reconcileTrackerStates` 终止 worker 时不调用 `totals.seconds_running += elapsed`,不累加 token。只有 `onWorkerExit` 记录 totals。

**Symphony:** `terminate_running_issue` 总是调用 `record_session_completion_totals`。

**修复:** 抽取 `recordTotals(entry)` 方法,在所有终止路径调用。

## 8. reconcile 终止路径不清理 `claimed`

**位置:** `scheduler.ts:427-428`、`scheduler.ts:437-438`

终止 worker 时只删 `running`,不删 `claimed`。`claimed` 集合在这些路径下会无限增长。

**Symphony:** `terminate_running_issue` 一次性删 running/claimed/blocked/retry_attempts。

**修复:** 抽取 `terminateRunning(taskId, cleanup)` 方法,统一清理所有集合。

## 9. `normalize_issue_state` 不一致

**位置:** `scheduler.ts:63`(`isDispatchEligible`: `task.state.toLowerCase().replace(/\s+/g, "")`)、`scheduler.ts:86,90`(`hasStateSlot`: 只 `toLowerCase()`)

同一个状态 `"In Progress"` 在 `isDispatchEligible` 中变成 `"inprogress"`,在 `hasStateSlot` 中变成 `"in progress"`——两者不匹配。

**Symphony:** `normalize_issue_state/1` 统一 `String.downcase(String.trim(state_name))`。

**修复:** 提取 `normalizeState(state: string): string` 函数,所有地方统一调用。

## 10. per-state 并发无回退到全局上限

**位置:** `scheduler.ts:86`(`config.agent.max_concurrent_agents_by_state[task.state.toLowerCase()]`)

未配置的状态返回 `undefined`,后续 `>= (undefined + 1)` 产生 `NaN`,比较失败。

**Symphony:** `max_concurrent_agents_for_state/1` 未配置时回退到 `max_concurrent_agents`。

**修复:** `const limit = config.agent.max_concurrent_agents_by_state[normalizedState] ?? config.agent.max_concurrent_agents`。

## 11. `running_seconds` 不钳零

**位置:** `scheduler.ts:278`(`(result.ended_at - entry.started_at) / 1000`)

时钟偏移(`ended_at < started_at`)会产生负值。

**Symphony:** `running_seconds/2` 用 `max(0, ...)`。

**修复:** `Math.max(0, (result.ended_at - entry.started_at) / 1000)`。

## 12. `after_run` 不在 try/finally 中

**位置:** `runner.ts:152-289`

turn 循环异常时 `after_run` hook 被跳过。

**Symphony:** `agent_runner.ex` 用 `try/after` 保证 `after_run` 执行。

**修复:** 将 turn 循环包在 try/finally 中,finally 块调 `after_run`。

## 13. `opencode.command.split(/\s+/)` 破坏含空格命令

**位置:** `runner.ts:67-68`(`config.opencode.command.split(/\s+/)`)

如果命令含引号空格(如 `"opencode run --config key='a b'"`),split 会错误拆分。

**Symphony:** 通过 `bash -lc <command>` 整体传递,shell 负责解析。

**修复:** 用 `spawn("bash", ["-lc", config.opencode.command + " " + args.join(" ")])` 或用 shell-quote 库。

## 14. query-string 导致路由 404

**位置:** `http-dashboard.ts:30-50`(`req.url === "/api/v1/state"`)

`req.url` 含 query string(`/api/v1/state?x=1`),`===` 匹配失败返回 404。

**Symphony:** Phoenix 路由分离 path/query。

**修复:** 用 `new URL(req.url, "http://localhost").pathname` 提取路径。

## 15. HTTP 方法不校验(无 405)

**位置:** `http-dashboard.ts:30-50`(只按 URL 分支,不检查 method)

`POST /api/v1/state` → 200(应 405);`GET /api/v1/refresh` → 202(应 405)。

**Symphony:** `match :*` 路由返回 405。

**修复:** 每个路由增加 method 检查,不匹配返回 405。

## 16. `POST /api/v1/refresh` 是空操作

**位置:** `http-dashboard.ts:59-62`(返回 `{queued:true, requested_at}` 但不触发任何操作)

**Symphony:** `Orchestrator.request_refresh/1` 调用 `schedule_tick(state, 0)` 真触发。

**修复:** scheduler 新增 `requestRefresh()` 方法,HTTP handler 调用它。

## 17. `GET /api/v1/<identifier>` 不存在

**位置:** `http-dashboard.ts`(无此路由)

`/api/v1/ABC-123` 落到 404。

**Symphony:** `observability_api_controller.ex:17` 返回单 issue 详情。

**修复:** 新增 `GET /api/v1/:identifier` 路由。

## 18. 快照无 `timeout`/`unavailable` 错误模式

**位置:** `snapshot.ts`(同步返回,不会失败)

**Symphony:** `Orchestrator.snapshot/2` 是 GenServer call,可超时/不可用。

**修复:** 可选——给 `buildSnapshot` 加 try-catch 返回 `{error: {code: "snapshot_unavailable"}}`。

## 19. `0.0.0.0` 绑定(有意偏差,但应可配置)

**位置:** `http-dashboard.ts:23`(`const host = "0.0.0.0"`)

用户有外部访问需求故绑 `0.0.0.0`,但无法通过配置切换为 loopback。

**Symphony:** 默认 `127.0.0.1`,可配置 `server.host`。

**修复:** 新增 `server.host` 配置,默认 `0.0.0.0`(保持当前行为)但可改为 `127.0.0.1`。

## 20. 快照缺 `workspace_path`

**位置:** `snapshot.ts:4-23`(`buildSnapshot` 不输出 `workspace_path`)

`RunningEntry` 有 `workspace_path` 字段但快照不暴露。

**Symphony:** 快照 running/retrying 行都含 `workspace_path`。

**修复:** `buildSnapshot` 输出 `entry.workspace_path`。

## 21. `blocked_by` 关系类型大小写敏感

**位置:** `tracker.ts:210`(`typeName !== "Blocks" && typeName !== "Blocked"`)

只匹配精确大小写 `"Blocks"`/`"Blocked"`,不匹配 `"blocks"`。

**Symphony:** `Issue` 模块 case-insensitive 匹配 `blocks`。

**修复:** `typeName.toLowerCase() === "blocks" || typeName.toLowerCase() === "blocked"`。

## 22. `branch_name`/`url` 恒 null

**位置:** `tracker.ts:174-175`(`branch_name: null, url: null`)

Jira issue 有可构造的 URL,但不填充。

**Symphony:** 从 Linear 的 `branchName`/`url` 字段填充。

**修复:** 至少构造 Jira issue URL:`${endpoint}/browse/${key}`。

## 23. 配置数值无范围校验

**位置:** `config/resolver.ts`(`asNumber` 不校验范围)

`interval_ms: 0`、`max_concurrent_agents: -1`、`max_turns: 0` 等都被接受。

**Symphony:** Ecto `validate_number` 强制 `> 0` 或 `>= 0`。

**修复:** `asNumber` 加可选 min 参数,`resolver` 传入范围约束。

## 24. `hook_timeout` 错误类别从不产生

**位置:** `errors.ts`(`hook_timeout` 枚举存在)、`workspace/manager.ts:146-160`(`runHook` 用 `execFileSync` timeout 但返回通用失败)

hook 超时被归类为通用 `hook_failed`,不是 `hook_timeout`。

**Symphony:** `{:workspace_hook_timeout, hook_name, timeout_ms}` 标记错误。

**修复:** `execFileSync` 的超时异常检测 `e.code === "ETIMEDOUT"`,返回 `hook_timeout`。

## 25. 默认 prompt 模板过于简陋

**位置:** `prompt.ts` `DEFAULT_PROMPT = "You are working on an issue from the tracker."`

纯字符串,无模板变量,无 issue 上下文注入。

**Symphony:** Solid 模板引用 `issue.identifier`/`title`/`description`。
