## MODIFIED Requirements

### Requirement: Binding 1:1 issue↔飞书话题
CommentBridge SHALL 维护 1:1 映射从一个 Jira issue 到一个飞书话题（root 消息），存于持久 binding 表：`issue_key → {chat_id, root_id, thread_id, last_jira_comment_id, last_feishu_msg_id, status}`。SHALL NOT 把一个 issue 扇出到多个话题。Feishu-origin 的 `/issue` 命令消息 SHALL 为该话题根；Jira-origin dispatch SHALL 在 intake 群发一条公告作根。binding 行 SHALL 在根消息发出时写入。binding 写入 SHALL 为幂等 upsert：行不存在时插入；行已存在时仅当携带非空且不同的 `thread_id` 时更新该字段（SHALL NOT 覆写游标、root/chat 或 status）。所有 issue 话题 SHALL 在单一 intake 群（`feishu.intake_chat_id`）内。

#### Scenario: Feishu-origin 根
- **WHEN** 人发 `/issue` 建一个 issue
- **THEN** 该 `/issue` 命令消息成为话题根，binding 行写入 `root_id`=该消息 id

#### Scenario: Jira-origin 根
- **WHEN** scheduler 派发一个 Jira-origin issue
- **THEN** CommentBridge 在 intake 群发一条公告消息作根、写 binding

#### Scenario: 1:1 无扇出
- **WHEN** 一个 issue 已有 binding
- **THEN** 该 issue 的评论只发到那一个绑定话题

#### Scenario: 治愈的 thread_id 持久化
- **WHEN** 一条已存在的 binding 行 `thread_id` 为 NULL，且 `forwardComments` 转发评论时 `replyInThread` 响应携带 thread_id
- **THEN** binding 表中该行的 `thread_id` 被更新为响应值（跨重启可读），`status`/游标/root/chat 不变

#### Scenario: NULL 或同值不覆写
- **WHEN** upsert 携带的 `thread_id` 为 NULL，或与行中现有值相同
- **THEN** 该行不发生任何更新（terminal 行保持 terminal，好值不被抹掉）
