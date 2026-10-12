## Why

Jira MCP server（`jira-server.ts`）在握手阶段对 `notifications/initialized` 通知返回了 `{ id: undefined, error: -32601 }`，违反 JSON-RPC 2.0 规范，opencode MCP 客户端断开连接，agent 无法使用 `jira_rest`/`jira_upload_attachment` 工具（报 -32000: Connection closed）。

## What Changes

- `jira-server.ts`：对无 `id` 字段的 JSON-RPC 消息（通知）不返回任何响应
- `jira-server.ts`：新增 `ping` 方法处理（有 id，返回空 result）
- `jira-server.ts`：主循环对解析失败或未知通知静默忽略，不崩溃

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `opencode-worker`: MCP server 通知消息处理修复

## Impact

- `src/mcp/jira-server.ts` — 通知处理 + 主循环健壮性
- `tests/mcp.test.ts` — 通知消息测试
