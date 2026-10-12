## Why

`jira_rest` MCP 工具仅支持 JSON body,无法处理 Jira 附件上传接口(`POST /issue/{key}/attachments`)所需的 `multipart/form-data` 请求。agent 当前无法将截图、日志、测试报告等产物上传到 Jira 任务,跟踪信息只能写在评论里,缺少可追溯的附件凭证。

## What Changes

- 在 `jira_rest` MCP server 中新增 `jira_upload_attachment` 工具,接受 `issue_key`、`filename`、`content`(base64 编码)参数,内部构造 `multipart/form-data` 请求调用 Jira 附件上传接口
- 复用已有的 tracker 凭据(env vars 注入),agent 不接触 token
- 在 `tools/list` 响应中声明新工具的 name、description、inputSchema
- 更新 `WORKFLOW.md` starter 模板(`init.ts`),在 `jira_rest` 工具说明中增加 `jira_upload_attachment` 用法示例与附件上传流程指引
- 代码任务和非代码任务的完成流程中,SHALL 指示 agent 在有产出文件(截图、日志、报告)时上传附件

## Capabilities

### New Capabilities

(无)

### Modified Capabilities

- `jira-rest-tool`: MCP server 新增 `jira_upload_attachment` 工具,支持 `multipart/form-data` 附件上传;`tools/list` 响应增加该工具声明
- `workflow-prompt-optimization`: WORKFLOW.md starter 模板增加 `jira_upload_attachment` 用法示例与附件上传流程指引

## Impact

- **代码**:`src/mcp/jira-server.ts`(新增工具处理函数、multipart 构造)、`src/cli/init.ts`(更新 starter 模板)
- **测试**:`tests/mcp.test.ts`(新增 `jira_upload_attachment` 工具声明与 multipart 构造的单元测试)
- **文档**:`docs/usage.md`(附件上传场景说明)
- **依赖**:无新依赖,使用 Node 内置 `Buffer` + 手动构造 multipart boundary(避免引入 `form-data` 包)
- **API**:MCP server 对外多暴露一个工具,不影响已有 `jira_rest` 工具行为
