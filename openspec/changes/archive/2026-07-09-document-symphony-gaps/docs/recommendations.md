# tasking 建议补齐/修复优先级清单

> 准则:对 tasking 有**实质性帮助**——提升安全性、正确性、可观测性或运维效率。
> 不包含永久有意取舍(见 `gap-analysis.md`)。
> 基于 tasking 使用 opencode run(Jira/TS)的实际情况,不盲目照搬 Symphony 的 Elixir/Codex/Linear 特有机制。

## P0 — 安全必修(立即修复)

| # | 项目 | 文件 | 修复方案 | 理由 |
|---|---|---|---|---|
| 1 | symlink 安全路径校验 | `workspace/manager.ts` `isWithinRoot` | `fs.realpathSync()` 解析后前缀匹配;不存在时回退 `path.resolve` | 当前纯词法 `relative()` 可被 symlink 逃逸绕过,是安全漏洞 |
| 2 | `workspace_equals_root` 守卫 | `workspace/manager.ts` | `rel === ""` 时拒绝(不允许 workspace == root) | 当前允许在 root 目录本身操作 |

## P1 — 正确性 bug 修复(高优先)

| # | 项目 | 文件 | 修复方案 | 理由 |
|---|---|---|---|---|
| 3 | `turn_count` 恒为 0 | `runner.ts` + `scheduler.ts` | runner 每个 turn 开始发 `turn_started` 事件;scheduler `onEvent` 递增 | 仪表板永远显示 0 turn,运维盲区 |
| 4 | `last_message` 恒为 null | `scheduler.ts` `onEvent` | 写入 `event.message` 或摘要 | 运维看不到 agent 当前在做什么 |
| 5 | per-tick 预校验缺失 | `scheduler.ts` `tick()` | reconcile 后调 `validateDispatchConfig` | spec 已要求;配置漂移时仍派发 |
| 6 | reconcile 终止不清理 `claimed` | `scheduler.ts` | 抽取 `terminateRunning(taskId, cleanup)` 统一删 running/claimed/retry_attempts | `claimed` 集合无限增长 |
| 7 | reconcile 终止不记录 totals | `scheduler.ts` | `terminateRunning` 内调 `recordTotals(entry)` | 运行时秒数统计不准 |
| 8 | `normalize_issue_state` 不一致 | `scheduler.ts` | 提取 `normalizeState(s)` = `s.trim().toLowerCase()`,统一调用 | `"In Progress"` 在不同路径映射为不同值 |
| 9 | per-state 并发无回退 | `scheduler.ts` `hasStateSlot` | `?? config.agent.max_concurrent_agents` | 未配置状态返回 undefined,比较失败 |
| 10 | continuation retry `attempt==1` 守卫 | `scheduler.ts` `scheduleRetry` | `continuation && attempt === 1` 才用 1000ms | 高 attempt 的 continuation 也用 1000ms 不合理 |
| 11 | 退避指数封顶 | `scheduler.ts` `computeBackoffDelay` | `Math.min(attempt - 1, 10)` | 高 attempt 产生 Infinity |
| 12 | `running_seconds` 不钳零 | `scheduler.ts` `onWorkerExit` | `Math.max(0, ...)` | 时钟偏移产生负值 |
| 13 | `after_run` 不在 try/finally | `runner.ts` | turn 循环包 try/finally | 异常跳过 after_run hook |
| 14 | `blocked_by` 大小写敏感 | `tracker.ts` | `.toLowerCase()` | 漏匹配 `"blocks"` |
| 15 | `branch_name`/`url` 恒 null | `tracker.ts` | 至少构造 Jira URL: `${endpoint}/browse/${key}` | 丢弃可用信息 |
| 16 | 配置数值无范围校验 | `config/resolver.ts` `asNumber` | 加 min 参数,调用方传范围 | `interval_ms: 0` 被接受 |
| 17 | `hook_timeout` 从不产生 | `workspace/manager.ts` `runHook` | 检测 `e.code === "ETIMEDOUT"` → 返回 `hook_timeout` | 超时归为通用失败 |

## P2 — HTTP 仪表板补齐(中优先)

| # | 项目 | 文件 | 修复方案 | 理由 |
|---|---|---|---|---|
| 18 | query-string 导致 404 | `http-dashboard.ts` | `new URL(req.url,...).pathname` 替代 `req.url ===` | `/api/v1/state?x=1` 返回 404 |
| 19 | HTTP 方法不校验 | `http-dashboard.ts` | 每路由加 method 检查,不匹配返回 405 | `POST /api/v1/state` 返回 200 |
| 20 | `POST /api/v1/refresh` 空操作 | `http-dashboard.ts` + `scheduler.ts` | scheduler 新增 `requestRefresh()`,HTTP 调用它 | 返回 202 但不做任何事 |
| 21 | `GET /api/v1/:identifier` 缺失 | `http-dashboard.ts` | 新增路由,查 running/retrying 状态 | 无法查单 issue 详情 |
| 22 | 快照缺 `workspace_path` | `snapshot.ts` | 输出 `entry.workspace_path` | 运维需要知道工作区路径 |
| 23 | 快照时间戳格式 | `snapshot.ts` | epoch ms → ISO 8601 | 与 SPEC 推荐一致 |
| 24 | `totals` → `codex_totals` | `snapshot.ts` | 重命名 | 与 SPEC 推荐一致 |
| 25 | `server.host` 配置 | `config-types.ts` + `http-dashboard.ts` | 新增 `server.host`(默认 `0.0.0.0` 保持当前行为) | 可切换为 loopback |

