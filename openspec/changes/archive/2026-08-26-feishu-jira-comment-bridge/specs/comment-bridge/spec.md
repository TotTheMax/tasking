## ADDED Requirements

### Requirement: CommentBridge 是 scheduler 的 sibling 同步组件
CommentBridge SHALL 是独立于 scheduler 的组件，自带 timer（节奏 `feishu.poll_interval_ms`），依赖注入 `JiraTracker`+`FeishuSource`+`BindingStore`+config+logger，在 `tasking start` 里与 scheduler 并列实例化与启停。CommentBridge SHALL NOT 阻塞或修改 scheduler 的派发/reconcile。

#### Scenario: start 并列启停
- **WHEN** 运行 `tasking start`
- **THEN** CommentBridge 与 scheduler 各自启停、互不阻塞

#### Scenario: scheduler 不被桥阻塞
- **WHEN** CommentBridge 同步循环运行中
- **THEN** scheduler 继续独立轮询与派发

### Requirement: 入站 REST 轮询、无公网端口
CommentBridge SHALL 用 REST 轮询入站（经 `FeishuSource.listMessages`），outbound-only、无入站 HTTP server、无公网端口、零新依赖。SHALL 定向轮询绑定话题（fast 节奏）；`/issue` 发现在单一 intake 群内，SHALL NOT 扫描多个群。

#### Scenario: 无公网端口
- **WHEN** CommentBridge 运行
- **THEN** 不监听任何入站 HTTP 端口

#### Scenario: 定向轮询绑定话题
- **WHEN** 存在绑定话题
- **THEN** 按 fast 节奏定向轮询其新消息，SHALL NOT 扫描未绑定群

### Requirement: Binding 1:1 issue↔飞书话题
CommentBridge SHALL 维护 1:1 映射从一个 Jira issue 到一个飞书话题（root 消息），存于持久 binding 表：`issue_key → {chat_id, root_id, last_jira_comment_id, last_feishu_msg_id, status}`。SHALL NOT 把一个 issue 扇出到多个话题。Feishu-origin 的 `/issue` 命令消息 SHALL 为该话题根；Jira-origin dispatch SHALL 在 intake 群发一条公告作根。binding 行 SHALL 在根消息发出时写入。所有 issue 话题 SHALL 在单一 intake 群（`feishu.intake_chat_id`）内。

#### Scenario: Feishu-origin 根
- **WHEN** 人发 `/issue` 建一个 issue
- **THEN** 该 `/issue` 命令消息成为话题根，binding 行写入 `root_id`=该消息 id

#### Scenario: Jira-origin 根
- **WHEN** scheduler 派发一个 Jira-origin issue
- **THEN** CommentBridge 在 intake 群发一条公告消息作根、写 binding

#### Scenario: 1:1 无扇出
- **WHEN** 一个 issue 已有 binding
- **THEN** 该 issue 的评论只发到那一个绑定话题

### Requirement: 双向评论同步
CommentBridge SHALL 双向镜像：Jara→飞书 转发 issue 新评论到绑定话题（作话题回复）；飞书→Jira 把绑定话题里人的新自由文本桥成该 issue 的 Jara comment。每周期 SHALL 拉 `id/msg > 游标` 的新项、处理后推进游标。游标 SHALL 持久化、重启续上不重发。

#### Scenario: Jara 评论转发到飞书
- **WHEN** issue X 有新 agent Jara 评论
- **THEN** 转发为绑定话题的回复

#### Scenario: 飞书消息桥成 Jara 评论
- **WHEN** 绑定话题有人新自由文本
- **THEN** 桥成 issue X 的 Jara comment

#### Scenario: 游标跨重启续上
- **WHEN** daemon 重启
- **THEN** 游标从持久值续上、不重发已处理项

### Requirement: sentinel 去重与防环
飞书→Jira 桥过去的 comment SHALL 带可见前缀 `💬 {sender} via 飞书 [msg:{message_id}]:`，同时作归属与 sentinel。Jara→飞书 转发器 SHALL 跳过 body 含 `via 飞书 [msg:` 的评论（不回投）。飞书→Jira SHALL 跳过 bot 作者的飞书消息与 `/` 前缀命令消息（不桥成 Jara comment）。跳过的项 SHALL 仍推进游标。

