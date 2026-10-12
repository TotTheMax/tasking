## MODIFIED Requirements

### Requirement: Worker 以 opencode run 子进程启动
worker 层 SHALL 将每次任务 attempt 作为 `opencode run` 子进程启动。MCP server（`jira-server.ts`）SHALL 正确处理 MCP 通知消息：对无 `id` 字段的 JSON-RPC 消息（通知）SHALL NOT 返回任何响应；SHALL 处理 `notifications/initialized`（静默确认）和 `ping`（返回空 result）；主循环 SHALL 对未知消息静默忽略而非返回错误或崩溃。

#### Scenario: MCP 通知不返回响应
- **WHEN** MCP 客户端发送 `notifications/initialized`（无 id 字段）
- **THEN** server 不向 stdout 写入任何响应

#### Scenario: MCP ping 返回响应
- **WHEN** MCP 客户端发送 `ping` 请求（有 id 字段）
- **THEN** server 返回 `{ jsonrpc: "2.0", id: <id>, result: {} }`

#### Scenario: MCP 未知通知静默忽略
- **WHEN** MCP 客户端发送未知方法的通知（无 id 字段）
- **THEN** server 不向 stdout 写入任何响应，不崩溃

#### Scenario: MCP 工具调用正常
- **WHEN** 握手完成后 MCP 客户端发送 `tools/call` 请求
- **THEN** server 正常执行 `jira_rest` 或 `jira_upload_attachment` 并返回结果
