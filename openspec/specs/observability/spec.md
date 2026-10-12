## Purpose

可观测性：HTTP 仪表板、文件日志、运行时快照。
## Requirements
### Requirement: 带上下文字段的结构化日志
daemon SHALL 向一个或多个 sink(stderr 和/或文件)输出结构化日志(JSON 行)。任务相关日志 SHALL 含 `task_id` 与 `task_identifier` 上下文字段。会话生命周期日志 SHALL 含 `session_id`。日志 SHALL 使用稳定的 `key=value` 表述并含动作结果与简明失败原因。除非必要,SHALL 避免大体量原始负载。

#### Scenario: 日志含任务上下文
- **WHEN** 为某任务输出一条日志
- **THEN** 含 `task_id` 与 `task_identifier`

#### Scenario: 日志含会话上下文
- **WHEN** 输出一条会话生命周期日志
- **THEN** 含 `session_id`

### Requirement: 运维者可见的校验与派发失败
运维者 SHALL 能在不挂调试器的情况下看到启动、校验、派发失败。若配置的日志 sink 失败,daemon SHALL 尽可能继续运行并通过剩余 sink 发出运维者可见警告。

#### Scenario: 校验失败可见
- **WHEN** 启动校验失败
- **THEN** 向至少一个 sink 发出运维者可见错误

#### Scenario: sink 失败不使 daemon 崩溃
- **WHEN** 某日志 sink 失败
- **THEN** daemon 继续,通过剩余 sink 警告

### Requirement: 运行时状态快照
daemon SHALL 暴露同步运行时快照(供 `tasking status` 与任何 HTTP dashboard 使用),返回:`running`(运行中行列表,含 `session_id`、`turn_count`、标识符、状态、时间、token)、`retrying`(retry 队列行列表,含 attempt/due/error)、`codex_totals`(input/output/total token、seconds_running)。运行中行的 `session_id` SHALL 从 `RunningEntry.session_id` 实时填充(由 worker 从 JSON 事件流提取)。token 字段 SHALL 反映从 JSON `step_finish` 事件累加的真实用量。快照失败模式 SHALL 为 `timeout` 或 `unavailable`。

#### Scenario: 快照反映运行与重试
- **WHEN** 有活动与重试任务时调用 `tasking status`
- **THEN** 快照列出两者及文档化字段

#### Scenario: 快照含 session ID
- **WHEN** 某运行中任务已提取 session ID
- **THEN** 快照中该任务的 `session_id` 字段为实际值(非 null)

#### Scenario: 快照超时被暴露
- **WHEN** 快照无法及时产出
- **THEN** 暴露 `timeout` 错误模式

### Requirement: token 与运行时记账正确性
daemon SHALL 从 `opencode run --format json` 的 JSON 事件流中提取 token 用量,SHALL 遍历所有 `step_finish` 事件累加 `part.tokens` 字段(input、output、total),并 SHALL 跨已结束会话累积聚合 token 总量与运行时秒数,并 SHALL 在快照时加上活动会话的流逝时间。来自 worker 输出的绝对总量 SHALL 以 delta 跟踪以避免重复计数。运行时总量 SHALL 在快照时作为实时聚合上报。

#### Scenario: 从 JSON 事件流提取 token
- **WHEN** `opencode run --format json` 发出 `step_finish` 事件
- **THEN** 累加其 `part.tokens` 字段至聚合总量

#### Scenario: 跨会话累积聚合
- **WHEN** 某会话结束
- **THEN** 其运行时秒数与 token 总量加到累计已结束会话总量

#### Scenario: 快照含活动时间
- **WHEN** 有会话运行时取快照
- **THEN** 上报的运行时含活动会话流逝时间

### Requirement: 可选 HTTP dashboard 扩展
当通过 CLI `--port` 或 `server.port` 启用时(CLI 覆盖配置),daemon MAY 在 `/` 提供 HTTP dashboard,并 MAY 在 `/api/v1/*` 下提供 JSON REST API。dashboard/API SHALL 仅为可观测/控制面,且 SHALL NOT 参与正确性。`--port` SHALL 启用服务器;`0` 请求临时端口。SHALL 默认绑定回环地址。

#### Scenario: 端口启用服务器
- **WHEN** 以 `--port 8080` 启动 daemon
- **THEN** HTTP 服务器绑定 8080(默认回环)

#### Scenario: CLI 覆盖配置端口
- **WHEN** 提供 `--port` 且同时设置了 `server.port`
- **THEN** CLI 值优先

#### Scenario: dashboard 不参与正确性
- **WHEN** HTTP 服务器未启用
- **THEN** 编排仍正常工作

### Requirement: 状态面由编排器状态驱动
任何人类可读状态面 SHALL 仅从编排器状态/指标取数,且 SHALL NOT 参与正确性。若实现,人工化的 agent 事件汇总 SHALL 仅为可观测,且 SHALL NOT 驱动编排器逻辑。

#### Scenario: 状态独立于正确性
- **WHEN** 状态面不可用或出错
- **THEN** 编排不受影响地继续

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

### Requirement: 有效配置与运行时属性端点

HTTP dashboard SHALL 在 `GET /api/v1/config` 上返回 daemon 当前有效配置（EffectiveConfig）与运行时属性。响应 SHALL 含 `config`（脱敏后的有效配置，分组：tracker / polling / workspace / hooks / agent / opencode / router / feishu / server / logging / env）与 `runtime`（pid、started_at、workflow_path、workspace_root、log_path、host、port）。密钥字段（tracker.api_key、feishu.app_secret、feishu.verification_token、feishu.encrypt_key、env 段值）SHALL 在响应中脱敏为 `****`。`started_at` SHALL 使用 ISO 8601 格式。该端点 SHALL 仅为可观测/控制面，不参与正确性。

#### Scenario: 返回有效配置
- **WHEN** 请求 `GET /api/v1/config`
- **THEN** 返回 200，含脱敏后的 config 与运行时属性

#### Scenario: 密钥脱敏
- **WHEN** 请求 `GET /api/v1/config` 且配置含 api_key 等密钥
- **THEN** 响应中对应字段为 `****`

#### Scenario: 运行时属性
- **WHEN** 请求 `GET /api/v1/config`
- **THEN** runtime 含 pid、started_at（ISO 8601）、workflow_path、workspace_root、log_path、host、port

#### Scenario: 不支持的方法返回 405
- **WHEN** 对 `/api/v1/config` 发送 POST
- **THEN** 返回 405

