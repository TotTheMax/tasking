## ADDED Requirements

### Requirement: Issue 标签变更操作
`jira-tracker` 适配器 SHALL 提供 `updateIssue(issueKey, fields)` 操作，对指定 issue 发起 `PUT /rest/api/2/issue/<key>`（或 API v3 等价端点）以写回 `fields` 中的字段（至少 `labels`）。该操作 SHALL 供飞书桥（`/agent <name>` 切换）调用，SHALL NOT 供结构化调度器/runner 调用（编排器保持只读，见「Tracker 写入边界」）。调用方 SHALL 自行做读-改-写以保证 `labels` 为读出的全部现有标签经增删后的完整数组（Jira `PUT` 替换整个 labels 数组）。操作失败 SHALL 映射为既有错误类别（`jira_api_status` / `jira_api_request`）。

#### Scenario: 写回 labels
- **WHEN** 桥以 `updateIssue("ENG-1", { labels: ["bug", "agent:review"] })` 调用
- **THEN** 适配器对该 issue 发起 PUT，labels 字段写回该完整数组

#### Scenario: 调度器不调用写操作
- **WHEN** 结构化调度器派发与 reconcile
- **THEN** 编排器不调用 `updateIssue`（仅桥/agent 工具调用）

#### Scenario: 失败映射既有错误类别
- **WHEN** `updateIssue` 的 PUT 返回非 2xx 或网络失败
- **THEN** 抛出 `jira_api_status` 或 `jira_api_request` 错误（与既有读操作一致）
