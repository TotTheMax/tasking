## MODIFIED Requirements

### Requirement: Tracker 写入边界
scheduler/runner SHALL NOT 调用任何 Jara 写/变更 API（派发与 reconcile 保持只读）。但 CommentBridge SHALL 提供受限的 tracker 写操作用于评论同步与命令：`postComment(issueKey, body)`（带 sentinel）、`createIssue(fields)`、`transitionIssue(issueKey, transitionId)`，以及只读 `fetchComments(issueKey, afterId)`、`fetchTransitions(issueKey)`。这些写操作 SHALL 只由 CommentBridge 在同步/命令路径调用，SHALL NOT 暴露给 scheduler/runner。agent 经 MCP 的读写（`jira_rest`/`jira_upload_attachment`）SHALL 保持不变。

#### Scenario: scheduler 仍只读
- **WHEN** scheduler 派发与 reconcile
- **THEN** 不调用任何 Jara 写/变更 API

#### Scenario: CommentBridge 受限写
- **WHEN** CommentBridge 同步或处理命令
- **THEN** 可调用 `postComment`/`createIssue`/`transitionIssue`（仅桥路径）

#### Scenario: agent MCP 不变
- **WHEN** agent 经 MCP 读写 Jara
- **THEN** 行为与本变更前一致

## ADDED Requirements

### Requirement: 评论读写与 issue 创建/转移操作
`jira-tracker` 适配器 SHALL 提供：`fetchComments(issueKey, afterCommentId)`（返回 issue 评论，按 id > after 排序）、`postComment(issueKey, body)`（建评论）、`createIssue(fields)`（建 issue，fields 含 project/issuetype/summary/description/labels/assignee）、`fetchTransitions(issueKey)`（返回可用转移，含 transition id 与 `to.name`）、`transitionIssue(issueKey, transitionId)`（转状态）。所有操作 SHALL 走现有 `request()` 助手，复用同一认证/超时/错误映射。Jara Cloud (v3) comment body SHALL 按 ADF 包装；Jara Server (v2) SHALL 接受裸字符串。

#### Scenario: fetchComments 增量
- **WHEN** 调用 `fetchComments(key, afterId)`
- **THEN** 返回 id > afterId 的评论

#### Scenario: postComment 建
- **WHEN** 调用 `postComment(key, body)`
- **THEN** 在该 issue 建一条评论

#### Scenario: createIssue 建默认
- **WHEN** 调用 `createIssue({project, issuetype, summary, description, labels, assignee})`
- **THEN** 建一条 issue

#### Scenario: fetchTransitions 运行时发现
- **WHEN** 调用 `fetchTransitions(key)`
- **THEN** 返回该 issue 当前可用转移（id + `to.name`）

#### Scenario: transitionIssue 转
- **WHEN** 调用 `transitionIssue(key, transitionId)`
- **THEN** issue 转到该状态
