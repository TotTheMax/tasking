## MODIFIED Requirements

### Requirement: tui 子命令
`tasking tui` SHALL 连接 daemon 的 HTTP dashboard API,轮询 `GET /api/v1/state` 并渲染终端仪表板(复用 `TerminalDashboard` 渲染逻辑)。SHALL 每 1s 刷新一次。退出 TUI(`q` 或 `SIGINT`)SHALL NOT 影响 daemon 进程。进入 TUI 前 SHALL 探测一次 `/api/v1/state` 连通性;不可达 SHALL 打印含已解析端口与 `--port` 覆盖提示的错误并以非零码退出。端口解析见「tui 手动指定端口」。

#### Scenario: 连接 daemon 渲染 TUI
- **WHEN** daemon 运行且 HTTP dashboard 可达时调用 `tasking tui`
- **THEN** 轮询 API 并渲染终端仪表板,显示运行中任务、retry 队列与聚合总量

#### Scenario: TUI 退出不影响 daemon
- **WHEN** 用户在 `tasking tui` 中按 `q` 或 `SIGINT` 退出
- **THEN** TUI 停止渲染,daemon 继续运行

#### Scenario: 解析端口不可达
- **WHEN** 按解析规则得出端口且该端口无 daemon 监听
- **THEN** 打印含该端口与 `--port` 覆盖方式的错误并以非零码退出

### Requirement: tui 手动指定端口

`tasking tui` SHALL 按如下优先级解析连接的 dashboard 端口：1) `--port <n>`（或 `-p <n>`）显式指定；2) 当前目录 `.tasking/daemon.json` 的 `port`（若存在）；3) 兜底 `8080`。host 取 daemon.json 的 host（若存在），否则 `127.0.0.1`。`--port` 显式指定时 SHALL NOT 依赖当前目录 daemon.json。非数值端口 SHALL 报错并以非零码退出。进入 TUI 前 SHALL 探测一次 `/api/v1/state` 连通性，不可达时 SHALL 打印错误（含解析端口与 `--port` 覆盖提示）并以非零码退出。

#### Scenario: 手动指定端口
- **WHEN** 调用 `tasking tui --port 9000` 且 9000 上有可达 daemon
- **THEN** TUI 连接到 9000 端口渲染，无需当前目录 daemon.json

#### Scenario: 指定端口不可达
- **WHEN** 调用 `tasking tui --port 9999` 且该端口无 daemon 监听
- **THEN** 打印「cannot reach dashboard」且含端口与 `--port` 提示，以非零码退出

#### Scenario: 非数值端口
- **WHEN** 调用 `tasking tui --port abc`
- **THEN** 打印「invalid port」并以非零码退出

#### Scenario: 无参时读 daemon.json 端口
- **WHEN** 调用 `tasking tui` 且当前目录 `.tasking/daemon.json` 存在且含 port
- **THEN** 以该 port 连接渲染

#### Scenario: 无参且无 daemon.json 时兜底 8080
- **WHEN** 调用 `tasking tui` 且当前目录无 `.tasking/daemon.json`
- **THEN** 以 `8080` 作为端口探测连接；不可达则按解析端口报错退出
