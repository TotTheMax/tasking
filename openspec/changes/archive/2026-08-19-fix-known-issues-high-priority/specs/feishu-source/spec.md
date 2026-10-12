## MODIFIED Requirements

### Requirement: 桥接可读类型含 post
CommentBridge 的 intake 发现与话题桥接 SHALL 把 `text` 与 `post` 均视为可读文本（最终文本为空的除外——空文本消息 SHALL 跳过不桥接、不回执）：intake 群的 `post` 型 `/issue` 正常建 issue + 回执；话题内 `post` 型自由文本正常桥成带 sentinel 的 Jira comment、命令正常处理。

#### Scenario: post 型 /issue 在 intake 建 issue
- **WHEN** intake 群出现一条 `post` 类型、文本以 `/issue` 开头的多行消息
- **THEN** 正常解析并创建 issue（summary 取标题、description 按 API 版本落库），回复已创建回执，且不额外写入首条 comment

#### Scenario: 话题内 post 型自由文本桥成 comment
- **WHEN** 话题内出现一条 `post` 类型的人自由文本
- **THEN** 该文本桥成带 sentinel 的 Jira comment

#### Scenario: 话题内 post 型命令正常处理
- **WHEN** 话题内出现一条 `post` 类型的 `/state` 等命令
- **THEN** 按命令分支处理并回复
