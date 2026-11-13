## MODIFIED Requirements

### Requirement: 工作区清理联动 session 清理
工作区管理器 SHALL 在删除工作区时,若关联的 session ID 非空,先经 opencode api 删除该会话,再删除工作区目录。session 清理失败 SHALL 记录警告但不阻塞工作区删除。调度器 SHALL 在调用 `removeWorkspace` 时传入已知的 session ID(从 `RunningEntry` 获取)。

#### Scenario: terminal 清理含 session 删除
- **WHEN** 任务 terminal 且工作区管理器收到非空 session ID
- **THEN** 先经 api 删除该会话,再删除工作区目录

#### Scenario: session ID 为空时跳过 session 清理
- **WHEN** 工作区管理器收到 null session ID(daemon 重启后启动清理)
- **THEN** 跳过 session 清理,直接删除工作区目录

#### Scenario: session 清理失败不阻塞
- **WHEN** 会话删除调用失败
- **THEN** 记录警告日志,继续删除工作区目录

## ADDED Requirements

### Requirement: MCP 注入使用 v2 mcp.servers 格式
`injectMcpConfig` SHALL 向工作区 `.opencode/opencode.json` 写入 v2 格式的 `mcp.servers.jira` 条目（`{type:"local", command, environment}`），并显式携带 `codemode: false`（工具直出、命名与 v1 连续）。SHALL 合并保留该文件中的其他既有键，SHALL NOT 写入或修改 `permissions` 键，SHALL NOT 碰 `.opencode/skills/`。

#### Scenario: 注入格式为 mcp.servers 且 codemode 关闭
- **WHEN** 工作区初始化注入 jira MCP
- **THEN** `.opencode/opencode.json` 含 `mcp.servers.jira`，且该条目 `codemode` 为 `false`

#### Scenario: 不写 permissions
- **WHEN** 注入执行
- **THEN** 文件中 `permissions` 键不存在或保持用户原值不变
