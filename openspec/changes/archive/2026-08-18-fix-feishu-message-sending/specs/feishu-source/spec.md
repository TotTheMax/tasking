## MODIFIED Requirements

### Requirement: 飞书 v1 接入范围
`feishu-source` 适配器 SHALL 接入飞书 IM 消息的文本内容（`text` 与 `post` 两种类型）。`post`（富文本）消息 SHALL 将其 content 拍平为纯文本后接入；`text` 消息直接取文本。图片、卡片、文件等无文本内容的消息类型与非 IM 事件类型在 v1 范围外，SHALL 被忽略或记录后跳过。

#### Scenario: 文本消息被接入
- **WHEN** 收到一条飞书 `text` 消息
- **THEN** 该消息的 `text` 即原始文本，进入正常桥接处理

#### Scenario: 富文本（post）消息被拍平接入
- **WHEN** 收到一条飞书 `post`（富文本）消息，content 含文本块
- **THEN** 该消息被拍平成纯文本（标题+段落拼接），进入正常桥接处理

#### Scenario: 无文本内容的消息被忽略
- **WHEN** 收到一条图片/卡片/文件等无文本内容的消息
- **THEN** 忽略，不桥接，可选地记录日志

## ADDED Requirements

### Requirement: post 消息文本拍平
`parsePolledMessage` SHALL 对 `post` 消息把 content JSON 拍平成纯文本（行内文本块拼接、行间换行、图片块落 `[图片]` 占位、`at` 块落 `@{user_name}`、`title` 非空作为首行），结果写入消息 `text`。拍平失败或结果为空时 `text` SHALL 为空字符串，该消息 SHALL 被跳过（不桥接、不回执）。

#### Scenario: 多行富文本拍平成纯文本
- **WHEN** content 含多行、行内多文本块
- **THEN** 拍平结果保留换行与块文本顺序

#### Scenario: 含图片/at 的富文本
- **WHEN** content 含图片块与 at 块
- **THEN** 图片落 `[图片]`、at 落 `@{name}`，文本仍可桥接

#### Scenario: 拍平失败或无文本内容
- **WHEN** content 非预期结构、为空，或只含无文本块
- **THEN** `text` 为空字符串，消息被跳过（不桥接、不回执），不抛错

### Requirement: 桥接可读类型含 post
CommentBridge 的 intake 发现与话题桥接 SHALL 把 `text` 与 `post` 均视为可读文本（最终文本为空的除外——空文本消息 SHALL 跳过不桥接、不回执）：intake 群的 `post` 型 `/issue` 正常建 issue + 首条 comment + 回执；话题内 `post` 型自由文本正常桥成带 sentinel 的 Jira comment、命令正常处理。

#### Scenario: post 型 /issue 在 intake 建 issue
- **WHEN** intake 群出现一条 `post` 类型、文本以 `/issue` 开头的多行消息
- **THEN** 正常解析并创建 issue，写首条 sentinel comment，回复已创建回执

#### Scenario: 话题内 post 型自由文本桥成 comment
- **WHEN** 话题内出现一条 `post` 类型的人自由文本
- **THEN** 该文本桥成带 sentinel 的 Jira comment

#### Scenario: 话题内 post 型命令正常处理
- **WHEN** 话题内出现一条 `post` 类型的 `/state` 等命令
- **THEN** 按命令分支处理并回复

### Requirement: 话题消息按游标增量拉取
`listThreadReplies` SHALL 接受 `since` 游标并作为 `start_time` 传给飞书 API 做服务端增量拉取。`bridgeMessages` SHALL 按持久化游标跳过 `create_time <= 游标` 的消息，保证 daemon 重启后不重复桥接、不重复执行命令。

#### Scenario: 重启后不重复桥接
- **WHEN** daemon 重启后 `bridgeMessages` 处理某话题，话题内存在 `create_time` 早于或等于持久化游标的人自由文本
- **THEN** 该文本不被再次桥成 Jira comment

#### Scenario: 重启后不重复执行命令
- **WHEN** daemon 重启后 `bridgeMessages` 处理某话题，话题内存在早于游标的命令消息
- **THEN** 该命令不被再次执行

#### Scenario: 增量拉取带 start_time
- **WHEN** 调用 `listThreadReplies(threadId, since)`
- **THEN** 请求的 `start_time` 为 since 归一化后的秒数
