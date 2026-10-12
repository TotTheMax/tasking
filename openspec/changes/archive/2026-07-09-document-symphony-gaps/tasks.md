## 1. 安全 — symlink 路径校验(P0)

- [x] 1.1 `src/workspace/manager.ts`: `isWithinRoot` 改用 `fs.realpathSync()` 解析后前缀匹配;路径不存在时回退 `path.resolve`
- [x] 1.2 `src/workspace/manager.ts`: 新增 `workspace_equals_root` 守卫(`rel === ""` → 拒绝)
- [x] 1.3 `tests/workspace.test.ts`: symlink 逃逸拒绝测试 + workspace==root 拒绝测试 + 不存在路径回退测试

## 2. 调度器 — 正确性 bug 修复(P1)

- [x] 2.1 `src/scheduler/scheduler.ts`: `tick()` 在 reconcile 后调 `validateDispatchConfig`;失败则 skip fetch+dispatch
- [x] 2.2 `src/worker/runner.ts`: turn 循环内每个 turn 开始发 `events.onEvent({event:"turn_started", turn, message})`
- [x] 2.3 `src/scheduler/scheduler.ts`: `onEvent` 收到 `turn_started` 时 `entry.turn_count++`;同时写 `entry.last_message`、更新 `entry.session_id`
- [x] 2.4 `src/scheduler/scheduler.ts`: 抽取 `terminateRunning(taskId, cleanup)` 统一删 running/retry_attempts + 记录 totals;所有终止路径调用
- [x] 2.5 `src/scheduler/scheduler.ts`: 提取 `normalizeState(s)` = `s.trim().toLowerCase()`;`isDispatchEligible`/`hasStateSlot` 统一调用
- [x] 2.6 `src/scheduler/scheduler.ts`: `hasStateSlot` 未配置状态回退到 `config.agent.max_concurrent_agents`
- [x] 2.7 `src/scheduler/scheduler.ts`: `scheduleRetry` continuation 仅 `attempt === 1` 时用 1000ms
- [x] 2.8 `src/scheduler/scheduler.ts`: `computeBackoffDelay` 指数封顶 `Math.min(attempt - 1, 10)`
- [x] 2.9 `src/scheduler/scheduler.ts`: `onWorkerExit` `running_seconds` 钳零 `Math.max(0, ...)`
- [x] 2.10 `src/scheduler/scheduler.ts`: `onEvent` 用 `last_reported_*` 做 token delta 去重
- [x] 2.11 `src/worker/runner.ts`: turn 循环包 try/finally,finally 调 `after_run`
- [x] 2.12 `src/adapters/jira/tracker.ts`: `blocked_by` 关系类型 `.toLowerCase()` 匹配
- [x] 2.13 `src/adapters/jira/tracker.ts`: `normalizeIssue` 填充 `url`(`${endpoint}/browse/${key}`)
- [x] 2.14 `src/config/resolver.ts`: `asNumber` 加可选 min 参数,调用方传范围约束
- [x] 2.15 `src/workspace/manager.ts`: `runHook` 检测 `e.code === "ETIMEDOUT"` → 返回 `hook_timeout`
- [x] 2.16 `tests/scheduler.test.ts`: turn_count 递增 + tick 预校验 + 统一终止 + normalizeState 一致性 + per-state 回退 + continuation 守卫 + 退避封顶 + token 去重 测试
- [x] 2.17 `tests/worker.test.ts`: `turn_started` 事件发射 + try/finally after_run 测试
- [x] 2.18 `tests/workspace.test.ts`: hook 超时测试
- [x] 2.19 `tests/tracker.test.ts`: blocked_by 大小写 + url 填充测试

## 3. HTTP 仪表板补齐(P2)

