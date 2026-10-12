## MODIFIED Requirements

### Requirement: status 与 logs 子命令
`tasking status` SHALL 通过 HTTP dashboard API 查询运行中 daemon 的实时状态,打印人类可读快照:运行中任务(标识符、状态、turn 数、elapsed、token)、retry 队列(标识符、attempt、due_at、error)、聚合 token/运行时总量。SHALL 支持 `--json` 输出原始 API JSON。当 daemon 未运行 HTTP dashboard 时,SHALL 回退到仅报告 PID 状态。当无 daemon 运行时 SHALL 以非零码退出。

`tasking logs` SHALL 打印近期结构化日志的最后 N 行(默认 100,`--lines N` 可配),SHALL 支持 `--follow` 持续跟踪日志输出直到 `SIGINT`,SHALL 支持 `--level debug|info|warn|error` 按日志级别过滤(非 JSON 行始终保留)。

#### Scenario: 无运行 daemon 时 status
- **WHEN** 无 daemon 运行时调用 `tasking status`
- **THEN** 报告 daemon 未运行并以非零码退出

#### Scenario: status 查询 HTTP API
- **WHEN** daemon 运行且 HTTP dashboard 可达时调用 `tasking status`
- **THEN** 通过 `GET /api/v1/state` 查询并格式化输出运行中任务与 retry 队列

#### Scenario: status --json 输出
- **WHEN** 调用 `tasking status --json`
- **THEN** 输出 API 原始 JSON,适合管道处理

#### Scenario: status 无 HTTP 端口回退
- **WHEN** daemon 运行但未配置 HTTP dashboard 端口时调用 `tasking status`
- **THEN** 报告 daemon PID 并提示 HTTP dashboard 未配置

#### Scenario: status 展示运行与重试
- **WHEN** daemon 有运行与重试任务时调用 `tasking status`
- **THEN** 输出列出运行中任务与 retry 队列条目,含标识符与时间

#### Scenario: logs 默认 tail 100 行
- **WHEN** 调用 `tasking logs` 且日志文件存在
- **THEN** 打印最后 100 行结构化日志

#### Scenario: logs 指定行数
- **WHEN** 调用 `tasking logs --lines 50`
- **THEN** 打印最后 50 行

#### Scenario: logs follow 持续跟踪
- **WHEN** 调用 `tasking logs --follow`
- **THEN** 持续打印新增日志行直到收到 `SIGINT`

#### Scenario: logs 按级别过滤
- **WHEN** 调用 `tasking logs --level error`
- **THEN** 仅打印 `level: "error"` 的 JSON 日志行(非 JSON 行始终保留)

#### Scenario: logs 文件不存在
- **WHEN** 调用 `tasking logs` 且 `tasking.log` 不存在
- **THEN** 报告无日志并以非零码退出

### Requirement: triage 子命令
`tasking triage` SHALL 在 route-agent 未接线时输出提示信息并以非零码退出,SHALL NOT 出现在 USAGE 帮助文本中。待 route-agent 接入 daemon tick 后 SHALL 恢复为触发 route-agent 运行的完整行为。

#### Scenario: route-agent 未接线时调用 triage
- **WHEN** 调用 `tasking triage`
- **THEN** 输出 "not yet available" 提示并以非零码退出

#### Scenario: triage 不出现在帮助文本
- **WHEN** 调用 `tasking --help` 或 `tasking`(无参数)
- **THEN** USAGE 文本中不包含 `triage`

## ADDED Requirements

### Requirement: start --detach 后台运行
`tasking start` SHALL 支持 `--detach` 参数,使 daemon 在后台独立运行。启用时父进程 SHALL 以 `detached: true` + `stdio: "ignore"` 重新 spawn 自身(去掉 `--detach` 参数),`child.unref()` 后父进程退出。子进程 SHALL 继承工作目录与环境变量,独立执行前台 daemon 逻辑。`--detach` 与 `--tui` 同时使用时 SHALL 报错退出。

#### Scenario: detach 后台启动
- **WHEN** 调用 `tasking start --detach`
- **THEN** 父进程 spawn 子进程后输出 PID 并以 0 退出,子进程在后台独立运行

#### Scenario: detach 与 tui 互斥
- **WHEN** 调用 `tasking start --detach --tui`
- **THEN** 报错"detach and tui are mutually exclusive"并以非零码退出

#### Scenario: detach 子进程写元信息
- **WHEN** `--detach` 子进程启动并完成初始化
- **THEN** `daemon.json` 被写入,含子进程 PID

### Requirement: stop 子命令
`tasking stop` SHALL 读取 daemon 元信息文件获取 PID,向该进程发送 `SIGTERM`,等待其优雅退出(超时 10s 后发 `SIGKILL`)后清理元信息文件。当无 daemon 运行时 SHALL 报告并以非零码退出。当 PID 对应进程不存在时 SHALL 清理过期的元信息文件。

#### Scenario: 停止运行中 daemon
- **WHEN** daemon 运行时调用 `tasking stop`
- **THEN** 向 daemon 进程发送 `SIGTERM`,等待退出后以 0 退出

#### Scenario: 超时强制停止
- **WHEN** daemon 收到 SIGTERM 后 10s 未退出
- **THEN** 发送 SIGKILL 强制终止

#### Scenario: 无 daemon 时 stop
- **WHEN** 无 daemon 运行时调用 `tasking stop`
- **THEN** 报告 daemon 未运行并以非零码退出

#### Scenario: 清理过期元信息
- **WHEN** 调用 `tasking stop` 且元信息文件存在但对应进程已不存在
- **THEN** 清理元信息文件并报告 daemon 未运行

### Requirement: tui 子命令
`tasking tui` SHALL 连接运行中 daemon 的 HTTP dashboard API,轮询 `GET /api/v1/state` 并渲染终端仪表板(复用 `TerminalDashboard` 渲染逻辑)。SHALL 每 1s 刷新一次。退出 TUI(`q` 或 `SIGINT`)SHALL NOT 影响 daemon 进程。当 daemon 未运行或未配置 HTTP dashboard 时 SHALL 以非零码退出。

#### Scenario: 连接 daemon 渲染 TUI
- **WHEN** daemon 运行且 HTTP dashboard 可达时调用 `tasking tui`
- **THEN** 轮询 API 并渲染终端仪表板,显示运行中任务、retry 队列与聚合总量

#### Scenario: TUI 退出不影响 daemon
- **WHEN** 用户在 `tasking tui` 中按 `q` 或 `SIGINT` 退出
- **THEN** TUI 停止渲染,daemon 继续运行

#### Scenario: 无 daemon 时 tui
- **WHEN** 无 daemon 运行时调用 `tasking tui`
- **THEN** 报告 daemon 未运行并以非零码退出

#### Scenario: 无 HTTP dashboard 时 tui
- **WHEN** daemon 运行但未配置 HTTP dashboard 端口时调用 `tasking tui`
- **THEN** 报告 HTTP dashboard 未配置并以非零码退出
