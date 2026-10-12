## ADDED Requirements

### Requirement: daemon 元信息含 workflow 路径与实际端口

`tasking start` 写入的 `daemon.json` SHALL 包含 `workflow_path`（当前加载的工作流文件绝对路径）与 `port`。当以 `--port 0`（请求临时端口）启动时，写入的 `port` SHALL 为 HTTP dashboard 实际绑定的端口而非 0。读取旧格式（缺 `workflow_path`）的 daemon.json SHALL 兼容降级（视为 null）。

#### Scenario: 写入 workflow_path
- **WHEN** daemon 启动完成并写入 daemon.json
- **THEN** daemon.json 含 workflow_path 字段，指向加载的工作流文件

#### Scenario: --port 0 写入实际端口
- **WHEN** 以 `--port 0` 启动 daemon 且 dashboard 绑定到随机端口 N
- **THEN** daemon.json 的 port 为 N，`tasking tui` / `status` 能据此连接

#### Scenario: 旧格式兼容
- **WHEN** 读取不含 workflow_path 的旧 daemon.json
- **THEN** workflow_path 视为 null，其余字段正常读取

### Requirement: tui 手动指定端口

`tasking tui` SHALL 支持 `--port <n>`（或 `-p <n>`）手动指定连接的 dashboard 端口。指定端口时 SHALL 不依赖当前目录的 `.tasking/daemon.json`（host 取 daemon.json 若存在，否则默认 `127.0.0.1`）；未指定时 SHALL 维持原有行为（读取当前目录 daemon.json 定位）。非数值端口 SHALL 报错并以非零码退出。进入 TUI 前 SHALL 探测一次 `/api/v1/state` 连通性，不可达时 SHALL 打印错误并以非零码退出。

#### Scenario: 手动指定端口
- **WHEN** 调用 `tasking tui --port 9000` 且 9000 上有可达 daemon
- **THEN** TUI 连接到 9000 端口渲染，无需当前目录 daemon.json

#### Scenario: 指定端口不可达
- **WHEN** 调用 `tasking tui --port 9999` 且该端口无 daemon 监听
- **THEN** 打印「cannot reach dashboard」并以非零码退出

#### Scenario: 非数值端口
- **WHEN** 调用 `tasking tui --port abc`
- **THEN** 打印「invalid port」并以非零码退出

#### Scenario: 未指定端口维持原行为
- **WHEN** 调用 `tasking tui` 且当前目录无 daemon.json
- **THEN** 报告 daemon 未运行并以非零码退出
