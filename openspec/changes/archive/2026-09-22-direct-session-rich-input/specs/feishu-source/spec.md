## ADDED Requirements

### Requirement: 消息附件解析
适配器 SHALL 在解析消息时同时提取附件信息：`post`（富文本）内联的图片、独立的 `image` 消息、以及独立的 `file`/`audio`/`video` 消息 SHALL 解析为 `attachments: [{ kind: "image"|"file", key, name }]`（`key` 为 `image_key`/`file_key`，`name` 缺失时由 kind 与序号兜底）；文本解析行为 SHALL 保持不变。事件通道与 REST 轮询两条入站路径 SHALL 使用同一解析逻辑。

#### Scenario: 文字+截图的富文本
- **WHEN** 收到 `msg_type: post` 且内容同时含 `text` 与 `img`
- **THEN** `text` 为该段文字，`attachments` 含该图片的 `image_key`

#### Scenario: 独立图片消息
- **WHEN** 收到 `msg_type: image`
- **THEN** `text` 为空，`attachments` 含一个 `kind: "image"` 的项

#### Scenario: 独立文件消息
- **WHEN** 收到 `msg_type: file`（含 `file_name`）
- **THEN** `attachments` 含该文件项的 `file_key` 与文件名

### Requirement: 下载消息资源
适配器 SHALL 提供按消息 id 与资源 key 下载资源的方法（`GET /im/v1/messages/:message_id/resources/:file_key`，`type` 取 `image`|`file`），返回二进制内容与响应头 `Content-Type`；失败 SHALL 抛 `TaskingError`。

#### Scenario: 下载成功
- **WHEN** 请求下载某图片资源
- **THEN** 返回其字节内容与 `Content-Type`

#### Scenario: 下载失败可见
- **WHEN** 资源超过 100MB、消息为保密模式或消息已删除
- **THEN** 抛出 `TaskingError`，由调用方在话题内提示
