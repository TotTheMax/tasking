## ADDED Requirements

### Requirement: 生命周期消息以显示名标注操作人
直连会话的生命周期消息（`/stop` 的中断说明、`/done` 的结束统计、卡片按钮触发的中断/结束）SHALL 以操作人的**显示名**标注；显示名 SHALL 按 `operator.name`（回调自带）→ 本次会话所在群（`chat_id`）的成员表缓存 → 群成员表实时查询 → open_id 的顺序解析。群成员表查询 SHALL 通过 `GET /im/v1/chats/:chat_id/members`（`member_id_type=open_id`，必要时分页）进行，结果 SHALL 按 chat_id 缓存（TTL 1 小时），并在会话创建时预取一次。解析 SHALL NOT 出现在卡片回调动画的响应路径上（回调 SHALL 仍然立即返回）；解析失败（非群成员、接口失败、缺权限）SHALL 记 debug 并回落显示 open_id，SHALL NOT 影响消息发送与会话状态。

#### Scenario: 能解析时显示姓名
- **WHEN** 群成员表能解析出点击者的姓名
- **THEN** 中断/结束消息里的操作人显示为该姓名（而非 open_id）

#### Scenario: 解析失败回落 open_id
- **WHEN** 成员表查询失败或点击者不在返回结果中
- **THEN** 消息仍正常发送，操作人显示为 open_id，并记 debug

#### Scenario: 回调不被解析拖慢
- **WHEN** 缓存未命中且成员表查询较慢
- **THEN** 卡片动作仍在 3 秒内返回（解析发生在响应之后的慢操作里）

#### Scenario: 成员表结果被复用
- **WHEN** 同一会话内第二次触发卡片动作
- **THEN** 不再重复请求成员表（命中缓存）
