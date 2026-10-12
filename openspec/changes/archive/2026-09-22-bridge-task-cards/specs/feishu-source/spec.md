## ADDED Requirements

### Requirement: 群聊平铺发送交互卡片
适配器 SHALL 支持向群聊平铺发送交互卡片（以 `POST /im/v1/messages/:rootId/reply`、`msg_type: interactive`，且**不设** `reply_in_thread`），内容为卡片 JSON 2.0 序列化后的字符串，并 SHALL 从响应中返回 message_id。发送失败 SHALL 以 `TaskingError` 抛出，由调用方决定降级为纯文本。适配器 SHALL 复用与话题内卡片相同的序列化与错误处理路径。

#### Scenario: 群聊平铺发卡
- **WHEN** 调用方请求在群聊中平铺发送一张卡片（如 intake 群里的 `/help` 回执）
- **THEN** 适配器以 `POST /im/v1/messages/:rootId/reply`、`msg_type: interactive`、不设 `reply_in_thread` 发送，并返回新卡片的 message_id

#### Scenario: 平铺发卡失败抛出
- **WHEN** 平铺发卡返回非 0 code（如限流、权限不足）
- **THEN** 适配器抛出 `TaskingError`，调用方回落为纯文本投递

### Requirement: 删除自己发送的消息
适配器 SHALL 支持按 message_id 删除消息（`DELETE /im/v1/messages/:message_id`），用于回收旧的桥卡片（如召回式状态卡重发）。删除失败 SHALL 以 `TaskingError` 抛出，由调用方决定是否忽略（best-effort 回收）。

#### Scenario: 删除旧状态卡
- **WHEN** 调用方请求删除一条自己发出的卡片消息
- **THEN** 适配器以 `DELETE /im/v1/messages/:message_id` 发出请求

#### Scenario: 删除失败抛出
- **WHEN** 删除返回非 0 code（如消息已不存在、无权限）
- **THEN** 适配器抛出 `TaskingError`，调用方可忽略并继续
