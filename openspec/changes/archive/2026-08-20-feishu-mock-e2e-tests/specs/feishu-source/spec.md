## ADDED Requirements

### Requirement: mock 与真实飞书 API 形状一致
测试 mock SHALL 以真实飞书 IM API 形状构造响应：`reply_in_thread` 响应含 `thread_id`；消息 `create_time` 为 13 位毫秒并由 `toSecondsStr` 归一化为秒；`listMessages` 与 `listThreadReplies` 分别使用 `container_id_type=chat` 与 `container_id_type=thread` 且按容器区分返回；消息 sender 含 `sender_id.open_id`、`sender_name`、`sender_type` 真实字段。

#### Scenario: reply_in_thread 响应返回 thread_id
- **WHEN** 测试 mock 响应 `replyInThread` 请求
- **THEN** 响应含 `thread_id`，bridge 可将之持久化到 binding

#### Scenario: create_time 毫秒归一化为秒
- **WHEN** mock 消息 `create_time` 为 13 位毫秒字符串
- **THEN** `toSecondsStr` 输出 10 位秒字符串，用于 cursor 比较

#### Scenario: 容器类型区分 chat 与 thread
- **WHEN** mock 收到 `listMessages`（chat）与 `listThreadReplies`（thread）请求
- **THEN** 分别以 `container_id_type=chat` 与 `container_id_type=thread` 返回对应容器消息

#### Scenario: 消息 sender 含真实字段
- **WHEN** mock 构造消息对象
- **THEN** 含 `sender_id.open_id`、`sender_name`、`sender_type`，可被完整解析
