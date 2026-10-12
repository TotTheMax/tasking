## 1. MCP server 通知处理

- [x] 1.1 `src/mcp/jira-server.ts` `handleRequest`：返回类型改为 `Promise<JsonRpcResponse | null>`；检查 `req.id === undefined || req.id === null` → 是通知 → 返回 `null`
- [x] 1.2 `src/mcp/jira-server.ts` `handleRequest`：新增 `ping` case 返回 `{ jsonrpc: "2.0", id: req.id, result: {} }`
- [x] 1.3 `src/mcp/jira-server.ts` `handleRequest`：`notifications/initialized` 及其他通知方法 → 返回 `null`（静默确认）
- [x] 1.4 `src/mcp/jira-server.ts` `main` 循环：`handleRequest` 返回 `null` 时不写 stdout；catch 块中检查原始行是否含 `"id"` 字段，无则不写错误响应

## 2. 测试

- [x] 2.1 `tests/mcp.test.ts`：发送 `notifications/initialized`（无 id）→ 无 stdout 输出
- [x] 2.2 `tests/mcp.test.ts`：发送 `ping`（有 id）→ 返回 `{ result: {} }`
- [x] 2.3 `tests/mcp.test.ts`：发送未知通知（无 id）→ 无 stdout 输出，不崩溃
- [x] 2.4 `tests/mcp.test.ts`：握手后 `tools/call jira_rest` 正常返回结果

## 3. 验证

- [x] 3.1 运行 `npm run lint && npm run typecheck && npm test` 全部通过
