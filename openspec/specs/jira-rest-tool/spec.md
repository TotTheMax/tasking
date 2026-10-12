## Purpose

jira_rest MCP 服务器：为 coding agent 暴露 Jira REST 工具。
## Requirements
### Requirement: jira_rest MCP server 暴露 Jira REST 工具
tasking SHALL 内置一个 `jira_rest` MCP server(`src/mcp/jira-server.ts`),通过 stdio JSON-RPC 与 opencode 通信。该 server SHALL 暴露一个名为 `jira_rest` 的工具,接受 `method`(HTTP 方法)、`path`(Jira REST 路径)、`body`(可选 JSON body)作为输入,用 WORKFLOW.md 中已配的 tracker 凭据(endpoint、api_key、auth_mode、api_user)执行 Jira REST API 调用,并返回响应。agent SHALL NOT 接触 tracker 凭据——凭据通过 MCP server 的 env vars 注入,仅 MCP server 子进程可访问。

#### Scenario: agent 调用 jira_rest 转状态
- **WHEN** agent 调用 `jira_rest({ method: "POST", path: "/issue/OS-262/transitions", body: { transition: { id: "31" } } })`
- **THEN** tasking 用已配的 bearer/basic auth 向 Jira 发起 POST 请求并返回结果

#### Scenario: agent 调用 jira_rest 添加评论
- **WHEN** agent 调用 `jira_rest({ method: "POST", path: "/issue/OS-262/comment", body: { body: "工作完成" } })`
- **THEN** Jira 中该任务新增一条评论

#### Scenario: jira_rest 返回错误时不崩溃
- **WHEN** Jira API 返回非 2xx
- **THEN** MCP server 返回 `{ success: false, status: <code>, error: <message> }` 给 agent,不崩溃

### Requirement: workspace 级自动注入 MCP 配置
`runAttempt` SHALL 在 `createWorkspace` 之后、`spawn(opencode run)` 之前,向工作区写入 `.opencode/opencode.json`,包含 `jira_rest` MCP server 配置与 tracker 凭据(env vars)。注入 SHALL 仅影响该工作区的 opencode 进程,SHALL NOT 修改全局 `~/.config/opencode/opencode.json`。若工作区已存在 `.opencode/opencode.json`,SHALL 合并 MCP 配置而非覆盖整个文件。

#### Scenario: 注入后 opencode 发现 jira 工具
- **WHEN** `runAttempt` 注入 `.opencode/opencode.json` 后启动 `opencode run`
- **THEN** opencode 发现 `jira` MCP server 并向 agent 暴露 `jira_rest` 工具

#### Scenario: 不污染全局配置
- **WHEN** `runAttempt` 注入 workspace 级配置
- **THEN** `~/.config/opencode/opencode.json` 不被修改

#### Scenario: 合并已有 workspace 配置
- **WHEN** 工作区已存在 `.opencode/opencode.json` 含其他 MCP 配置
- **THEN** tasking 合并 `jira` MCP 配置进去,不覆盖已有配置

### Requirement: 凭据复用 WORKFLOW.md 配置
`jira_rest` MCP server SHALL 复用 WORKFLOW.md 中 `tracker.endpoint`、`tracker.api_key`、`tracker.auth_mode`、`tracker.api_user` 的值。agent SHALL NOT 需要读取 token 或凭据文件。`$VAR` 间接引用 SHALL 在注入 env vars 前解析完成。

#### Scenario: bearer 模式注入
- **WHEN** WORKFLOW.md 配置 `auth_mode: bearer`、`api_key: $JIRA_TOKEN`
- **THEN** 注入的 env vars 中 `JIRA_AUTH_MODE=bearer`、`JIRA_API_KEY=<解析后的 token 值>`

#### Scenario: basic 模式注入
- **WHEN** WORKFLOW.md 配置 `auth_mode: basic`(或未配)、`api_user: user@e.com`、`api_key: tok`
- **THEN** 注入的 env vars 中 `JIRA_AUTH_MODE=basic`、`JIRA_API_USER=user@e.com`、`JIRA_API_KEY=tok`

### Requirement: prompt 模板定义代码任务与非代码任务的差异化回写流程
`WORKFLOW.md` 的 prompt body SHALL 定义两条 Jira 回写路径,参考 Symphony SPEC §11.5 交接态设计:

**代码任务**(工作区有 git 仓库):
1. 完成代码修改 → commit → push
2. 用 `jira_rest` 查询可用 transitions: `GET /issue/{key}/transitions`
3. 用 `jira_rest` 转状态为 review 交接态(由 `tracker.review_state` 配置或 prompt 指定)
4. 用 `jira_rest` 添加评论:变更摘要 + PR 链接(如有)+ 修改的文件列表
5. 用 `jira_rest` 添加标签(如 `needs-review`)
6. SHALL NOT 直接转"完成"——等人工 review + merge

**非代码任务**(文档、调研等):
1. 完成工作
2. 用 `jira_rest` 添加评论:工作摘要 + 产出说明
3. 用 `jira_rest` 直接转"完成"

prompt SHALL 根据 `attempt` 提供不同指令(首次 vs 续轮),参考 Symphony §12.3。

#### Scenario: 代码任务走 review 交接态
- **WHEN** agent 在有 git 仓库的工作区完成代码任务
- **THEN** prompt 指示 agent 用 `jira_rest` 转为 review 交接态,添加评论与标签,不直接转完成

#### Scenario: 非代码任务直接完成
- **WHEN** agent 完成非代码任务(无 git 仓库或文档类)
- **THEN** prompt 指示 agent 用 `jira_rest` 直接转"完成"

#### Scenario: agent 先查 transitions 再转状态
- **WHEN** prompt 指示 agent 转状态
- **THEN** agent 先 `GET /issue/{key}/transitions` 查可用 transitions,再按名称选 id 执行(不硬编码 id)

### Requirement: tasking retry 因状态变更而停止
当 agent 通过 `jira_rest` 将 Jira 任务状态转为非活跃态(review 交接态或完成态)后,tasking 的 retry 机制 SHALL 在下次 `fetchCandidateIssues` 或 `fetchIssueStatesByIds` 时发现状态非活跃,从而释放 claim 并停止重新派发。

#### Scenario: agent 转 review 态后 tasking 停止派发
- **WHEN** agent 用 `jira_rest` 将任务转为 "待审核"(非 active_states)
- **THEN** tasking retry 时发现状态非活跃,释放 claim,不再派发

#### Scenario: agent 转完成后 tasking 停止并清理
- **WHEN** agent 用 `jira_rest` 将任务转为 "完成"(terminal_states)
- **THEN** tasking reconcile 时发现终端状态,停止运行并清理工作区

### Requirement: jira_rest 工具声明与错误处理
MCP server SHALL 在 `tools/list` 响应中声明 `jira_rest` 工具的 name、description、inputSchema。不支持的工具名 SHALL 返回错误结果但不使 MCP server 崩溃。Jira API 非 2xx 响应 SHALL 返回结构化错误给 agent,不抛异常。`jira_rest` 工具的行为不变——新增的 `jira_upload_attachment` 工具处理附件上传,`jira_rest` 仍为纯 JSON REST wrapper。

#### Scenario: tools/list 返回 jira_rest
- **WHEN** opencode 向 MCP server 发送 `tools/list` 请求
- **THEN** 响应包含 `jira_rest` 工具的 name、description、inputSchema(method/path/body)

#### Scenario: 未知工具名返回错误
- **WHEN** agent 调用不存在的工具名
- **THEN** MCP server 返回错误结果,不崩溃,opencode 会话继续

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

