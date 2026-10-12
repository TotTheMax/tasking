# jira-tracker-http-tests Specification

## Purpose
TBD - created by archiving change add-jira-tracker-http-tests. Update Purpose after archive.
## Requirements
### Requirement: Mock HTTP Server 测试助手
测试 SHALL 提供一个基于 Node 内置 `http` 模块的 Mock HTTP Server 助手（`tests/helpers/mock-http-server.ts`），用于通过真实 HTTP 请求测试 JiraTracker HTTP 层。Server SHALL 绑定 `127.0.0.1` 上的随机端口（`listen(0)`），SHALL 录制每个入站请求的 method、url、headers、body 到一个可断言数组，SHALL 通过可配置 handler 函数返回响应（含 status、body、可选 delayMs）。Server SHALL 提供 `close()` 方法返回 Promise 以确保测试后清理。

#### Scenario: 录制请求内容
- **WHEN** JiraTracker 向 Mock Server 发送 `POST /rest/api/2/search` 请求，body 为 `{ jql: "project = ENG", startAt: 0 }`
- **THEN** `requests` 数组含一条记录，其 method 为 `POST`、url 含 `/search`、body 解析后 `jql` 为 `"project = ENG"`

#### Scenario: 返回可配置响应
- **WHEN** handler 配置为返回 `{ status: 200, body: { total: 1, issues: [...] } }`
- **THEN** JiraTracker 收到 HTTP 200 响应，body 解析为含 `total` 和 `issues` 的 JSON

#### Scenario: 模拟响应延迟
- **WHEN** handler 配置为返回 `{ body: {}, delayMs: 500 }` 且 JiraTracker `timeoutMs` 设为 100
- **THEN** 请求因 AbortController 超时而失败，错误映射为 `jira_api_request` 类别

#### Scenario: 测试后清理
- **WHEN** 测试调用 `close()`
- **THEN** HTTP Server 停止监听，端口释放，Promise resolve

### Requirement: Fallback 路径测试
测试 SHALL 覆盖 `fetchCandidateIssues` 和 `fetchIssuesByStates` 在活跃状态 JQL 查询返回非 2xx（`jira_api_status`）时，fallback 到全项目查询并用客户端 `matchStateNames` 过滤的行为。

#### Scenario: fetchCandidateIssues fallback 过滤
- **WHEN** 活跃状态 JQL 查询返回 HTTP 400，全项目查询返回 3 个 issue（2 个活跃状态、1 个 terminal 状态）
- **THEN** `fetchCandidateIssues` 返回 2 个活跃状态 issue，不抛出错误

#### Scenario: fetchIssuesByStates fallback 过滤
- **WHEN** 指定状态 JQL 查询返回 HTTP 500，全项目查询返回 3 个 issue（2 个匹配指定状态）
- **THEN** `fetchIssuesByStates` 返回 2 个匹配 issue，不抛出错误

#### Scenario: 非 jira_api_status 错误不触发 fallback
- **WHEN** 查询因网络错误失败（`jira_api_request` 类别）
- **THEN** 不触发 fallback，错误向上传播

### Requirement: fetchIssueStatesByIds 真实 ID 查询
测试 SHALL 覆盖 `fetchIssueStatesByIds` 用真实 ID 列表发起查询，验证 JQL 中数字 ID 无引号、非数字 ID 加引号、混合列表的正确拼接。

#### Scenario: 数字 ID 列表
- **WHEN** 调用 `fetchIssueStatesByIds(["10001", "10002"])`
- **THEN** 请求 body 的 JQL 含 `id in (10001, 10002)`（无引号）

#### Scenario: 非数字 ID 列表
- **WHEN** 调用 `fetchIssueStatesByIds(["ENG-1", "ENG-2"])`
- **THEN** 请求 body 的 JQL 含 `id in ("ENG-1", "ENG-2")`（加引号）

#### Scenario: 混合 ID 列表
- **WHEN** 调用 `fetchIssueStatesByIds(["10001", "ENG-2"])`
- **THEN** 请求 body 的 JQL 含 `id in (10001, "ENG-2")`（数字无引号、字符串加引号）

#### Scenario: 返回归一化任务
- **WHEN** Mock Server 返回 `{ total: 1, issues: [{ id: "10001", key: "ENG-1", fields: { status: { name: "In Progress" } } }] }`
- **THEN** 返回数组含一个 Task，其 `id` 为 `"10001"`、`identifier` 为 `"ENG-1"`、`state` 为 `"In Progress"`

### Requirement: 认证 header HTTP 级验证
测试 SHALL 通过真实 HTTP 请求验证 `auth_mode: bearer` 发送 `Authorization: Bearer <token>`，`auth_mode: basic`（默认）发送 `Authorization: Basic <base64(user:token)>`。

