## MODIFIED Requirements

### Requirement: 飞书 v1 接入范围
`feishu-source` 适配器 SHALL 接入飞书 IM 文本消息(v1)，通过 REST 轮询 `GET /im/v1/messages` 拉取会话新消息。SHALL 提供 `listMessages(chatId, sinceCursor)` 供 CommentBridge 的 Sweep 兜底清扫轮询绑定话题与 intake 群（主收路径为事件通道，见 `feishu-event-ingress` 能力）。富文本/卡片/文件/图片消息在 v1 范围外，SHALL 被忽略或记录后跳过。`@mention` SHALL NOT 再作为接入条件（绑定上下文 + `/` 命令前缀取代其作为相关性判据，由 CommentBridge 判定）。

#### Scenario: 轮询拉取会话消息
- **WHEN** CommentBridge 调用 `listMessages(chatId, sinceCursor)` 且 sinceCursor 非空
- **THEN** 返回该会话 sinceCursor 之后的新文本消息（含分页累积）

#### Scenario: 冷启动探测用带窗查询（取代无参数请求）
- **WHEN** intake 游标缺失时 CommentBridge 执行冷启动探测
- **THEN** 发送一次带 `start_time = now - 120s`、`end_time = now` 的窗口查询，取窗口内消息的 `max(create_time)`（窗口为空则取窗口起点）写入 `intake_cursor`，本轮不处理任何消息
- **WHEN** 存在早于窗口的历史消息
- **THEN** 它们不影响游标，也不会被回放（真实 API 无时间参数时返回最旧页——2026-09-01 实测，原"最新页"假设不成立）

#### Scenario: 非 text 忽略
- **WHEN** 拉取到富文本/卡片/图片消息
- **THEN** 忽略(v1)，可选记录

#### Scenario: 不接收 webhook
