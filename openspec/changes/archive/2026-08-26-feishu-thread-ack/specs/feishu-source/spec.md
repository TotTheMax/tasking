## ADDED Requirements

### Requirement: 话题桥接成功回执
`bridgeMessages` 把话题内用户非命令自由文本成功桥成 Jira comment 后，SHALL 在该条消息下（`reply_in_thread`）回复成功回执 `✅ 已收到，已同步到 {issue_key}`（`issue_key` 为该绑定对应的 Jira issue）。该回执 SHALL 由 bot 发出，SHALL NOT 被桥回 Jira、SHALL NOT 改变绑定与游标语义；回执发送失败 SHALL 不影响游标推进，仅记日志。命令消息（`/issue`、`/state`、`/help` 及未知 `/` 命令）SHALL 按各自现有分支处理，不触发本回执。

#### Scenario: 桥接成功收到回执
- **WHEN** 话题内出现一条用户非命令自由文本且已成功桥成 Jira comment
- **THEN** 该条消息下回复 `✅ 已收到，已同步到 {issue_key}`

#### Scenario: 回执不回投不重桥
- **WHEN** 上述成功回执已发出
- **THEN** 下一轮轮询中该回执（bot 消息）被跳过，不桥回 Jira、不重复回执

#### Scenario: 命令消息不回执
- **WHEN** 话题内消息为 `/issue`、`/state`、`/help` 或未知 `/` 命令
- **THEN** 按各自命令分支处理并回复，不触发成功回执

### Requirement: 话题桥接失败回执
`bridgeMessages` 尝试把话题内用户自由文本写入 Jira comment 失败时（Jira 404 绑定清理场景除外），SHALL 在该条消息下回复失败回执 `⚠️ 同步失败，请稍后重试`，让用户立即知道未同步成功。游标推进行为维持现状（失败消息不重试）。回执发送失败 SHALL 不影响游标推进，仅记日志。

#### Scenario: 写入失败收到失败回执
- **WHEN** 话题内自由文本尝试写入 Jira comment 失败（非 404）
- **THEN** 该条消息下回复 `⚠️ 同步失败，请稍后重试`，游标照常推进

#### Scenario: 404 绑定清理不回执
- **WHEN** 写入 Jira comment 返回 404（issue 不存在）
- **THEN** 维持绑定清理（markTerminal）行为，不发送失败回执
