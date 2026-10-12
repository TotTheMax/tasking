## ADDED Requirements

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
