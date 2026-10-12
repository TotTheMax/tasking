## ADDED Requirements

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
daemon SHALL 暴露同步运行时快照(供 `tasking status` 与任何 HTTP dashboard 使用),返回:`running`(运行中行列表,含 `turn_count`、标识符、状态、时间、token)、`retrying`(retry 队列行列表,含 attempt/due/error)、`codex_totals`(input/output/total token、seconds_running)、以及 `rate_limits`(若可用,最新 rate-limit 负载)。快照失败模式 SHALL 为 `timeout` 或 `unavailable`。

#### Scenario: 快照反映运行与重试
- **WHEN** 有活动与重试任务时调用 `tasking status`
- **THEN** 快照列出两者及文档化字段

#### Scenario: 快照超时被暴露
- **WHEN** 快照无法及时产出
- **THEN** 暴露 `timeout` 错误模式

### Requirement: token 与运行时记账正确性
daemon SHALL 跨已结束会话累积聚合 token 总量与运行时秒数,并 SHALL 在快照时加上活动会话的流逝时间。来自 worker 输出的绝对总量 SHALL 以 delta 跟踪以避免重复计数。运行时总量 SHALL 在快照时作为实时聚合上报。

#### Scenario: 跨会话累积聚合
- **WHEN** 某会话结束
- **THEN** 其运行时秒数加到累计已结束会话总量

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
