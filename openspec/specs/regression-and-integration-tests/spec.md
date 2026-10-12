## Purpose

回归与集成测试覆盖要求。
## Requirements
### Requirement: YAML parser 回归测试覆盖嵌套块
测试 SHALL 覆盖 `parseBlock` 对空-rest key 的递归:一个对象下的嵌套列表字段(如 `required_labels: - foo`)不丢失同级标量字段(如 `kind: jira`)。

#### Scenario: 嵌套列表不破坏同级标量
- **WHEN** 解析 `tracker:\n  kind: jira\n  required_labels:\n    - foo\n  active_states:\n    - To Do`
- **THEN** 结果中 `tracker.kind` 为 `"jira"` 且 `tracker.required_labels` 为 `["foo"]`

### Requirement: daemon 接线调度器的集成测试
测试 SHALL 验证 daemon 的 `onTick` 回调实际调用了 `Scheduler.tick()`,且配置重载会传播到调度器读取的配置。

#### Scenario: tick 调用 scheduler.tick
- **WHEN** daemon 启动并触发一次 tick
- **THEN** scheduler 的 `tick()` 被调用且 `fetchCandidateIssues` 被执行

#### Scenario: 配置重载传播到调度器
- **WHEN** `WORKFLOW.md` 变更 `polling.interval_ms` 并触发重载
- **THEN** 调度器后续 tick 使用新的 interval

### Requirement: Jira auth_mode bearer 回归测试
测试 SHALL 覆盖 `auth_mode: bearer` 时 auth header 为 `Bearer <token>`、`auth_mode: basic`(默认)时为 `Basic base64(user:token)`。

#### Scenario: bearer 模式
- **WHEN** tracker 配置 `auth_mode: bearer`、`api_key: "tok"`
- **THEN** 请求 header 为 `Authorization: Bearer tok`

#### Scenario: basic 模式(默认)
- **WHEN** tracker 配置 `api_user: "user"`、`api_key: "tok"`(无 auth_mode)
- **THEN** 请求 header 为 `Authorization: Basic <base64(user:tok)>`

### Requirement: endpoint trailing slash 回归测试
测试 SHALL 覆盖 endpoint 末尾有一个或多个斜杠时,请求 URL 不含双斜杠。

#### Scenario: 末尾单斜杠
- **WHEN** endpoint 为 `http://host/rest/api/2/`
- **THEN** 请求 URL 为 `http://host/rest/api/2/search`(无双斜杠)

#### Scenario: 末尾多斜杠
- **WHEN** endpoint 为 `http://host/rest/api/2//`
- **THEN** 请求 URL 为 `http://host/rest/api/2/search`

### Requirement: fetchIssueStatesByIds 数字 id JQL 回归测试
测试 SHALL 覆盖 `fetchIssueStatesByIds` 对纯数字 id 使用 `id in (123)`(无引号),对非数字 id 使用 `key in ("ABC")`。

#### Scenario: 数字 id 不加引号
- **WHEN** 调用 `fetchIssueStatesByIds(["10334"])`
- **THEN** JQL 含 `id in (10334)`

#### Scenario: 非数字 id 加引号
- **WHEN** 调用 `fetchIssueStatesByIds(["OS-222"])`
- **THEN** JQL 含 `id in ("OS-222")`

### Requirement: HTTP dashboard 端到端测试
测试 SHALL 覆盖 `--port` 启动后 `/api/v1/state` 返回调度器运行时状态。

#### Scenario: dashboard 反映调度器状态
- **WHEN** 调度器有运行中任务且 dashboard 已启动
- **THEN** `GET /api/v1/state` 返回 JSON 含 `counts.running >= 1`

### Requirement: route agent prompt 正确传递
route agent `runOnce` SHALL 将构建的 triage prompt 通过命令行参数传递给 `opencode run` 子进程,SHALL NOT 依赖 stdin 发送空 prompt。

#### Scenario: prompt 作为命令行参数
- **WHEN** route agent 启动子进程
- **THEN** 命令行参数末尾为 triage prompt 文本

### Requirement: route agent 决策计数
route agent `runOnce` 返回值 SHALL 反映实际决策数量:`dispatched` 与 `rejected` 从 inbox 运行前后的状态计数差值得出。

#### Scenario: 决策计数非零
- **WHEN** route agent 处理 2 个条目且全部决策为 dispatch
- **THEN** 返回值 `dispatched >= 2`

### Requirement: cwd 安全不变式真实校验
worker 启动子进程前 SHALL 校验 spawn 的 cwd 参数等于 per-task 工作区路径,SHALL NOT 传同一值作两参。

#### Scenario: cwd 不匹配时记录告警
- **WHEN** spawn cwd 与 workspace path 不一致
- **THEN** 记录 warn 级别日志且仍以 spawn cwd 为准(由调用方保证)

### Requirement: scheduler stop 清理 retry timer
`Scheduler.stop()` SHALL 清理所有 retry timer,SHALL NOT 在关闭后触发 `onRetry`。

#### Scenario: stop 后无 retry 触发
- **WHEN** 调度器有 retry 排队且调用 `stop()`
- **THEN** 所有 retry timer 被清理,不再调用 `fetchCandidateIssues`

### Requirement: reconcile 在 dispatch 前完成
`tick()` SHALL `await` reconcile 完成,SHALL NOT fire-and-forget tracker 状态刷新。

#### Scenario: reconcile 先于 dispatch
- **WHEN** 一个 tick 内 reconcile 发现任务 terminal 且 dispatch 候选中含同任务
- **THEN** dispatch 前任务已被从 running 移除,不会重复派发

### Requirement: 测试覆盖真实 worker 退出→retry 流程
scheduler 测试 SHALL 覆盖 worker 正常退出→续轮 retry、worker 异常退出→退避 retry 的完整流程,SHALL 使用 fake timers 控制时序。

