## ADDED Requirements

### Requirement: 发送与更新交互卡片
适配器 SHALL 支持在话题内发送交互卡片（`msg_type: interactive`，`reply_in_thread: true`），内容为卡片 JSON 2.0 序列化后的字符串，并 SHALL 从响应中返回 message_id/thread_id 以便后续更新。适配器 SHALL 支持按 message_id 更新已发送的卡片（`PATCH /im/v1/messages/:id`，请求体 `content` 为卡片 JSON 字符串），且发送与更新使用同一应用身份与 `config.update_multi: true` 的共享卡片。发送或更新失败 SHALL 以 `TaskingError` 抛出，由调用方决定降级。

#### Scenario: 话题内发送卡片
- **WHEN** 调用方请求在话题内发送一张卡片
- **THEN** 适配器以 `POST /im/v1/messages/:root_id/reply`、`msg_type: interactive`、`reply_in_thread: true` 发送，并返回新卡片的 message_id 与 thread_id

#### Scenario: 更新已发送卡片
- **WHEN** 调用方以 message_id 请求更新卡片
- **THEN** 适配器以 `PATCH /im/v1/messages/:message_id`、请求体 `content` 为卡片 JSON 字符串发出请求

#### Scenario: 发送失败向上抛出
- **WHEN** 卡片发送或更新返回非 0 code（如限流、消息已撤回、超过 14 天更新窗口）
- **THEN** 适配器抛出 `TaskingError`，不静默吞掉

### Requirement: 上传并发送文件
适配器 SHALL 支持上传文件资源（`POST /im/v1/files`，multipart，`file_type: stream`，`file_name` 为文件名）取得 `file_key`，并以文件消息（`msg_type: file`，`reply_in_thread: true`）发送到指定话题。上传或发送失败 SHALL 以 `TaskingError` 抛出，由调用方降级。

#### Scenario: 上传后以文件消息发送
- **WHEN** 调用方请求把一段 Markdown 内容作为文件发到话题
- **THEN** 适配器先上传取得 file_key，再以 `msg_type: file` 的回复发送到该话题

#### Scenario: 缺少上传权限时抛出
- **WHEN** 应用未开通上传资源权限，上传返回权限错误（如 99991672）
- **THEN** 适配器抛出 `TaskingError`，调用方据此降级为文本投递