#### Scenario: sentinel 评论不回投
- **WHEN** Jara 侧有一条带 sentinel 的评论
- **THEN** 不转发回飞书

#### Scenario: bot 消息不桥
- **WHEN** 飞书话题有 bot 自己发的消息
- **THEN** 不桥成 Jara comment

#### Scenario: 命令消息不桥
- **WHEN** 飞书话题有 `/` 前缀命令
- **THEN** 不桥成 Jara comment（按命令处理）

#### Scenario: 跳过仍推进游标
- **WHEN** 一条被跳过的项
- **THEN** 游标仍推进过它

### Requirement: 转发人直发 Jara 评论
人直接在 Jara 发的评论（无 sentinel）SHALL 被转发到绑定话题，以保飞书线程完整性。

#### Scenario: 人直发评论转发
- **WHEN** 人在 Jara 直接发一条评论
- **THEN** 转发到该 issue 绑定话题

### Requirement: terminal 收尾与 reopen 可逆
当 issue 转 terminal 状态，CommentBridge SHALL 在绑定话题发"✅ 已完结"ack（bot、Feishu-only、不入 Jara）+ 标 binding `status=terminal` + 停止该话题同步；binding 行 SHALL 保留。当 issue 从 terminal reopen 回 active，SHALL 翻 `status` 回 `active`、续同一话题同步（不造新话题）。

#### Scenario: terminal 收尾
- **WHEN** issue 转 terminal
- **THEN** 发终结 ack + 标 terminal + 停同步

#### Scenario: reopen 续同一线程
- **WHEN** terminal issue reopen 回 active
- **THEN** 翻 status 回 active、续同一话题

### Requirement: /issue 命令建 issue
`/issue <title>\n<desc>` SHALL 建 Jira issue：title→`summary`、desc→`description` 字段（非 comment）。project/assignee/labels SHALL 锁定复用 `tracker.project_key`/`assignee`/`required_labels`、不可 per-issue 覆盖。issueType SHALL 用 `feishu.create_issue_type` 默认、可 `--type <name|N>` 覆盖。`/issue`（无参）SHALL 列该项目可用 issueType（`GET /project/{key}/issueTypes`）+ 标默认。`/issue` 消息 SHALL 成话题根 + 写 binding。建后 SHALL 确保 issue 落 active 状态。

#### Scenario: 建默认 type issue
- **WHEN** 人发 `/issue <title>\n<desc>`
- **THEN** 建 issue（summary=title, description=desc, project/assignee/labels=tracker 默认, type=config 默认），命令消息成根

#### Scenario: 覆盖 type
- **WHEN** 人发 `/issue --type Bug <title>\n<desc>`
- **THEN** issue type 用 Bug

#### Scenario: 无参列可用 type
- **WHEN** 人发 `/issue` 无参
- **THEN** 回该项目可用 issueType 列表 + 默认

#### Scenario: 三字段锁定不可覆盖
- **WHEN** `/issue` 建 issue
- **THEN** project/assignee/labels = tracker 配置值，命令无法覆盖

### Requirement: /state 命令转状态
`/state`（无参，在绑定话题内）SHALL 回当前状态 + issue 可用转移编号列表（`GET /issue/{key}/transitions` 运行时发现，不硬编码状态名）。`/state <N|name>` SHALL 匹配可用转移、转状态；无/多义 SHALL 回列表。转完 SHALL 即时 nudge scheduler（复用 `requestRefresh`），不等下次轮询。

#### Scenario: 无参列可用转移
- **WHEN** 人在绑定话题发 `/state`
- **THEN** 回当前状态 + 可用转移编号列表

#### Scenario: 编号转状态
- **WHEN** 人发 `/state 2`（2 对应一可用转移）
- **THEN** 转 issue 到该状态

#### Scenario: 转完即时 nudge
- **WHEN** `/state` 转完状态
- **THEN** 立即 nudge scheduler reconcile

#### Scenario: 不硬编码状态名
- **WHEN** `/state` 列转移
- **THEN** 状态名来自运行时 Jara 查询，非字面量硬编码

### Requirement: /help 命令
`/help` SHALL 回静态帮助文本列出 `/issue`/`/state`/`/help` 语法与各自适用上下文。无 Jara 调用、无 LLM、`/` 前缀→不桥。

#### Scenario: help 列命令
- **WHEN** 人发 `/help`
- **THEN** 回命令列表与语法
