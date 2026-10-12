## ADDED Requirements

### Requirement: intake 根消息重投持久去重
`CommentBridge.ingestMessage` SHALL 对 intake 根消息（`root_id === null`）在入队口叠加持久 seen-id 去重（存于 `bindings.db`，有界）：入口 SHALL 先查持久 seen-id（与进程内 msg_id claim 叠加），命中 SHALL 静默丢弃（仅 debug 日志，SHALL NOT 回复任何用户可见消息）；seen-id SHALL 仅在该消息的队列处理完成后写入（无论处理结局为成功回复、主动放弃或已发失败回执），以保持 at-least-once——崩溃发生在写入前 SHALL 允许重放。话题回复（`root_id !== null`）SHALL NOT 写入持久 seen-id，SHALL 继续由既有游标/seen_ids 守卫去重。

#### Scenario: 重启后 Sweep 重投命令消息被拦截
- **WHEN** `/help` 根消息经事件通道处理并回复后、下一次 Sweep 推进游标前 daemon 停止并重启，启动 Sweep 重投该消息
- **THEN** 该消息在入队口被持久 seen-id 拦截，不重发 `/help` 回复，仅记 debug 日志

#### Scenario: 崩溃发生在标记写入前允许重放
- **WHEN** 一条根消息已处理完成但持久 seen-id 尚未写入时 daemon 崩溃，重启后 Sweep 重投该消息
- **THEN** 该消息不被 seen-id 拦截、按新消息处理（至多重放一次回复），用户输入不丢失

#### Scenario: 话题回复不受影响
- **WHEN** 绑定话题内的回复消息经 `ingestMessage` 处理
- **THEN** 该消息不产生 intake 持久 seen-id 记录，其重投去重仍由 binding 游标 / direct session 游标与 seen_ids 承担
