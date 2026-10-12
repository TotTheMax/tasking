## ADDED Requirements

### Requirement: jira_upload_attachment 工具上传附件
MCP server SHALL 暴露一个名为 `jira_upload_attachment` 的工具,接受 `issue_key`(string)、`filename`(string)、`content`(string, base64 编码的文件内容)作为输入,用 tracker 凭据构造 `multipart/form-data` 请求发送到 Jira 附件上传接口 `POST /issue/{issue_key}/attachments`,并返回响应。agent SHALL NOT 接触 tracker 凭据——凭据通过 MCP server 的 env vars 注入,与 `jira_rest` 工具共用。

#### Scenario: agent 调用 jira_upload_attachment 上传截图
- **WHEN** agent 调用 `jira_upload_attachment({ issue_key: "OS-262", filename: "screenshot.png", content: "<base64>" })`
- **THEN** tasking 用已配的 auth 向 Jira 发起 multipart/form-data POST 请求,附件上传成功后返回 Jira 附件元数据

#### Scenario: 上传文本日志文件
- **WHEN** agent 调用 `jira_upload_attachment({ issue_key: "OS-262", filename: "test-output.log", content: "<base64>" })`
- **THEN** Jira 中该任务新增一个附件

#### Scenario: jira_upload_attachment 返回错误时不崩溃
- **WHEN** Jira 附件上传接口返回非 2xx(如任务不存在、权限不足)
- **THEN** MCP server 返回 `{ success: false, status: <code>, error: <message> }` 给 agent,不崩溃

### Requirement: multipart/form-data 请求构造
MCP server SHALL 手动构造 `multipart/form-data` 请求体,使用随机生成的 boundary 分隔字段。boundary SHALL 为 16 字节随机 hex 字符串,以避免与文件内容碰撞。`Content-Type` header SHALL 为 `multipart/form-data; boundary=<boundary>`。文件字段名 SHALL 为 `file`(Jira 附件接口要求)。filename SHALL 从输入参数获取,并设置在 `Content-Disposition` header 中。

#### Scenario: multipart body 包含正确 boundary 与 filename
- **WHEN** MCP server 构造附件上传请求
- **THEN** 请求 Content-Type 包含 boundary 参数,body 中用该 boundary 分隔字段,文件字段的 Content-Disposition 包含 `filename="<传入的filename>"`

#### Scenario: 不同 filename 上传
- **WHEN** agent 传入 filename 为 `report.pdf`
- **THEN** multipart 请求中 Content-Disposition 的 filename 为 `report.pdf`

### Requirement: 附件大小限制
MCP server SHALL 限制 base64 content 大小不超过 10MB。超出限制时 SHALL 返回错误 `{ success: false, status: 0, error: "attachment exceeds 10MB limit" }`,不发起 HTTP 请求。

#### Scenario: 超大附件被拒绝
- **WHEN** agent 传入超过 10MB 的 base64 content
- **THEN** MCP server 返回大小超限错误,不调用 Jira API

#### Scenario: 正常大小附件通过
- **WHEN** agent 传入 5MB 的 base64 content
- **THEN** MCP server 正常构造请求并上传

### Requirement: jira_upload_attachment 工具声明
MCP server SHALL 在 `tools/list` 响应中声明 `jira_upload_attachment` 工具的 name、description、inputSchema。inputSchema SHALL 包含 `issue_key`(required string)、`filename`(required string)、`content`(required string, base64)属性。description SHALL 说明该工具用于上传附件到 Jira 任务。

#### Scenario: tools/list 返回两个工具
- **WHEN** opencode 向 MCP server 发送 `tools/list` 请求
- **THEN** 响应包含 `jira_rest` 和 `jira_upload_attachment` 两个工具的声明

#### Scenario: 未知工具名仍返回错误
- **WHEN** agent 调用不存在的工具名
- **THEN** MCP server 返回错误结果,不崩溃(与现有 `jira_rest` 行为一致)

## MODIFIED Requirements

### Requirement: jira_rest 工具声明与错误处理
MCP server SHALL 在 `tools/list` 响应中声明 `jira_rest` 工具的 name、description、inputSchema。不支持的工具名 SHALL 返回错误结果但不使 MCP server 崩溃。Jira API 非 2xx 响应 SHALL 返回结构化错误给 agent,不抛异常。`jira_rest` 工具的行为不变——新增的 `jira_upload_attachment` 工具处理附件上传,`jira_rest` 仍为纯 JSON REST wrapper。

#### Scenario: tools/list 返回 jira_rest
- **WHEN** opencode 向 MCP server 发送 `tools/list` 请求
- **THEN** 响应包含 `jira_rest` 工具的 name、description、inputSchema(method/path/body)

#### Scenario: 未知工具名返回错误
- **WHEN** agent 调用不存在的工具名
- **THEN** MCP server 返回错误结果,不崩溃,opencode 会话继续