#### Scenario: 正常退出触发续轮 retry
- **WHEN** worker 正常退出(attempt null)
- **THEN** 调度器调度续轮 retry(attempt 1, 1000ms 延迟)

#### Scenario: 异常退出触发退避 retry
- **WHEN** worker 异常退出(attempt null)
- **THEN** 调度器调度退避 retry(attempt 1, 10000ms 延迟)

### Requirement: inline YAML 数组解析
YAML parser SHALL 正确解析 inline 数组语法 `[a, b]` 为字符串数组。

#### Scenario: inline 数组
- **WHEN** 解析 `required_labels: [bug, urgent]`
- **THEN** 结果为 `["bug", "urgent"]`

### Requirement: 停滞检测测试
scheduler 测试 SHALL 覆盖 stall detection:运行中任务超过 `stall_timeout_ms` 无活动时被终止并 retry。

#### Scenario: 超时终止停滞任务
- **WHEN** 运行中任务 `last_event_at` 距今超过 `stall_timeout_ms`
- **THEN** 任务被从 running 移除并调度退避 retry

### Requirement: terminal 状态 reconcile 清理工作区测试
scheduler 测试 SHALL 覆盖 reconcile 发现 terminal 状态时清理工作区目录。

#### Scenario: terminal 清理工作区
- **WHEN** reconcile 发现运行中任务状态变为 terminal
- **THEN** 任务被停止且其工作区目录被删除

### Requirement: session ID 全链路传播集成测试
测试 SHALL 覆盖 session ID 从 `onWorkerExit` 经 `scheduleRetry` 到 `RetryEntry.session_id` 再经 `onRetry` 到 `dispatch` 再到 `runAttempt` 的完整传播链路。测试 SHALL 验证 continuation retry 传播非 null session ID，failure retry 传播 null session ID。测试 SHALL 使用 fake timers 控制 retry 时序，SHALL 使用 mock tracker 避免真实 I/O。

#### Scenario: continuation retry 全链路传播 session ID
- **WHEN** worker 正常退出返回 session_id="ses_abc"，continuation retry 触发并派发
- **THEN** `runAttempt` 收到的 `sessionId` 参数为 "ses_abc"（非 null）

#### Scenario: failure retry 全链路传播 null session ID
- **WHEN** worker 异常退出返回 session_id="ses_xyz"，failure retry 触发并派发
- **THEN** `runAttempt` 收到的 `sessionId` 参数为 null

### Requirement: extractSessionAndUsage 累积 token 提取测试
测试 SHALL 覆盖 `extractSessionAndUsage` 对多个 `step_finish` 事件取最后一个累积值（非累加）的行为。测试 SHALL 使用模拟真实 opencode 输出的数据：多个 step 的 token 递增（如 100→150→200），验证取最后值（200）而非累加（450）。

#### Scenario: 多个 step_finish 取最后累积值
- **WHEN** stdout 含 3 个 step_finish，token 递增（input: 100→150→200, total: 110→165→220）
- **THEN** 提取结果为 input=200, total=220（最后值），非 input=450, total=495（累加）

#### Scenario: 单个 step_finish
- **WHEN** stdout 只含 1 个 step_finish
- **THEN** 提取结果为该 step 的 token 值

### Requirement: removeWorkspace 传入 session_id 集成测试
测试 SHALL 覆盖 `terminateRunning` 调用 `removeWorkspace` 时传入 `entry.session_id`（而非依赖 sidecar 文件 fallback）。测试 SHALL 验证传入的 session_id 被用于 `deleteSession` 调用。

#### Scenario: terminateRunning 传入 session_id
- **WHEN** `terminateRunning` 清理工作区且 `entry.session_id` 非空
- **THEN** `removeWorkspace` 使用传入的 session_id 执行 `opencode session delete`

#### Scenario: entry.session_id 为 null 时回退到 sidecar
- **WHEN** `terminateRunning` 清理工作区且 `entry.session_id` 为 null
- **THEN** `removeWorkspace` 从 sidecar 文件读取 session_id

### Requirement: suppressStderr 实际抑制验证
测试 SHALL 验证 `ConsoleLogger.suppressStderr()` 后 stderr sink 不再收到输出（而非仅验证 file sink 仍写入）。测试 SHALL 注入可捕获的 stderr sink，验证抑制后 stderrLines 为空。测试 SHALL 验证 child logger 继承 stderr 抑制。

#### Scenario: suppressStderr 后 stderr 无输出
- **WHEN** `ConsoleLogger.withFileSink` 创建 logger 并调用 `suppressStderr()`，然后 `logger.info("msg")`
- **THEN** stderr sink 收到 0 行，file sink 仍包含 "msg"

#### Scenario: child logger 继承 stderr 抑制
- **WHEN** parent logger 已 `suppressStderr()`，child logger `child.info("msg")`
- **THEN** stderr sink 收到 0 行，file sink 仍包含 "msg"

### Requirement: 测试文件类型错误修复
测试文件中缺失的类型字段（`Task.assignee`、`TrackerConfig.assignee`、`RetryEntry.session_id`）SHALL 被补全，以消除 LSP 报错并确保测试数据符合当前类型定义。

#### Scenario: Task 对象含 assignee 字段
- **WHEN** 测试构造 `Task` 对象
- **THEN** 包含 `assignee: string | null` 字段

#### Scenario: TrackerConfig 含 assignee 字段
- **WHEN** 测试构造 `TrackerConfig` 对象
- **THEN** 包含 `assignee` 字段

#### Scenario: RetryEntry 含 session_id 字段
- **WHEN** 测试构造 `RetryEntry` 对象
- **THEN** 包含 `session_id: string | null` 字段

