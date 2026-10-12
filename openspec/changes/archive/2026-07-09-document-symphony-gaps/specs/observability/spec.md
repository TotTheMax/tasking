## ADDED Requirements

### Requirement: 单 issue 运行详情端点
HTTP 仪表板 SHALL 在 `GET /api/v1/<task_identifier>` 上返回指定任务的运行详情,含:任务标识符与 ID、编排状态(running/retrying/idle)、workspace 路径、retry 信息(attempt、due_at、error)、运行中信息(session_id、turn_count、state、started_at、last_event、last_event_at、tokens)、最近事件列表、last_error。任务不在当前内存状态中时 SHALL 返回 `404`。

#### Scenario: 返回运行中任务详情
- **WHEN** 请求 `GET /api/v1/ABC-123` 且 ABC-123 正在运行
- **THEN** 返回 200,含 workspace 路径、session_id、turn_count、tokens 等

#### Scenario: 返回重试中任务详情
- **WHEN** 请求 `GET /api/v1/ABC-123` 且 ABC-123 在 retry 队列中
- **THEN** 返回 200,含 attempt、due_at、error

#### Scenario: 未知任务返回 404
- **WHEN** 请求 `GET /api/v1/UNKNOWN-1` 且该任务不在内存状态中
- **THEN** 返回 404,JSON 错误体 `{"error":{"code":"issue_not_found","message":"..."}}`

### Requirement: refresh 端点真触发 poll
`POST /api/v1/refresh` SHALL 调用调度器的 `requestRefresh()` 方法以队列化一次立即 poll + reconcile 周期。响应 SHALL 为 `202 Accepted`,含 `queued: true`、`coalesced: <boolean>`(是否合并到已有待处理)、`requested_at`(ISO 8601)、`operations: ["poll", "reconcile"]`。

#### Scenario: refresh 触发 poll
- **WHEN** `POST /api/v1/refresh` 请求到达
- **THEN** 调度器 `requestRefresh()` 被调用,响应 202

#### Scenario: 重复 refresh 合并
- **WHEN** 连续两次 `POST /api/v1/refresh`
- **THEN** 第二次响应 `coalesced: true`

### Requirement: 405 Method Not Allowed
已定义路由上的不支持 HTTP 方法 SHALL 返回 `405 Method Not Allowed`。未定义路由 SHALL 返回 `404 Not Found`。

#### Scenario: 不支持方法返回 405
- **WHEN** 对 `/api/v1/state` 发送 `DELETE` 请求
- **THEN** 返回 405

#### Scenario: 未定义路由返回 404
- **WHEN** 请求 `/api/v1/unknown`
- **THEN** 返回 404

### Requirement: 文件日志 sink
daemon SHALL 支持可选的文件日志 sink,将结构化 JSON 日志行写入配置的文件路径(默认 `<data-dir>/tasking.log`)。文件 SHALL 按大小轮转(默认 10MB × 5 文件)。文件 sink 失败 SHALL NOT 使 daemon 崩溃,SHALL 通过剩余 sink 发出警告。

#### Scenario: 日志写入文件
- **WHEN** 文件 sink 启用
- **THEN** 结构化日志行写入配置的文件路径

#### Scenario: 文件轮转
- **WHEN** 日志文件达到轮转阈值
- **THEN** 当前文件重命名(`.1`、`.2`、…),新文件创建

#### Scenario: 文件 sink 失败不崩溃
- **WHEN** 文件 sink 写入失败
- **THEN** daemon 继续,通过 stderr sink 警告

### Requirement: rate-limit 提取
worker SHALL 从 `opencode run --format json` 事件流中提取 rate-limit 载荷(若存在),并 SHALL 更新编排器状态的 `rate_limits` 字段。快照 SHALL 暴露最新的 rate-limit 负载。

#### Scenario: rate-limit 被提取
- **WHEN** opencode 事件流含 rate-limit 载荷
- **THEN** `state.rate_limits` 更新为最新值

#### Scenario: 无 rate-limit 时为 null
- **WHEN** opencode 事件流不含 rate-limit 载荷
- **THEN** `state.rate_limits` 保持 null

### Requirement: 观察者通知
调度器 SHALL 在编排器状态变更(任务派发、worker 退出、retry 调度、reconcile 完成)时通知已注册的观察者。观察者 SHALL 能订阅/退订通知。通知 SHALL NOT 阻塞调度器主循环。

#### Scenario: 状态变更触发通知
- **WHEN** 一个任务被派发或 worker 退出
- **THEN** 已注册的观察者收到通知

#### Scenario: 通知不阻塞调度器
- **WHEN** 观察者回调慢或出错
- **THEN** 调度器主循环不受影响

### Requirement: 快照响应字段对齐
`GET /api/v1/state` 响 SHALL 使用 ISO 8601 时间戳(`generated_at`、`due_at`、`started_at`、`last_event_at`、`requested_at`)。聚合总量字段名 SHALL 为 `codex_totals`(含 `input_tokens`、`output_tokens`、`total_tokens`、`seconds_running`)。运行中行 SHALL 使用 `task_id` 和 `task_identifier` 字段名。

#### Scenario: 时间戳为 ISO 8601
- **WHEN** 查询 `/api/v1/state`
- **THEN** `generated_at` 为 ISO 8601 格式字符串

#### Scenario: 聚合总量字段名
- **WHEN** 查询 `/api/v1/state`
- **THEN** 响应含 `codex_totals` 对象(非 `totals`)
