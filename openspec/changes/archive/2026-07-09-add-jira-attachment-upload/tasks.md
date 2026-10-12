## 1. MCP server 附件上传工具实现

- [x] 1.1 在 `src/mcp/jira-server.ts` 中添加 `jira_upload_attachment` 工具常量(name、description、inputSchema,含 `issue_key`/`filename`/`content` required 属性)
- [x] 1.2 实现 `generateBoundary()` 函数:生成 16 字节随机 hex 字符串作为 multipart boundary
- [x] 1.3 实现 `buildMultipartBody(filename, contentBase64)` 函数:用 `Buffer.concat` 拼装 multipart/form-data body,包含正确的 `--boundary` 分隔符、`Content-Disposition` header(含 filename)、文件字段名 `file`
- [x] 1.4 实现 `executeJiraUploadAttachment(issueKey, filename, contentBase64)` 函数:校验 content 大小(≤10MB),复用 `buildAuthHeader`/`buildBaseUrl`,设置 `Content-Type: multipart/form-data; boundary=<boundary>`,发送 POST 到 `/issue/{issueKey}/attachments`,返回与 `executeJiraRest` 相同格式的结构化结果
- [x] 1.5 更新 `handleToolsList()`:在 tools 数组中同时声明 `jira_rest` 和 `jira_upload_attachment`
- [x] 1.6 更新 `handleToolsCall()`:按 `toolName` 路由到 `jira_rest`(现有逻辑)或 `jira_upload_attachment`(新逻辑,提取 issue_key/filename/content 参数)

## 2. WORKFLOW.md starter 模板更新

- [x] 2.1 在 `src/cli/init.ts` 的 `STARTER_WORKFLOW` 模板中,`jira_rest` 工具说明后新增 `jira_upload_attachment` 工具说明段落,包含调用示例与 base64 编码方法 `fs.readFileSync(path).toString('base64')`
- [x] 2.2 在代码任务完成流程(For code tasks)中增加可选附件上传步骤:如有产出文件(截图/日志/报告),用 `jira_upload_attachment` 上传
- [x] 2.3 在非代码任务完成流程(For non-code tasks)中增加可选附件上传步骤
- [x] 2.4 更新 Tracking 段落,提及附件上传作为跟踪信息的一部分

## 3. 测试

- [x] 3.1 在 `tests/mcp.test.ts` 中新增测试:`tools/list` 响应同时包含 `jira_rest` 和 `jira_upload_attachment` 两个工具声明
- [x] 3.2 新增测试:`jira_upload_attachment` 工具的 inputSchema 包含 `issue_key`、`filename`、`content` 三个 required 属性
- [x] 3.3 新增测试:超大 base64 content(>10MB)被拒绝,返回 `{ success: false, status: 0, error: "..." }` 且不发起 HTTP 请求(用 mock fetch 验证未被调用)
- [x] 3.4 新增测试:未知工具名调用仍返回错误,不崩溃(两个工具都已注册的场景)

## 4. 文档更新

- [x] 4.1 在 `docs/usage.md` 中新增附件上传场景说明,包含 `jira_upload_attachment` 工具用法与示例

## 5. 验证

- [x] 5.1 运行 `npm run lint` 并修复所有 lint 问题
- [x] 5.2 运行 `npm run typecheck` 并修复所有类型错误
- [x] 5.3 运行 `npm test` 确保所有测试通过(含新增测试)
- [x] 5.4 运行 `npm run build` 确保构建成功,`dist/mcp/jira-server.js` 包含新工具
