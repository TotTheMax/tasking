## ADDED Requirements

### Requirement: intake 非命令根消息回执
CommentBridge SHALL 在 intake 群发现一条非命令、非 `/help`、非 `/state`、非 `/issue` 的根消息（自由文本）时，回复一条友好回执（含 `/issue`、`/help` 用法提示）。该回执 SHALL 不桥成 Jira comment、不创建 binding、不影响 intake 游标推进。未知 `/` 前缀命令 SHALL 维持现有"未知命令"回复，不并入本回执。

#### Scenario: 自由文本根消息收到回执
- **WHEN** intake 群出现一条非 `/` 前缀的自由文本根消息
- **THEN** 以该消息为根回复"已收到"类文本（含 /issue、/help 提示），游标照常推进

#### Scenario: 回执不进 Jira 不建 binding
- **WHEN** 上述回执已发送
- **THEN** 该消息不被桥成 Jira comment、也不建立任何 issue↔话题 binding

#### Scenario: 命令消息不回执
- **WHEN** intake 群根消息为 `/help`、`/state`、`/issue` 或其它 `/` 命令
- **THEN** 按各自现有分支处理，不触发自由文本回执

### Requirement: /issue 建 issue 后首条 comment
`executeIssue` 建 issue 成功后 SHALL 把原始 `/issue` 消息全文（标题 + 多行描述）作为该 issue 的**第一条 comment** 写入，且该 comment 带飞书 sentinel（`via 飞书`），使 Jira→飞书转发器按 sentinel 跳过、不回投。comment 作者名取消息 sender_name，缺失用默认。

#### Scenario: 建后写入首条 sentinel comment
- **WHEN** `/issue 标题\n第一行\n第二行` 创建成功
- **THEN** 新 issue 出现首条 comment，内容含 `via 飞书` sentinel 与原文（标题+多行描述）

#### Scenario: sentinel 防回投
- **WHEN** 该首条 comment 存在
- **THEN** `forwardComments` 因 sentinel 跳过它，不转发回飞书话题

### Requirement: /issue 多行 description 按 API 版本落库
`executeIssue` 构造的 `description` 字段 SHALL 保留多行：v2（wiki 文本）用原始换行字符串；v3 转 ADF doc（按换行分段落）。任一 API 版本都不得丢失换行或拒绝请求。

#### Scenario: v2 多行描述
- **WHEN** 经 `/rest/api/2` 端点 `createIssue` 且描述含换行
- **THEN** `description` 字段为含原始换行的字符串

#### Scenario: v3 多行描述
- **WHEN** 经 `/rest/api/3` 端点 `createIssue` 且描述含换行
- **THEN** `description` 字段为 ADF doc，按换行拆成段落节点
