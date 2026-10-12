## MODIFIED Requirements

### Requirement: 入站队列单一入队口与 claim 去重
`CommentBridge` SHALL 暴露公开入口 `ingestMessage(msg)`，内部维护单一无界 FIFO 与单一消费者：事件与 Sweep 两个来源 SHALL 只做"取消息→归一化→入队"，处理 SHALL 全部经由此队列串行执行（保留同话题消息按到达序进 Jira）。入队时 SHALL 先做 msg_id claim（查+加 processed 集合，原子），重复消息 SHALL 在入队口被丢弃；intake 根消息（`root_id === null`）的 claim SHALL 叠加持久 seen-id（跨重启生效，处理完成后写入，见 comment-bridge 能力"intake 根消息重投持久去重"），事件 handler SHALL 在归一化入队后立即返回（满足平台 3 秒 ack 约束），不得在 handler 内做 Jira/飞书调用。

#### Scenario: 事件与 Sweep 竞态不双投
- **WHEN** 同一条消息同时被事件送达与 Sweep 拉取
- **THEN** 仅先入队的一份被处理，后到者在入队口因 msg_id 已 claim 被丢弃，Jira 只收到一条评论

#### Scenario: handler 快速返回
- **WHEN** 事件到达
- **THEN** handler 在归一化并入队后立即返回（不阻塞等待处理结果），平台侧不触发超时重推

#### Scenario: daemon 重启后 Sweep 重投已处理根消息被持久去重
- **WHEN** 一条 intake 根消息已被处理（seen-id 已持久写入）、游标尚未推进过它时 daemon 重启，启动 Sweep 重投该消息
- **THEN** 该消息在入队口因持久 seen-id 命中被静默丢弃，不重复执行命令分支、不重发回复