#### Scenario: bearer 模式 header 值
- **WHEN** tracker 配置 `auth_mode: bearer`、`api_key: "tok123"`，向 Mock Server 发送请求
- **THEN** 录制的请求 `authorization` header 恰为 `Bearer tok123`

#### Scenario: basic 模式 header 值
- **WHEN** tracker 配置 `api_user: "alice"`、`api_key: "secret"`（无 auth_mode），向 Mock Server 发送请求
- **THEN** 录制的请求 `authorization` header 为 `Basic <base64(alice:secret)>`

#### Scenario: Content-Type 与 Accept header
- **WHEN** JiraTracker 向 Mock Server 发送请求
- **THEN** 录制的请求含 `content-type: application/json` 和 `accept: application/json`

### Requirement: 端点 URL 拼接验证
测试 SHALL 通过真实 HTTP 请求验证 endpoint 末尾斜杠被正确剥离，`/search` 路径被正确拼接。

#### Scenario: 末尾单斜杠
- **WHEN** endpoint 为 `http://127.0.0.1:<port>/rest/api/2/`（末尾单斜杠）
- **THEN** Mock Server 收到的请求 URL 路径为 `/rest/api/2/search`（无双斜杠）

#### Scenario: 末尾多斜杠
- **WHEN** endpoint 为 `http://127.0.0.1:<port>/rest/api/2//`（末尾多斜杠）
- **THEN** Mock Server 收到的请求 URL 路径为 `/rest/api/2/search`

### Requirement: 分页边界测试
测试 SHALL 覆盖分页循环的边界行为：`total` 字段缺失时的终止、`issues.length < pageSize` 的提前终止、多页结果的顺序合并。

#### Scenario: total 字段缺失时终止
- **WHEN** Mock Server 返回 `{ issues: [...] }`（无 `total` 字段），issues 数组非空
- **THEN** 分页循环在第一页后终止（`total` 默认为 `startAt`），返回第一页结果

#### Scenario: issues 少于 pageSize 提前终止
- **WHEN** pageSize 为 50，Mock Server 返回 10 个 issue 且 `total: 10`
- **THEN** 循环在第一页后终止（`issues.length < pageSize`），只发一次请求

#### Scenario: 多页合并保持顺序
- **WHEN** pageSize 为 1，Mock Server 依次返回 `[{ id: "1" }]`（total: 2）和 `[{ id: "2" }]`（total: 2）
- **THEN** 合并结果顺序为 `[id:"1", id:"2"]`

### Requirement: 畸形响应测试
测试 SHALL 覆盖 JiraTracker 对畸形 HTTP 响应的处理：非 JSON body、缺失 `issues` 字段、空 `issues` 数组。

#### Scenario: 非 JSON body 映射为错误
- **WHEN** Mock Server 返回 HTTP 200 但 body 为 `<html>error</html>`（非 JSON）
- **THEN** 请求抛出 `TaskingError`，类别为 `jira_api_request`（JSON 解析失败归为请求错误）

#### Scenario: 缺失 issues 字段
- **WHEN** Mock Server 返回 `{ total: 5 }`（无 `issues` 字段）
- **THEN** JiraTracker 将 issues 视为空数组，返回空结果（不崩溃）

#### Scenario: 空 issues 数组
- **WHEN** Mock Server 返回 `{ total: 0, issues: [] }`
- **THEN** 返回空数组，分页循环终止

### Requirement: 归一化边缘场景测试
测试 SHALL 覆盖 `normalizeIssue` 对 assignee、priority、blockers 的边缘场景处理。

#### Scenario: assignee emailAddress fallback
- **WHEN** Jira issue 的 assignee 字段为 `{ emailAddress: "bob@example.com" }`（无 accountId）
- **THEN** 归一化后 `task.assignee` 为 `"bob@example.com"`

#### Scenario: assignee key fallback
- **WHEN** Jira issue 的 assignee 字段为 `{ key: "userkey123" }`（无 accountId、无 emailAddress）
- **THEN** 归一化后 `task.assignee` 为 `"userkey123"`

#### Scenario: 数字 priority
- **WHEN** Jira issue 的 priority 字段为数字 `3`
- **THEN** 归一化后 `task.priority` 为 `3`

#### Scenario: 非 Blocks 关系类型被过滤
- **WHEN** Jira issue 有 issuelinks 含 `{ type: { name: "Relates" } }` 和 `{ type: { name: "Blocks" } }`
- **THEN** `blocked_by` 只含 Blocks 类型的 blocker，长度为 1

#### Scenario: blocker 缺失 inwardIssue 字段
- **WHEN** Jira issue 有 Blocks 类型 issuelink 但无 `inwardIssue` 字段
- **THEN** 该 link 被跳过，`blocked_by` 为空数组

