## Why

JiraTracker HTTP 层的测试目前全部依赖内联 mock fetch（`mockFetch` / `mockFetchCapturing`），能验证逻辑分支但无法覆盖真实 HTTP 传输细节：URL 拼接、header 序列化、AbortController 超时、fallback 路径的多请求序列、畸形响应体等。覆盖率报告显示 `src/adapters/jira/tracker.ts` 的 `request` 方法无覆盖测试，`fetchCandidateIssues`/`fetchIssuesByStates` 的 fallback 分支（状态名不匹配→全项目查询+客户端过滤）未测试，`fetchIssueStatesByIds` 仅测空数组。需要一个轻量 Mock HTTP Server 基础设施来填补这些缺口，遵循"测试支撑功能"原则——每个测试验证一条真实行为路径而非凑行数。

## What Changes

- 新增 `tests/helpers/mock-http-server.ts`：基于 Node `http` 模块的轻量 Mock HTTP Server（~80 行），支持请求录制（URL/method/headers/body）、可配置响应序列、延迟模拟、连接错误模拟
- 新增 `tests/jira-tracker-http.test.ts`：通过真实 HTTP 请求测试 JiraTracker HTTP 层，覆盖以下缺口：
  - **Fallback 路径**：`fetchCandidateIssues`/`fetchIssuesByStates` 在活跃状态 JQL 返回 `jira_api_status` 后 fallback 到全项目查询 + 客户端 `matchStateNames` 过滤
  - **`fetchIssueStatesByIds` 真实 ID**：数字 ID 无引号、非数字 ID 加引号、混合 ID 列表
  - **认证 header**：`bearer` 模式发送 `Authorization: Bearer <token>`、`basic` 模式发送 `Basic <base64(user:token)>`，通过真实 HTTP 请求验证 header 值
  - **端点 URL 拼接**：末尾斜杠剥离、`/search` 路径拼接
  - **分页边界**：`total` 字段缺失时的终止行为、`issues.length < pageSize` 提前终止、多页合并顺序
  - **超时**：服务器延迟响应触发 `AbortController` 超时，映射为 `jira_api_request` 错误
  - **畸形响应**：非 JSON body、缺失 `total`/`issues` 字段、空 `issues` 数组
  - **归一化边缘**：`normalizeAssignee` 的 `emailAddress`/`key` fallback、`normalizePriority` 的数字类型、`normalizeBlockers` 的非 Blocks 关系过滤
- 不修改任何生产代码——纯测试补充

## Capabilities

### New Capabilities
- `jira-tracker-http-tests`: Mock HTTP Server 测试基础设施 + JiraTracker HTTP 层全面测试覆盖（fallback 路径、认证 header、URL 拼接、分页边界、超时、畸形响应、归一化边缘）

### Modified Capabilities
（无——所有测试验证的行为已在 `jira-tracker` 和 `regression-and-integration-tests` spec 中定义，本次仅补充测试覆盖，不改 spec 级要求）

## Impact

- 新增文件：`tests/helpers/mock-http-server.ts`、`tests/jira-tracker-http.test.ts`
- 不影响生产代码
- 测试数量预计增加 ~20-25 个
- `npm test` 运行时间增加可忽略（Mock HTTP Server 用 `127.0.0.1` 绑定随机端口，无外部依赖）
- 覆盖率：`src/adapters/jira/tracker.ts` 的 `request` 方法从 0% 覆盖提升至接近全覆盖
