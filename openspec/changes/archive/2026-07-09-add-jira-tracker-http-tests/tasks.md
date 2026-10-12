## 1. Mock HTTP Server 助手

- [x] 1.1 创建 `tests/helpers/mock-http-server.ts`：基于 `node:http` 的 `createMockJiraServer` 函数，返回 `{ port, baseUrl, requests, close }`，绑定 `127.0.0.1:0` 随机端口，handler 函数返回 `{ status, body, delayMs? }`，录制请求到 `requests` 数组
- [x] 1.2 验证助手基础功能：启动 server、发送请求、断言录制内容、`close()` 释放端口

## 2. Fallback 路径测试

- [x] 2.1 `fetchCandidateIssues` fallback：活跃状态 JQL 返回 400 → 全项目查询返回 3 个 issue（2 活跃 + 1 terminal）→ 返回 2 个活跃 issue
- [x] 2.2 `fetchIssuesByStates` fallback：指定状态 JQL 返回 500 → 全项目查询返回 3 个 issue（2 匹配）→ 返回 2 个匹配 issue
- [x] 2.3 非 `jira_api_status` 错误（网络错误）不触发 fallback，错误向上传播

## 3. fetchIssueStatesByIds 真实 ID 测试

- [x] 3.1 数字 ID 列表：`["10001", "10002"]` → JQL 含 `id in (10001, 10002)`（无引号）
- [x] 3.2 非数字 ID 列表：`["ENG-1", "ENG-2"]` → JQL 含 `id in ("ENG-1", "ENG-2")`（加引号）
- [x] 3.3 混合 ID 列表：`["10001", "ENG-2"]` → JQL 含 `id in (10001, "ENG-2")`
- [x] 3.4 返回归一化 Task：验证 id/identifier/state 映射

## 4. 认证 header HTTP 级验证

- [x] 4.1 bearer 模式：`auth_mode: bearer`、`api_key: "tok123"` → 录制的 `authorization` header 为 `Bearer tok123`
- [x] 4.2 basic 模式：`api_user: "alice"`、`api_key: "secret"` → 录制的 `authorization` header 为 `Basic <base64(alice:secret)>`
- [x] 4.3 Content-Type 与 Accept header 验证：`content-type: application/json`、`accept: application/json`

## 5. 端点 URL 拼接验证

- [x] 5.1 末尾单斜杠：endpoint `.../rest/api/2/` → 请求路径为 `/rest/api/2/search`
- [x] 5.2 末尾多斜杠：endpoint `.../rest/api/2//` → 请求路径为 `/rest/api/2/search`

## 6. 分页边界测试

- [x] 6.1 `total` 字段缺失：返回 `{ issues: [...] }`（无 total）→ 第一页后终止
- [x] 6.2 `issues.length < pageSize`：pageSize=50 返回 10 个 → 只发一次请求
- [x] 6.3 多页合并顺序：pageSize=1 返回两页 → 顺序为 `[id:"1", id:"2"]`

## 7. 畸形响应测试

- [x] 7.1 非 JSON body：返回 `<html>error</html>` → 抛出 `jira_api_request` 错误
- [x] 7.2 缺失 `issues` 字段：返回 `{ total: 5 }` → 视为空数组，返回空结果
- [x] 7.3 空 `issues` 数组：返回 `{ total: 0, issues: [] }` → 返回空数组，循环终止

## 8. 归一化边缘场景测试

- [x] 8.1 assignee `emailAddress` fallback：`{ emailAddress: "bob@example.com" }` → `task.assignee` 为 `"bob@example.com"`
- [x] 8.2 assignee `key` fallback：`{ key: "userkey123" }` → `task.assignee` 为 `"userkey123"`
- [x] 8.3 数字 priority：`priority: 3` → `task.priority` 为 `3`
- [x] 8.4 非 Blocks 关系类型过滤：`Relates` + `Blocks` → `blocked_by` 长度为 1
- [x] 8.5 blocker 缺失 `inwardIssue`：Blocks 类型但无 `inwardIssue` → `blocked_by` 为空数组

## 9. 验证与清理

- [x] 9.1 运行 `npm test` 确认全部测试通过（含新增 + 既有）
- [x] 9.2 运行 `npm run lint` 确认无 lint 错误
- [x] 9.3 运行 `npm run typecheck` 确认类型正确
- [x] 9.4 运行 `npm test -- --coverage` 确认 `src/adapters/jira/tracker.ts` 的 `request` 方法覆盖率从 0% 提升