- [x] 3.1 `src/observability/http-dashboard.ts`: 用 `new URL(req.url,...).pathname` 替代 `req.url ===`
- [x] 3.2 `src/observability/http-dashboard.ts`: 每路由加 method 检查 → 405
- [x] 3.3 `src/scheduler/scheduler.ts`: 新增 `requestRefresh()` 方法(设 `refreshRequested` 标志);`tick()` 开头检查
- [x] 3.4 `src/observability/http-dashboard.ts`: `POST /api/v1/refresh` 调 `scheduler.requestRefresh()`;响应加 `coalesced`/`operations`
- [x] 3.5 `src/observability/http-dashboard.ts`: 新增 `GET /api/v1/:identifier` 路由
- [x] 3.6 `src/observability/snapshot.ts`: 输出 `entry.workspace_path`;时间戳改 ISO 8601;`totals` → `codex_totals`
- [x] 3.7 `src/config/config-types.ts`: 新增 `server.host`(默认 `0.0.0.0`)
- [x] 3.8 `src/observability/http-dashboard.ts`: 用 `config.server.host` 替代硬编码
- [x] 3.9 `tests/`: 405 测试 + query-string 测试 + refresh 真触发测试 + `GET /:id` 测试 + 字段对齐测试

## 4. 可观测性增强(P3)

- [x] 4.1 `src/worker/runner.ts`: 从 opencode JSON 提取 rate-limit 字段,通过 `onEvent` 传递
- [x] 4.2 `src/scheduler/scheduler.ts`: `onEvent` 更新 `state.rate_limits`
- [x] 4.3 `src/observability/logger.ts`: 多 sink(stderr + 可选文件);文件 10MB×5 rename 轮转
- [x] 4.4 `src/config/config-types.ts`: 新增 `logging.file` 配置(路径、轮转大小、备份数)
- [x] 4.5 `src/cli/daemon.ts`: 启动时初始化文件 sink
- [x] 4.6 `src/scheduler/scheduler.ts`: extends `EventEmitter`;dispatch/workerExit/retry/reconcile 时 emit
- [x] 4.7 `src/observability/http-dashboard.ts`: 订阅 scheduler 事件,触发刷新
- [x] 4.8 `src/cli/index.ts`: 日志输出实际绑定地址(修复 `127.0.0.1` 误导)
- [x] 4.9 `tests/`: rate_limits 测试 + 文件日志测试 + pub/sub 测试

## 5. 终端 TUI 状态面板(P4)

- [x] 5.1 `src/observability/terminal-dashboard.ts`: 新文件;`TerminalDashboard` 类 `start(intervalMs)`/`stop()`;定时调 `buildSnapshot()` 格式化渲染
- [x] 5.2 实现运行中任务表格(ID/STATE/AGE/TURN/TOKENS/SESSION/EVENT)
- [x] 5.3 实现退避队列(标识符/attempt/倒计时/error)
- [x] 5.4 实现汇总栏(agents/tps/runtime/tokens)
- [x] 5.5 实现 sparkline 吞吐量图(10 分钟窗口,24 列,`▁▂▃▄▅▆▇█`)
- [x] 5.6 实现节流去重(内容指纹相同且未超周期 → 不重绘)
- [x] 5.7 `src/observability/logger.ts`: TUI 启用时日志仅写文件
- [x] 5.8 `src/cli/index.ts`: 新增 `--tui` 标志
- [x] 5.9 `tests/terminal-dashboard.test.ts`: 渲染格式测试

## 6. 测试覆盖补齐(P5)

- [x] 6.1 消失的 issue reconciliation 测试(tracker 不返回的运行中 issue → 终止)
- [x] 6.2 reconcile 标签移除测试(标签被移除的运行中 issue → 停止)
- [x] 6.3 reconcile assignee 变更测试(assignee 被改的运行中 issue → 停止)

## 7. 文档(P6)

- [x] 7.1 `docs/logging.md`: 日志约定(上下文字段、措辞、每模块范围、检查清单)
- [x] 7.2 `docs/token-accounting.md`: token 记账规则(适配 opencode 事件模型的 total-vs-delta 规则)
- [x] 7.3 `.github/pull_request_template.md`: PR 模板
- [x] 7.4 `docs/architecture.md`: 更新(新增 TUI、文件日志、pub/sub 段)
- [x] 7.5 `docs/configuration.md`: 更新(新增 `server.host`、`logging.file`、`--tui`)
- [x] 7.6 `docs/usage.md`: 更新(TUI 使用、`GET /api/v1/:id` 端点)
- [x] 7.7 运行 `npm run lint && npm run typecheck && npm test` 确保全绿
