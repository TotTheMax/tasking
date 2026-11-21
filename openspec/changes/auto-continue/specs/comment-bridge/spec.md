## ADDED Requirements

### Requirement: Auto-continue 命令不进入 Jira 桥

在 Jira 绑定话题中，一条去空白后以 `/loop` 开头的消息 SHALL 被 CommentBridge 识别为“仅直连会话支持”的控制消息：系统 SHALL 在话题内回复纯文本“仅直连会话支持 `/loop`”，SHALL NOT 把它写入 Jira 评论，SHALL NOT 因此创建或修改 binding。该消息 SHALL 被视为已消费（游标推进），不应在后续 Sweep 中重复处理。其他自由文本、`/state`、`/agent`、`/help` 的既有桥接/命令行为 SHALL 保持不变。

#### Scenario: Jira 话题里的 /loop 不回写 Jira

- **WHEN** 人在 Jira 绑定话题里发送 `/loop on`
- **THEN** 系统在话题内回复“仅直连会话支持 `/loop`”，不产生 Jira 评论，binding 不变

#### Scenario: 普通文本仍正常桥接

- **WHEN** 人在同一 Jira 绑定话题里发送“请把日志贴一下”
- **THEN** 该消息仍按既有逻辑桥接为 Jira 评论

#### Scenario: 不重复消费

- **WHEN** `/loop` 提示已经回复，随后发生一次 Sweep
- **THEN** 该消息不被再次回复或桥接
