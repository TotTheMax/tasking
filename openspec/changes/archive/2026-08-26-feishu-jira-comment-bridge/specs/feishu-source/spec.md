## MODIFIED Requirements

### Requirement: 飞书 v1 接入范围
`feishu-source` 适配器 SHALL 接入飞书 IM 文本消息(v1)，通过 REST 轮询 `GET /im/v1/messages` 拉取会话新消息（SHALL NOT 接收 webhook 推送）。SHALL 提供 `listMessages(chatId, sinceCursor)` 供 CommentBridge 轮询绑定话题。富文本/卡片/文件/图片消息在 v1 范围外，SHALL 被忽略或记录后跳过。`@mention` SHALL NOT 再作为接入条件（绑定上下文 + `/` 命令前缀取代其作为相关性判据，由 CommentBridge 判定）。

#### Scenario: 轮询拉取会话消息
- **WHEN** CommentBridge 调用 `listMessages(chatId, sinceCursor)`
- **THEN** 返回该会话 sinceCursor 之后的新文本消息

#### Scenario: 非 text 忽略
- **WHEN** 拉取到富文本/卡片/图片消息
- **THEN** 忽略(v1)，可选记录

#### Scenario: 不接收 webhook
- **WHEN** feishu-source 启用
- **THEN** SHALL NOT 监听 webhook 入站端口

### Requirement: 飞书回复支持
适配器 SHALL 支持 `reply(chatId, text)`（顶层文本回复）与 `replyInThread(chatId, rootId, text)`（话题内回复，POST 带 `root_id`）。失败 SHALL 作为错误暴露。

#### Scenario: 话题内回复
- **WHEN** 调用 `replyInThread(chatId, rootId, text)`
- **THEN** 在该话题根下发一条文本回复

#### Scenario: 顶层回复
- **WHEN** 调用 `reply(chatId, text)`
- **THEN** 向该会话发一条顶层文本消息

### Requirement: 飞书认证与端点配置
适配器 SHALL 从配置读取飞书应用凭据(app id/secret 或 `$VAR` 间接引用)。SHALL 读 `feishu.intake_chat_id`（启用时必填）、`feishu.poll_interval_ms`（默认 5000）、`feishu.create_issue_type`。`feishu.verification_token`/`encrypt_key` 在 REST 轮询模式下 SHALL NOT 被使用（保留供将来 webhook 模式）。飞书源启用时，缺失 app id/secret 或 `intake_chat_id` SHALL 为配置校验错误。

#### Scenario: 缺 intake_chat_id 校验失败
- **WHEN** feishu.enabled 但 `intake_chat_id` 缺失
- **THEN** 配置校验失败

#### Scenario: verification_token 不被使用
- **WHEN** REST 轮询模式运行
- **THEN** `verification_token`/`encrypt_key` 不参与任何校验/解密

## REMOVED Requirements

### Requirement: 幂等接入 inbox
**Reason**: 飞书不再经 inbox 缓冲供 triage；改为 REST 轮询 + binding 游标同步（见 comment-bridge）。
**Migration**: 幂等由 comment-bridge 的 per-binding 游标（`last_feishu_msg_id`）+ sentinel/`msg_id` 兜底提供。

### Requirement: 事件接入不阻塞
**Reason**: triage/route-agent 路径移除；同步改为 sibling 组件 CommentBridge 的出站轮询，不接触 scheduler（见 comment-bridge"不阻塞 scheduler"要求）。
**Migration**: 不阻塞现为结构性保证（sibling 组件），非 feishu-source 适配器职责。
