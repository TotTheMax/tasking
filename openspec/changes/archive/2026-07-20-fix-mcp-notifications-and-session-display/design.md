## Context

`jira-server.ts` 是 stdio MCP server。MCP 握手流程：opencode 发 `initialize`（有 id）→ server 响应 → opencode 发 `notifications/initialized`（通知，无 id）→ server 应静默。当前 server 对通知返回 `{ id: undefined, error: -32601 }`，opencode 判定协议违规断开连接。

## Goals / Non-Goals

**Goals:**
- MCP server 正确处理通知消息（不返回响应）
- 处理 `ping`（有 id 的 keepalive 请求）
- 主循环对任何未知消息静默忽略

**Non-Goals:**
- TUI session 显示优化
- 增量解析 stdout 提前获取 session ID
- MCP server 重试/重连逻辑

## Decisions

### D1: 通知消息不返回响应

`handleRequest` 检查 `req.id === undefined || req.id === null` → 是通知 → 返回 `null`。主循环：`if (res !== null) process.stdout.write(...)`。

### D2: 处理 `ping`

`ping` 是 MCP keepalive 请求（有 id），返回 `{ jsonrpc: "2.0", id: req.id, result: {} }`。

### D3: 主循环兜底

catch 块中：解析失败时若原始行含 `"id"` 字段则写错误响应，否则静默忽略。任何未预期异常记 stderr 日志，不崩溃。

## Risks / Trade-offs

- [通知静默忽略] — 符合 JSON-RPC 2.0 规范，opencode 不会因缺少响应而超时
