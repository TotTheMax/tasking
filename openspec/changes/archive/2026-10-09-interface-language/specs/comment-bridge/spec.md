## MODIFIED Requirements

### Requirement: sentinel 去重与防环
飞书→Jira 桥过去的 comment SHALL 带可见前缀 `💬 {sender} via Feishu:`——sentinel 恒为英文 `via Feishu`，与 `interface_language` 无关；sender 缺名兜底 SHALL 为 `user`。Jira→飞书 转发器 SHALL 跳过 body 匹配 `^💬 [^\n]* (?:via 飞书|via Feishu):\n` 前缀正则的评论（双匹配，旧任务零影响，不回投）。飞书→Jira SHALL 跳过 bot 作者的飞书消息与 `/` 前缀命令消息（不桥成 Jira comment）。跳过的项 SHALL 仍推进游标。

#### Scenario: sentinel 评论不回投
- **WHEN** Jira 侧有一条带 `via Feishu` sentinel 的评论
- **THEN** 不转发回飞书

#### Scenario: 旧 sentinel 评论不回投
- **WHEN** Jira 侧有一条历史遗留的 `via 飞书` sentinel 评论
- **THEN** 同样不转发回飞书（双匹配兼容）

#### Scenario: bot 消息不桥
- **WHEN** 飞书话题有 bot 自己发的消息
- **THEN** 不桥成 Jira comment

#### Scenario: 命令消息不桥
- **WHEN** 飞书话题有 `/` 前缀命令
- **THEN** 不桥成 Jira comment（按命令处理）

#### Scenario: 跳过仍推进游标
- **WHEN** 一条被跳过的项
- **THEN** 游标仍推进过它
