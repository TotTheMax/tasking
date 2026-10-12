## 1. 修复 B1:统一 ConfigManager(Daemon 接受外部实例)

- [x] 1.1 修改 `Daemon` 构造函数接受 `ConfigManager` 实例而非 `workflowPath` 字符串,移除内部 `ConfigManager.fromFile`
- [x] 1.2 修改 `src/cli/index.ts` `runStart` 创建单一 `ConfigManager` 并传给 `Daemon` 与 `Scheduler`
- [x] 1.3 移除 `Daemon` 中 `opts.port` 直接 mutate config 的逻辑,改为在 `runStart` 中设置 `configMgr.current.server.port`
- [x] 1.4 修复 `Daemon.scheduleTick` 死代码 ternary(B7)
- [x] 1.5 测试:配置重载传播到调度器(interval_ms 变更后 scheduler 读到新值)

## 2. 修复 B2:route agent prompt 传递

- [x] 2.1 `buildCommand` 增加末尾 prompt 参数(与 worker runner `buildOpencodeCommand` 一致)
- [x] 2.2 `runOnce` 将构建的 triage prompt 传入 `buildCommand`
- [x] 2.3 删除 `defaultSpawn` 中 `child.stdin?.end(this.buildTriagePrompt([]))` 的空 prompt 写入
- [x] 2.4 测试:验证命令行参数末尾为 triage prompt 文本

## 3. 修复 B3:route agent 决策计数

- [x] 3.1 `runOnce` 在运行前后查询 inbox 的 `countByStatus("decided")` + `countByStatus("dispatched")` + `countByStatus("rejected")` 增量
- [x] 3.2 将增量填入返回值的 `dispatched` 与 `rejected` 字段
- [x] 3.3 测试:route agent 处理后返回非零 dispatched/rejected

## 4. 修复 B4:cwd 安全不变式

- [x] 4.1 移除 `runAttempt` 中 `assertCwdIsWorkspace(workspace.path, workspace.path)` 的无效调用
- [x] 4.2 在 `runDefaultSubprocess` 中 spawn 前校验 `cwd` 参数非空且为有效路径,记录 debug 日志
- [x] 4.3 保留 `assertCwdIsWorkspace` 函数但修正其语义:校验传入的 cwd 与 workspace path 是否一致,不一致时记 warn
- [x] 4.4 测试:cwd 一致时不告警、不一致时记 warn

## 5. 修复 B5:Scheduler.stop() 清理 retry timer

- [x] 5.1 `stop()` 遍历 `state.retry_attempts`,clearTimeout 全部 timer 并清空 map
- [x] 5.2 测试:scheduler 有 retry 排队时 stop() 后不再触发 onRetry

## 6. 修复 B6:reconcile 改为 await

- [x] 6.1 `reconcileRunningIssues` 改为 `async`,`await this.reconcileTrackerStates()`
- [x] 6.2 `tick()` 改为 `await this.reconcileRunningIssues()`
- [x] 6.3 测试:reconcile 先于 dispatch 完成(terminal 任务在 dispatch 前被移除)

## 7. 回归测试:已修 bug(A 类)

- [x] 7.1 YAML parser 嵌套块测试:`tracker` 含 `required_labels: - foo` + `kind: jira` + `active_states: - To Do`,验证 kind 不丢失
- [x] 7.2 auth_mode bearer 测试:mock fetch 验证 Authorization header 为 `Bearer <token>`
- [x] 7.3 auth_mode basic 测试:mock fetch 验证 Authorization header 为 `Basic <base64>`
- [x] 7.4 endpoint trailing slash 测试:单斜杠与多斜杠都 trim 为无双斜杠 URL
- [x] 7.5 fetchIssueStatesByIds 数字 id 测试:JQL 含 `id in (10334)`(无引号)、非数字 id 含 `id in ("OS-222")`
- [x] 7.6 daemon→scheduler 接线集成测试:daemon tick 触发 scheduler.tick → fetchCandidateIssues 被调用

## 8. 补测试覆盖缺口(C 类)

- [x] 8.1 inline YAML 数组解析测试:`required_labels: [bug, urgent]` → `["bug", "urgent"]`
- [x] 8.2 worker 正常退出→续轮 retry 测试(用 fake timers 控制时序)
- [x] 8.3 worker 异常退出→退避 retry 测试(验证 delay = min(10000*2^(n-1), max))
- [x] 8.4 stall detection 测试:任务超过 stall_timeout_ms 无活动 → 终止 + retry
- [x] 8.5 terminal 状态 reconcile 清理工作区测试:工作区目录被删除
- [x] 8.6 非活跃状态(非 terminal 也非 active)reconcile 测试:停止但不清理工作区
- [x] 8.7 retry timer 触发→任务缺失→释放 claim 测试
- [x] 8.8 retry timer 触发→无槽位→重新入队测试
- [x] 8.9 per-state 并发上限测试:达到 cap 后不再派发同状态任务
- [x] 8.10 Todo blocker 门控测试:Todo 状态有非 terminal blocker 时不派发、blocker terminal 时派发
- [x] 8.11 配置重载失败保留上一良好配置测试(已有,增强:验证 scheduler 读到的 config 未变)
- [x] 8.12 HTTP dashboard `/api/v1/state` 反映调度器运行中任务测试

## 9. 全量验证

- [x] 9.1 运行 `npm run lint && npm run typecheck && npm test` 全部通过
- [x] 9.2 构建并执行 `node dist/cli/index.js --help` 确认无回归
- [x] 9.3 对照 `WORKFLOW.md.example` 与 docs 确认无文档漂移
