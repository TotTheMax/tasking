## Context

`jira_rest` MCP server(`src/mcp/jira-server.ts`)当前仅支持 JSON body 的 REST 调用。Jira 附件上传接口(`POST /rest/api/2/issue/{issueIdOrKey}/attachments`)要求 `multipart/form-data` 请求,且 `Content-Type` header 必须包含 boundary 参数。当前工具无法处理二进制文件上传,agent 完成任务后产生的截图、日志、测试报告等产物无法上传到 Jira。

MCP server 通过 stdio JSON-RPC 与 opencode 通信,所有数据均为文本。二进制文件内容需要编码后传输。

## Goals / Non-Goals

**Goals:**
- 在现有 MCP server 中新增 `jira_upload_attachment` 工具,支持上传文件到 Jira 任务
- 复用已有 tracker 凭据,agent 不接触 token
- 更新 WORKFLOW.md starter 模板,集成附件上传流程指引
- 无新外部依赖

**Non-Goals:**
- 不支持批量上传(一次一个附件)
- 不支持从 URL 拉取文件上传(agent 自行读取本地文件后 base64 编码传入)
- 不修改 `jira_rest` 工具的现有行为(保持 JSON REST wrapper 语义)
- 不实现附件下载或删除(仅上传)

## Decisions

### D1: 新增独立工具 `jira_upload_attachment`,而非扩展 `jira_rest`

**选择**: 新增独立工具,接受 `issue_key`、`filename`、`content`(base64) 参数。

**替代方案**: 扩展 `jira_rest` 增加 `formData`/`attachments` 参数。

**理由**: `jira_rest` 设计为纯 JSON REST wrapper(参考 Symphony `linear_graphql` 原始工具设计)。multipart/form-data 与 JSON REST 在请求构造、Content-Type、body 编码上完全不同。混用会破坏 `jira_rest` 的简洁语义。独立工具职责清晰,且 `tools/list` 自然暴露两个工具。

### D2: base64 编码文件内容

**选择**: `content` 参数为 base64 编码字符串,MCP server 解码后构造 multipart body。

**理由**: MCP stdio JSON-RPC 是文本协议,无法直接传二进制。base64 是 JSON 中编码二进制数据的标准方式。agent 可用 `fs.readFileSync(file).toString('base64')` 生成。

### D3: 手动构造 multipart/form-data,不引入 `form-data` 包

**选择**: 用 `Buffer.concat()` 手动拼接 multipart body,自动生成 boundary。

**替代方案**: 引入 `form-data` npm 包。

**理由**: multipart/form-data 格式简单(boundary 分隔的 `--boundary\r\n` + headers + `\r\n` + content + `\r\n--boundary--\r\n`)。手动构造避免为单一功能引入依赖,符合项目"无多余依赖"的约定。boundary 用随机 hex 字符串避免内容碰撞。

### D4: 限制附件大小

**选择**: base64 content 最大 10MB(约 7.5MB 原始文件),超出返回错误。

**理由**: 防止 agent 上传超大文件导致 MCP server 进程 OOM。Jira Cloud 单附件上限约 25MB,自托管 Jira 通常更小。10MB 足以覆盖截图、日志、报告等常见产物。

### D5: 附件上传集成到 WORKFLOW.md 流程

**选择**: 在 starter 模板的 `jira_rest` 工具说明后增加 `jira_upload_attachment` 用法示例,并在代码任务/非代码任务完成步骤中增加"如有产出文件则上传附件"的可选步骤。

**理由**: 附件上传是可选的(不是所有任务都有产出文件),所以用条件性语言("如有截图/日志/报告")。不强制每步都上传,避免无产出文件时 agent 误造文件。

## Risks / Trade-offs

- **[base64 编码开销]** → base64 使数据膨胀约 33%。10MB base64 对应约 7.5MB 原始文件。对于常见截图/日志足够;超大文件上传不在此变更范围内。
- **[agent 需自行读取文件并 base64 编码]** → prompt 模板中给出示例代码 `fs.readFileSync(path).toString('base64')`,agent 可直接复用。
- **[multipart boundary 碰撞]** → 使用 16 字节随机 hex boundary,碰撞概率可忽略。
- **[Jira 版本差异]** → Jira Cloud 用 `/rest/api/3`,自托管常用 `/rest/api/2`。endpoint 已在 WORKFLOW.md 中配置,MCP server 拼接 path 时复用同一 base,无需额外处理。
