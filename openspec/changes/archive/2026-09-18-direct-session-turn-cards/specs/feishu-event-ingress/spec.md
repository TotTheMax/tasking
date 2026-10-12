## ADDED Requirements

### Requirement: 卡片动作入站走独立快路径
事件通道 SHALL 在同一条长连接上同时订阅消息事件与卡片动作回调（`card.action.trigger`），并把卡片动作归一化为"卡片消息 id、chat id、操作人 open_id、动作 value"的最小结构后转交直连会话管理器。卡片动作 SHALL NOT 进入消息入站队列（Ingest queue 的串行单消费者），SHALL 走独立快路径，以保证处理函数能在飞书要求的 3 秒内返回；该路径 SHALL NOT 因队列积压而延迟。归一化失败（缺 message_id 或缺 action value）的卡片动作 SHALL 被忽略并记 debug，SHALL NOT 影响消息事件的处理。

#### Scenario: 注册回调并转发卡片动作
- **WHEN** 用户在轮次卡片上点击按钮，事件通道收到 `card.action.trigger`
- **THEN** 适配层归一化出 message_id/chat_id/操作人/动作 value 并转交直连会话管理器

#### Scenario: 卡片动作不排入消息队列
- **WHEN** 消息入站队列正在处理其它消息（如 Jira 镜像）时收到卡片动作
- **THEN** 该卡片动作仍被立即转交处理，不等待队列

#### Scenario: 归一化失败被忽略
- **WHEN** 收到的卡片动作缺少 message_id 或 action value
- **THEN** 该事件被忽略并记 debug，不影响其它事件
