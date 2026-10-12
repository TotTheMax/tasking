## MODIFIED Requirements

### Requirement: 事件通道接入
启用飞书桥时，daemon SHALL 通过官方 SDK `WSClient` 建立一条长连接（`FeishuEventListener`，唯一 import SDK 的位置）订阅 `im.message.receive_v1`，将 SDK 事件 payload 归一化为内部 `FeishuPolledMessage` 形状（含 `msg_type` 字段名映射与 `create_time` 毫秒→秒归一）后交由 `CommentBridge.ingestMessage()` 入队。事件通道 SHALL NOT 消耗飞书 API 调用额度（平台推送为豁免通道），发送类调用 SHALL 仍走 REST。

长连接 SHALL 按 `feishu.edition` 选择 SDK `domain` 端点（`lark` → `Domain.Lark` 海外区域，`feishu` → 默认国内），edition 取自生效配置并在监听器依赖中显式传递。

#### Scenario: 配额耗尽时事件照常接收
- **WHEN** 飞书月度 API 额度已耗尽（REST 调用返回 429 99991403）
- **THEN** WS 长连接照常建连，新消息事件照常实时送达并进入入站队列

#### Scenario: 话题回复事件携带路由字段
- **WHEN** 用户在绑定话题内回复一条消息
- **THEN** 事件 payload 经归一化后携带 `root_id`/`parent_id`/`thread_id`，可按 `root_id` 查到对应 binding

#### Scenario: lark 部署连海外端点
- **WHEN** `feishu.edition: lark` 下事件通道建连
- **THEN** `WSClient` 以 `Domain.Lark` 构造，连接海外区域端点
