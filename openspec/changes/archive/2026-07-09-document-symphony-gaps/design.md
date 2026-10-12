## Context

`tasking` 移植了 Symphony SPEC 约 80% 的协调模型。经过对 Symphony 仓库全部文件的逐行比对,识别出约 100 项差异。完整差异文档见 `docs/` 目录下 6 份文档。

本设计关注实施层面的关键技术决策——即 `recommendations.md` 中 P0-P4 的 48 项修复/补齐如何落地。

现状:
- 安全:`isWithinRoot` 纯词法,可被 symlink 绕过;`workspace == root` 被允许
- 正确性:`turn_count`/`last_message`/`rate_limits` 恒为初始值;per-tick 预校验不调;reconcile 终止不清理 `claimed`/不记录 totals;`normalize_state` 不一致;per-state 并发无回退;continuation retry 无 `attempt==1` 守卫;退避无指数封顶;`after_run` 不在 try/finally;`blocked_by` 大小写敏感;配置数值无范围校验
- HTTP:query-string 导致 404;无 405;refresh 空操作;无 `GET /:id`;字段名/时间格式不对齐
- 可观测性:token 无去重;`rate_limits` 不提取;`session_id` 运行中不更新;无文件日志;无 pub/sub
- TUI:完全无

干系人:希望 tasking 达到与 Symphony 功能对等的运维者与开发者。

## Goals / Non-Goals

**Goals:**
- 修复全部 P0(安全)和 P1(正确性 bug)项
- 补齐 P2(HTTP 仪表板)和 P3(可观测性)项
- 新增 P4(终端 TUI)项
- 补齐 P5(测试)和 P6(文档)项
- 记录永久不补齐的取舍

**Non-Goals:**
- 不实现 Codex app-server JSON-RPC 协议
- 不实现 SSH worker 扩展
- 不实现 approval/user-input/dynamic-tool 协议层
- 不实现 `.codex/skills/` 技能系统
- 不实现 Phoenix LiveView
- 不实现 `linear_graphql` 动态工具
- 不实现 100% 覆盖率阈值
- 不实现 guardrails 确认横幅

## Decisions

### 决策 1:symlink 安全校验用 `realpathSync`
`isWithinRoot` 改用 `fs.realpathSync()` 解析工作区路径和 root 后做前缀匹配。路径不存在时回退 `path.resolve`。新增 `workspace_equals_root` 守卫(`rel === ""` → 拒绝)。

### 决策 2:turn_count 通过 runner 发 `turn_started` 事件递增
runner 在 turn 循环内每个 turn 开始时 `events.onEvent({event: "turn_started", turn, message})`;scheduler `onEvent` 收到 `turn_started` 时 `entry.turn_count++`。同时 `onEvent` 更新 `last_message`(`event.message` 或摘要)和 `session_id`(`event.session_id`)。

### 决策 3:统一终止 `terminateRunning(taskId, cleanup)`
抽取方法:记录 totals → 可选清理工作区 → abort → 删 running/claimed/retry_attempts。所有终止路径(reconcile terminal/非活跃/stall/worker exit)统一调用。

### 决策 4:token 去重用 `last_reported_*` delta 计算
`onEvent` 收到 usage 时:`delta = max(0, next - entry.last_reported)`;`entry.input_tokens += delta`;`entry.last_reported = next`。防止累积绝对值重复计数。

### 决策 5:HTTP 路由重构
用 `new URL(req.url, "http://localhost").pathname` 提取路径。每路由加 method 检查 → 405。`POST /api/v1/refresh` 调 `scheduler.requestRefresh()`(设置 `refreshRequested` 标志,`tick()` 检查)。新增 `GET /api/v1/:identifier` 路由。响应字段名对齐(`codex_totals`、ISO 8601)。

### 决策 6:文件日志用简单轮转
`ConsoleLogger` 扩展多 sink(stderr + 可选文件)。文件按 10MB rename 轮转(`.1`/`.2`/.../`.5`),不引入外部依赖。TUI 启用时日志仅写文件。

### 决策 7:终端 TUI 为独立模块
新 `src/observability/terminal-dashboard.ts`,`setInterval` 驱动,定时调 `buildSnapshot()` 格式化 ANSI 彩色文本,`process.stderr.write` 输出(清屏+重绘)。节流去重(内容指纹相同不重绘)。`--tui` 启用。包含:运行中表格、退避队列、汇总栏、sparkline。

### 决策 8:pub/sub 用 EventEmitter
`Scheduler` extends `EventEmitter`;dispatch/workerExit/retry/reconcile 时 emit。HTTP dashboard 和 TUI 可订阅触发刷新。

## Risks / Trade-offs

- **[风险] `realpathSync` 路径不存在时抛异常** → 先 `existsSync` 再 `realpathSync`,catch 回退 `path.resolve`
- **[风险] TUI 与日志争抢 stderr** → TUI 启用时日志仅写文件 sink
- **[权衡] 文件轮转用 rename 非原子** → 极端情况可能丢几行,可接受
- **[权衡] `0.0.0.0` 绑定保持** → 有意偏差(用户需外部访问),新增 `server.host` 可配置
