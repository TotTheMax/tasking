## Context

JiraTracker 的测试目前完全依赖内联 mock fetch——即用手写函数替换全局 `fetch`，返回预设 `Response` 对象。这种方式能验证逻辑分支（JQL 字符串构造、状态过滤、分页循环），但无法覆盖真实 HTTP 传输层的细节：

- **URL 拼接**：`request()` 方法拼接 `${base}${path}`，mock fetch 接收的 URL 是已拼接后的字符串，不验证 `fetch` 是否真的能解析它
- **Header 序列化**：mock fetch 收到的是 `RequestInit.headers` 对象，不验证 `fetch` 实际发送的 HTTP header
- **AbortController 超时**：mock fetch 无法真实模拟"服务器延迟响应导致 `AbortController.abort()` 触发"的场景
- **Fallback 路径**：`fetchCandidateIssues` 在活跃状态 JQL 失败后 fallback 到全项目查询，这是一个跨两个真实 HTTP 请求的序列，mock fetch 用索引数组模拟，但无法验证请求序列的 URL/method 一致性
- **畸形响应**：mock fetch 总是返回合法 JSON，不覆盖"服务器返回 HTML 错误页"或"连接中途断开"的情况

覆盖率报告确认了这些缺口：`request()` 方法 0% 覆盖，`fetchCandidateIssues`/`fetchIssuesByStates` 的 fallback 分支未测试，`fetchIssueStatesByIds` 仅测空数组。

## Goals / Non-Goals

**Goals:**
- 提供一个零依赖（仅用 Node 内置 `http` 模块）的 Mock HTTP Server 测试助手，能在随机端口上启动、录制请求、返回可配置响应
- 通过真实 HTTP 请求（`fetch` 到 `http://127.0.0.1:<port>`）测试 JiraTracker 的全部 HTTP 层行为
- 覆盖所有现有测试缺口：fallback 路径、认证 header、URL 拼接、分页边界、超时、畸形响应、归一化边缘
- 每个测试验证一条真实行为路径（"测试支撑功能"原则），不凑行数

**Non-Goals:**
- 不替换现有内联 mock fetch 测试——它们仍在 `jira-tracker.test.ts` 中保留，覆盖纯逻辑分支
- 不测试 `mcp/jira-server.ts`（`jira_rest` MCP 工具）——那是单独的测试覆盖范围
- 不测试 `cli/index.ts` 的 HTTP dashboard 启动——已有 `observability.test.ts` 覆盖
- 不实现端到端手动测试（真实 Jira 实例）——用户明确表示"先不用"
- 不修改任何生产代码——纯测试补充

## Decisions

### 决策 1：用 Node 内置 `http` 模块，不用 nock/msw

**选择**：基于 `node:http` 的 `createServer` 实现 Mock HTTP Server。

**理由**：
- 零新增依赖——`http` 是 Node 内置模块，项目已有 `http-dashboard.ts` 使用它
- nock 拦截 `fetch` 调用，本质上和内联 mock fetch 是同一抽象层——都不经过真实 HTTP 栈
- msw 需要启动 worker、注册 service worker，对 Node 测试环境过重
- 真实 HTTP server 测试全栈：URL 拼接 → `fetch` 序列化 → TCP → `http.Server` → 响应解析，能捕获 mock fetch 无法发现的问题

**替代方案考虑**：
- nock：轻量但拦截层和 mock fetch 相同，不增加覆盖深度
- msw（Mock Service Worker）：功能丰富但依赖重、Node 环境配置复杂
- undici 的 `MockAgent`：undici 是 Node `fetch` 的底层实现，拦截层面更深，但 API 复杂且版本耦合风险

### 决策 2：Server 设计——请求录制 + 响应序列

**选择**：`createMockJiraServer` 返回 `{ port, baseUrl, requests, close }`。

- `requests`：数组，每个元素 `{ method, url, headers, body }`，测试可断言请求内容
- 响应通过 `handler` 函数配置：`handler(req) => { status, body, delayMs? }`
- `delayMs` 模拟延迟（用于超时测试）
- `close()` 关闭服务器，在 `afterEach` 中调用

**理由**：保持简单（~80 行），不引入路由/中间件抽象。Jira REST API 只有 `/search` 一个端点被测试，不需要复杂路由。

### 决策 3：不重复已有覆盖

**选择**：新测试文件 `jira-tracker-http.test.ts` 只覆盖现有测试的缺口，不重复已有覆盖。

**已有覆盖（保留在 `jira-tracker.test.ts`，不重复）**：
- 基本 JQL 构造（project + active_states）
- 基本 assignee 过滤（3 个场景）
- 基本分页（2 页合并）
- 基本 401/网络错误映射
- `normalizeIssue` 的 labels/priority/blockers/timestamps/url/assignee 基本场景

**新增覆盖（仅在新文件中）**：
- Fallback 路径（`jira_api_status` → 全项目查询 + 客户端过滤）
- `fetchIssueStatesByIds` 真实 ID 列表
- 认证 header 的真实 HTTP 值验证（bearer/basic）
- URL 拼接（末尾斜杠）的真实 HTTP 请求验证
- 分页边界（total 缺失、提前终止）
- 超时（延迟响应）
- 畸形响应（非 JSON、缺失字段）
- 归一化边缘（assignee email/key fallback、priority 数字、blockers 非 Blocks 过滤）

### 决策 4：超时测试用短超时 + 短延迟

**选择**：超时测试用 `timeoutMs: 100` + 服务器 `delayMs: 500`，而非真实 30 秒超时。

**理由**：测试套件速度优先。`request()` 方法接受 `timeoutMs` 参数（默认 30000），测试传 100ms 即可在 <1 秒内验证 AbortController 超时路径。

## Risks / Trade-offs

- [端口冲突] → 用 `server.listen(0)` 让 OS 分配随机端口，避免固定端口冲突
- [服务器未关闭导致测试泄漏] → 每个 `describe` 用 `afterEach(close)` 确保清理；`close()` 返回 Promise 等待完全关闭
- [真实 HTTP 请求比 mock 慢] → Mock server 在 `127.0.0.1` 上，单次请求 <1ms，20+ 个测试增加的总时间可忽略（<100ms）
- [mock fetch 与 mock server 覆盖重叠] → 故意不重叠：mock fetch 留纯逻辑分支，mock server 专攻传输层和缺口。两套测试互补而非冗余