## P3 — 可观测性增强(中优先)

| # | 项目 | 文件 | 修复方案 | 理由 |
|---|---|---|---|---|
| 26 | token 去重 | `scheduler.ts` `onEvent` | 用 `last_reported_*` 做 delta 计算 | 重复计数风险 |
| 27 | `rate_limits` 提取 | `runner.ts` + `scheduler.ts` | 从 opencode JSON 提取,通过 `onEvent` 传递 | 字段存在但永远 null |
| 28 | `session_id` 运行中更新 | `scheduler.ts` `onEvent` | 从 `event.session_id` 更新 `entry.session_id` | 只有 worker 结束才更新 |
| 29 | 文件日志 sink | `logger.ts` + `config-types.ts` | 多 sink(stderr + 可选文件),10MB×5 轮转 | `tasking logs` 读的文件无人写 |
| 30 | 观察者 pub/sub | `scheduler.ts` | EventEmitter,状态变更时 emit | 仪表板无实时更新 |
| 31 | `0.0.0.0` 日志误导 | `cli/index.ts` | 日志输出实际绑定地址 | 日志写 `127.0.0.1` 但实际绑 `0.0.0.0` |

## P4 — 终端 TUI(可选增强)

| # | 项目 | 文件 | 修复方案 | 理由 |
|---|---|---|---|---|
| 32 | 终端 TUI 状态面板 | 新 `src/observability/terminal-dashboard.ts` | ANSI 彩色表格 + sparkline + 汇总栏,定时拉 snapshot 重绘,`--tui` 启用 | Symphony 核心运维面,tasking 完全没有 |
| 33 | TUI 与日志互不干扰 | `logger.ts` | TUI 启用时日志仅写文件 | 避免 stderr 争抢 |
| 34 | codex 事件人类可读摘要 | 新 `src/observability/event-humanizer.ts` | 对标 Symphony `humanize_codex_message`(~30 种事件) | TUI EVENT 列需要 |

## P5 — 测试覆盖补齐(持续)

| # | 项目 | 修复方案 | 理由 |
|---|---|---|---|
| 35 | symlink 逃逸拒绝测试 | workspace test | P0 #1 的回归测试 |
| 36 | turn_count 递增测试 | scheduler test | P1 #3 的回归测试 |
| 37 | per-tick 预校验测试 | scheduler test | P1 #5 的回归测试 |
| 38 | 消失的 issue reconciliation 测试 | scheduler test | tracker 不返回的运行中 issue 应终止 |
| 39 | reconcile 标签移除测试 | scheduler test | 标签被移除的运行中 issue 应停止 |
| 40 | hook 超时测试 | workspace test | P1 #17 的回归测试 |
| 41 | 405 method-not-allowed 测试 | http-dashboard test | P2 #19 的回归测试 |
| 42 | `GET /api/v1/:id` 测试 | http-dashboard test | P2 #21 的回归测试 |
| 43 | refresh 真触发测试 | scheduler test | P2 #20 的回归测试 |
| 44 | token 去重测试 | scheduler test | P3 #26 的回归测试 |

## P6 — 文档与约定(低优先)

| # | 项目 | 修复方案 | 理由 |
|---|---|---|---|
| 45 | 日志约定文档 | 新 `docs/logging.md` | 规范上下文字段、措辞、每模块范围 |
| 46 | token 记账规则文档 | 新 `docs/token-accounting.md` | 记录 total-vs-delta 规则(适配 opencode 事件模型) |
| 47 | PR 模板 | 新 `.github/pull_request_template.md` | 规范 PR 结构 |
| 48 | 架构流程图 | 新 `docs/flow.html` 或 SVG | 可视化参考 |

## 明确不补齐(永久有意取舍)

| 项目 | 理由 |
|---|---|
| Codex app-server JSON-RPC 协议(§10) | `opencode run` CLI 是稳定入口,协议耦合是维护风险 |
| SSH worker 扩展(附录 A) | 单机模型对 v1 足够 |
| approval/user-input/dynamic-tool 协议层(§10.5) | opencode CLI 自行处理 |
| `linear_graphql` 动态工具 | 用 MCP `jira_rest` 替代 |
| Phoenix LiveView websocket | 用 SSE 或客户端轮询替代 |
| Erlang 热代码重载 | Node 不原生支持 |
| `.codex/skills/` 6 个技能 | 与 tasking 的 opencode agent 模型不同;建议在 WORKFLOW.md prompt 中融入关键约定(commit 格式、PR 流程等)而非移植技能系统 |
| `tracker.kind: "memory"` 测试适配器 | 可用 mock 替代 |
| `mix specs.check` / `mix pr_body.check` / `mix workspace.before_remove` | Elixir 特有;TS 用 tsc + biome + 自定义脚本替代 |
| 100% 覆盖率阈值 | 过于严格;设 80% 更实际 |
| guardrails 确认横幅 | 过于仪式化;在文档中说明安全姿态即可 |
