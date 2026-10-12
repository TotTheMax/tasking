## MODIFIED Requirements

### Requirement: status 与 logs 子命令
`tasking status` SHALL 通过 HTTP dashboard API 查询运行中 daemon 的实时状态,打印人类可读快照:运行中任务(标识符、状态、turn 数、elapsed、token)、retry 队列(标识符、attempt、due_at、error)、聚合 token/运行时总量。SHALL 支持 `--json` 输出原始 API JSON。当 daemon 未运行 HTTP dashboard 时,SHALL 回退到仅报告 PID 状态。当无 daemon 运行时 SHALL 以非零码退出。

`tasking logs` SHALL 打印近期结构化日志的最后 N 行(默认 100,`--lines N` 可配),SHALL 支持 `--follow` 持续跟踪日志输出直到 `SIGINT`,SHALL 支持 `--level debug|info|warn|error` 按日志级别过滤(非 JSON 行始终保留)。日志文件路径 SHALL 按序解析:daemon 元信息文件中的 `log_path`(daemon 运行时)优先,否则回退当前目录 `tasking.log`。

#### Scenario: 无运行 daemon 时 status
- **WHEN** 无 daemon 运行时调用 `tasking status`
- **THEN** 报告 daemon 未运行并以非零码退出

#### Scenario: logs 优先用 daemon 记录的日志路径
- **WHEN** 当前目录存在 `.tasking/daemon.json` 且含 `log_path`(daemon 启动时按 `logging.file.path` 配置或默认 `tasking.log` 写入),且该路径下日志文件存在
- **THEN** `tasking logs` 读取 `log_path` 指向的文件(而非当前目录的 `tasking.log`)

#### Scenario: 旧格式 daemon 信息回退当前目录
- **WHEN** daemon.json 无 `log_path` 字段(旧格式)或 daemon 未运行
- **THEN** `tasking logs` 回退读取当前目录 `tasking.log`
