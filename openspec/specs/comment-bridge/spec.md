## Purpose

CommentBridge：Feishu 话题 ↔ Jira comment 的双向评论镜像组件（sibling 于 scheduler 并列启停），含 issue↔飞书话题 1:1 binding 与持久游标、sentinel 去重防环、`/issue`/`/state`/`/help` 命令面、terminal 收尾与 reopen 可逆。入站以事件通道为主（见 `feishu-event-ingress` 能力）、REST 轮询降级为 Sweep 兜底；循环节奏拆为 forward 快循环（Jira→飞书转发）与 Sweep（补拉）双节奏。
## Requirements
### Requirement: CommentBridge 是 scheduler 的 sibling 同步组件
CommentBridge SHALL 是独立于 scheduler 的组件，依赖注入 `JiraTracker`+`FeishuSource`+`BindingStore`+config+logger，在 `tasking start` 里与 scheduler 并列实例化与启停。CommentBridge SHALL NOT 阻塞或修改 scheduler 的派发/reconcile。其循环节奏 SHALL 拆分为二：forward 快循环（`feishu.forward_interval_ms`，默认 5s，仅跑 Jira→飞书评论转发）与 Sweep（`feishu.sweep_interval_ms`，默认 12h，另加"启动时"与"WS 重连成功时"两个触发点）。

#### Scenario: start 并列启停
- **WHEN** 运行 `tasking start`
- **THEN** CommentBridge 与 scheduler 各自启停、互不阻塞

#### Scenario: scheduler 不被桥阻塞
- **WHEN** CommentBridge 同步循环运行中
- **THEN** scheduler 继续独立轮询与派发

#### Scenario: 双节奏独立运转
- **WHEN** forward 快循环与 Sweep 同时配置
- **THEN** forward 以 `forward_interval_ms` 节奏只跑 Jira→飞书转发，Sweep 以 `sweep_interval_ms` 节奏只做补拉，互不拖慢对方

### Requirement: 入站事件驱动、Sweep 兜底、无公网端口
飞书入站 SHALL 以事件通道为主路径（见 `feishu-event-ingress` 能力）：`im.message.receive_v1` 事件实时入站队列处理。轮询逻辑 SHALL 降级为 Sweep 兜底清扫——经 `FeishuSource.listMessages`/`listThreadReplies` 按持久游标增量补拉——仅在 daemon 启动时、WS 重连成功时、`feishu.sweep_interval_ms` 定时器触发时执行。系统 SHALL 保持 outbound-only：无入站 HTTP server、无公网端口、不使用 webhook。`/issue` 发现在单一 intake 群内，SHALL NOT 扫描多个群。

#### Scenario: 无公网端口
- **WHEN** CommentBridge 运行
- **THEN** 不监听任何入站 HTTP 端口

#### Scenario: 主路径为事件推送
- **WHEN** 事件通道健康
- **THEN** 新消息从事件实时入队处理，Sweep 各轮均查空（游标无推进）

#### Scenario: Sweep 补回遗漏消息
- **WHEN** 某条消息未经过事件通道（绕过、静默丢失或 daemon 停机窗口内发出）
- **THEN** 下一次 Sweep（启动/重连/12h 定时器）按游标拉取并补处理，游标语义与既有行为一致（含 ADR 0016 冷启动探测）

#### Scenario: 配置键迁移
- **WHEN** WORKFLOW.md 中存在旧键 `feishu.poll_interval_ms`
- **THEN** resolver 忽略该键（`feishu.forward_interval_ms` 缺省时取默认 5000）并发出弃用警告，daemon SHALL 正常启动；`feishu.sweep_interval_ms` 缺省时取默认 12h

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

### Requirement: intake 冷启动探测
`CommentBridge.discoverIntake` 在 `intake_cursor` 为空时 SHALL 通过 `FeishuSource.listMessages(intakeChat, "")`（不带时间参数 → 服务端返回最新一页）探测，取返回项 `create_time` 的最大值写入 `bridge_meta.intake_cursor`，且本轮 SHALL 只记录不处理（不建 issue、不回复 ack）。下一轮起从该游标正常增量轮询。空游标时 SHALL NOT 以 24h 窗口回看历史。

#### Scenario: 新机器首次轮询建立游标
- **WHEN** `discoverIntake` 发现 `intake_cursor` 为空且 intake 群存在历史消息
- **THEN** 用不带时间参数的请求取最新一页，`max(create_time)` 写入 `intake_cursor`，本轮不处理消息

#### Scenario: 探测后下一轮增量消费
- **WHEN** 初始游标已写入且之后出现新消息
- **THEN** 正常轮询消费游标之后的消息（`/issue` 建单、ack、命令各按既有分支）

#### Scenario: 空群不回退 24h
- **WHEN** `intake_cursor` 为空且 intake 群无可探测消息
- **THEN** 游标保持为空，不触发 24h 历史回看

### Requirement: 冷启动探测防重复建单
在冷启动探测完成前（游标为空的那一轮），`discoverIntake` SHALL NOT 对任何历史根消息执行 `/issue` 建单或发送 ack；探测只推进游标。

#### Scenario: 历史 /issue 消息不被重复建单
- **WHEN** 新机器首轮探测返回含历史 `/issue` 消息的最新一页
- **THEN** 该 `/issue` 不被建单，仅其 `create_time` 用于初始化游标

### Requirement: intake 群 /issue 发现与消费
`CommentBridge.discoverIntake` SHALL 在 intake 群发现新根消息（游标之后、`root_id == null`）并分派：`/chat` 交由 `DirectSessionPort`（直连会话，见 direct-sessions 能力）、`/issue` 建 Jira issue、`/help` 回复用法、`/state` 提示话题内使用、`/agent` 提示话题内使用、未知 `/` 命令回复未知命令、非命令自由文本回复"已收到" ack；消费后 SHALL 推进 `intake_cursor`。游标为空的首轮 SHALL 走冷启动探测（见新需求"intake 冷启动探测"），不执行本需求的消费逻辑。直连功能未启用（`feishu.direct.enabled: false` 或未接线 direct 端口）时 `/chat` SHALL 按未知命令处理。

#### Scenario: 游标之后的 /issue 建单
- **WHEN** intake 群出现游标之后的 `/issue` 根消息
- **THEN** 创建 Jira issue、回复创建成功、推进游标

#### Scenario: 首轮游标为空走探测
- **WHEN** `discoverIntake` 首轮且 `intake_cursor` 为空
- **THEN** 只探测记录初始游标，不执行本需求的建单/ack/命令分支

#### Scenario: /chat 根消息交给直连会话管理器
- **WHEN** intake 群出现游标之后的 `/chat …` 根消息且直连功能已配置
- **THEN** 该消息由 `DirectSessionPort` 处理（创建会话/列项目/错误提示），不回复"未知命令"，游标照常推进

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

### Requirement: fresh start 以新机器方式重置本地桥状态
`CommentBridge.freshStartReset()` SHALL 在 `tasking start --fresh` 时、桥首次 Sweep 之前执行：(1) 删除 `bridge_meta.intake_cursor`，使下一次 `discoverIntake` 走既有冷启动探测（ADR 0016/0018 语义，游标锚定到当前时刻），SHALL NOT 回放停机窗口内 intake 群的历史根消息；(2) 将本地 active bindings 与 Jira 现状对账——issue 已处 `terminal_states` 或未出现在 `fetchIssueStatesByIds` 返回集（已删/不可见）的 binding SHALL `markTerminal`（停止镜像），仍处 active/review 态的 binding SHALL 保留；(3) 对账查询抛错时 SHALL 保守保留全部 binding（不标 terminal），仅输出 WARN 日志。

#### Scenario: 清除游标后下轮探测锚定当前时刻
- **WHEN** `tasking start --fresh` 执行 `freshStartReset()`
- **THEN** `bridge_meta.intake_cursor` 被删除；下一次 Sweep 的 `discoverIntake` 走冷启动探测（只记不处理），不回放停机窗口内的历史根消息

#### Scenario: 终态 issue 的 binding 被标 terminal
- **WHEN** 对账时某 active binding 的 issue 状态属于 `terminal_states`
- **THEN** 该 binding 被 `markTerminal`，不再被 `listActive` 返回、停止镜像

#### Scenario: 缺失(404/不可见) issue 的 binding 被标 terminal
- **WHEN** 对账时某 active binding 的 issue 未出现在 `fetchIssueStatesByIds` 返回集中
- **THEN** 该 binding 被 `markTerminal`（等同既有 JiraNotFound「binding cleaned」语义）

#### Scenario: 仍 active/review 的 binding 保留
- **WHEN** 对账时某 active binding 的 issue 仍处 active_states 或 review 态
- **THEN** 该 binding 保持 active，线程镜像继续

#### Scenario: 对账查询失败保守保留
- **WHEN** 对账的 `fetchIssueStatesByIds` 抛错
- **THEN** 无任何 binding 被 `markTerminal`，输出 WARN 日志，`freshStartReset` 正常结束

### Requirement: /state 命令转状态
`/state`（无参，在绑定话题内）SHALL 回/刷新任务状态卡（当前状态与负责人；可用转换经卡上 `🔀 转状态` 点击时**实时**列出，运行时发现、不硬编码状态名；卡片不可用时回落纯文本）。`/state <N|name>` SHALL 匹配可用转移、转状态；无/多义 SHALL 回列表。转状态 SHALL 与状态卡上的 `🔀 转状态` 流程共用同一份转换逻辑（文本命令与卡片按钮两条入口一致）。转完 SHALL 即时 nudge scheduler（复用 `requestRefresh`），不等下次轮询。

#### Scenario: 无参列可用转移
- **WHEN** 人在绑定话题发 `/state`
- **THEN** 回/刷新任务状态卡（当前状态与负责人），可用转换经 `🔀 转状态` 实时列出

#### Scenario: 编号转状态
- **WHEN** 人发 `/state 2`（2 对应一可用转移）
- **THEN** 转 issue 到该状态，并 PATCH 状态卡为新状态

#### Scenario: 转完即时 nudge
- **WHEN** `/state` 转完状态
- **THEN** 立即 nudge scheduler reconcile

#### Scenario: 不硬编码状态名
- **WHEN** `/state` 列转移
- **THEN** 状态名来自运行时 Jira 查询，非字面量硬编码

### Requirement: /help 命令
`/help` SHALL 列出 `/issue`/`/state`/`/agent`/`/help` 语法与各自适用上下文，并 SHALL 以交互卡片呈现（不可用时回落纯文本）。无 Jira 调用、无 LLM、`/` 前缀→不桥。

#### Scenario: help 列命令
- **WHEN** 人发 `/help`
- **THEN** 回命令列表与语法（卡片形式）

### Requirement: 桥命令回执以卡片呈现
桥的信息类命令回执（`/help`、`/agent` 列表、`/issue` 列表、`/state` 查看）SHALL 以飞书交互卡片呈现，而非纯文本；适配器不具备发卡能力或发卡失败时 SHALL 回落为纯文本，命令语义不变。转瞬即逝的回执（intake `已收到 ✓`、话题 `✅ 已同步到 <key>`、参数错误/失败提示）SHALL 保持纯文本。`/help` 与 `/agent` 列表卡 SHALL 可带操作按钮（点击后在话题内触发对应查询）。

#### Scenario: /help 回卡片
- **WHEN** 人在群聊或话题内发 `/help`
- **THEN** 回一张列出 `/issue`、`/state`、`/agent`、`/help` 语法与适用上下文的卡片

#### Scenario: /agent 列表回卡片
- **WHEN** 人在任务话题内发 `/agent`（无参）
- **THEN** 回一张列出可用 agent 与当前值的卡片

#### Scenario: 从 /agent 卡直接切换 agent
- **WHEN** 人在任务话题内的 `/agent` 卡上点击某个 agent 按钮（或"↩️ 默认"）
- **THEN** 该任务的 `agent:<name>` 标签被更新（下一 turn 生效），与文本 `/agent <name>` 共用同一逻辑

#### Scenario: 卡片不可用时回落纯文本
- **WHEN** 适配器没有卡片发送能力，或发卡抛出 `TaskingError`
- **THEN** 同一命令以纯文本回执，命令行为不变

#### Scenario: 一次性回执保持纯文本
- **WHEN** intake 群收到非命令根消息并回 `已收到 ✓`
- **THEN** 该回执为纯文本消息，不是卡片

### Requirement: Jira 评论镜像为卡片
绑定的 Jira 评论同步到飞书话题时 SHALL 以交互卡片呈现，卡片 SHALL 含作者名与正文（正文按卡片预算截断），并 SHALL 提供 `打开 Jira` 的 `open_url` 按钮与 `📋 状态` 召唤按钮（点击 SHALL 异步在话题底部发布一张实时状态卡，不替换评论卡本身）（指向 `${baseUrl}/browse/${issueKey}`）；正文被截断时 SHALL 额外提供 `📄 完整输出` 按钮，点击 SHALL 把该评论全文作为 `.md` 文件发到话题（失败 SHALL 在话题内可见，而非静默）。评论数量、顺序与 sentinel 防环语义 SHALL 保持不变。机器人自身发出的卡片 SHALL NOT 被当作话题回复回灌 Jira。

#### Scenario: 短评论镜像为卡片
- **WHEN** Jira 上出现一条新评论
- **THEN** 话题内出现一张含作者与正文的卡片，且不产生纯文本镜像消息

#### Scenario: 长评论截断并可按需展开
- **WHEN** Jira 评论正文超过卡片预算
- **THEN** 镜像卡正文被截断并出现 `📄 完整输出` 按钮；点击后把全文作为 `.md` 文件发到话题

#### Scenario: 未截断的评论不出现完整输出按钮
- **WHEN** 评论正文在卡片预算内
- **THEN** 镜像卡不渲染 `📄 完整输出` 按钮（正文已在卡上，按钮无意义）

#### Scenario: 打开 Jira 按钮指向该 issue
- **WHEN** 点击镜像卡上的 `打开 Jira`
- **THEN** 浏览器打开 `${baseUrl}/browse/${issueKey}`

#### Scenario: 从评论卡召唤状态卡
- **WHEN** 用户点击评论镜像卡上的 `📋 状态`
- **THEN** 一张按实时状态构建的任务状态卡出现在话题底部（评论卡保持不变）

#### Scenario: 镜像卡不被回灌
- **WHEN** 桥下一跳读取话题回复
- **THEN** 机器人自己发的镜像卡（`sender_type: app`）被跳过，不产生新的 Jira 评论

### Requirement: 任务状态卡
每个 issue↔话题绑定 SHALL 维护一张**独立的任务状态卡**：绑定时发出，状态卡 SHALL 显示 issue key、当前状态与负责人，并 SHALL 提供 `🔀 转状态` 与 `🔄 刷新` 按钮。状态卡 SHALL 采用**拉取式刷新**：只在飞书侧动作发生时更新（转状态成功后、或用户查看时按实时查询重建），SHALL NOT 为同步 Jira 侧变更而周期性轮询并 PATCH。issue 消失（404）时 SHALL 被动地把卡片 PATCH 为已完结。状态卡消息 id SHALL 持久化于绑定记录；重新发布状态卡（`/state` 无参或 `📋 状态` 召唤）SHALL 为**召回式**：先删除旧状态卡消息（best-effort，失败不阻断）再在话题底部发送新卡并更新记录，避免旧卡残留堆积；PATCH 失败（卡片被删除、话题归档等）SHALL 重新发送一张状态卡并更新记录（自愈）。

#### Scenario: 绑定时发出状态卡
- **WHEN** `/issue` 建单并完成绑定
- **THEN** 话题内出现一张含 key/状态/负责人的任务状态卡

#### Scenario: 飞书侧转状态后原地更新
- **WHEN** 通过卡片按钮或 `/state <N|name>` 成功转状态
- **THEN** 已有状态卡被 PATCH 为新状态，不新增一条状态卡消息

#### Scenario: 刷新按钮按实时状态换卡
- **WHEN** 点击状态卡上的 `🔄 刷新`
- **THEN** 该卡被按实时查询到的当前状态与负责人原地替换

#### Scenario: 查看时按实时状态重建
- **WHEN** 点开 `🔀 转状态`（或发 `/state`）
- **THEN** 返回的卡片按**实时查询**到的当前状态与可用转换重建，不依赖卡面上可能已过期的旧值

#### Scenario: Jira 侧变更不主动同步
- **WHEN** issue 状态被直接在 Jira 侧变更（非飞书操作）
- **THEN** 飞书状态卡不主动更新，直到下一次查看或转状态（拉取式语义）

#### Scenario: issue 消失时被动收尾
- **WHEN** 轮询发现 issue 已不存在（404）
- **THEN** 绑定标为 terminal，且状态卡被 PATCH 为已完结

#### Scenario: 召回式重发不残留旧卡
- **WHEN** 再次发布状态卡（如再发一次 `/state`）
- **THEN** 旧状态卡消息被删除，新卡出现在话题底部，绑定记录指向新卡

#### Scenario: 状态卡失效后自愈
- **WHEN** PATCH 状态卡返回失败（如卡片已被删除）
- **THEN** 系统重新发送一张状态卡、更新绑定的 card message id，并记 WARN

### Requirement: 点击式转状态流程
`🔀 转状态` 按钮的语义 SHALL 是"现在就拉取该 issue 当前可用的转换"，而非执行卡片渲染时预置的转换。点击后 SHALL 实时查询 `GET /issue/{key}/transitions` 并把每个可用转换渲染成一个按钮；点选某个转换 SHALL 进入确认行（`确认`/`取消`），确认后才 SHALL 写入 Jira。转换成功后 SHALL 即时 nudge scheduler、PATCH 状态卡，并在话题内广播结果。取消 SHALL NOT 产生任何写操作。转换在确认时已不可用 SHALL 报错并刷新状态卡。

#### Scenario: 点击列出当前可用转换
- **WHEN** 人点击状态卡上的 `🔀 转状态`
- **THEN** 系统实时查询并回列出当前可用转换的按钮（不硬编码、不使用过期列表）

#### Scenario: 选中转换需二次确认
- **WHEN** 人点选其中一个转换
- **THEN** 出现确认行（确认/取消）；只有点"确认"才写入 Jira

#### Scenario: 取消不产生写操作
- **WHEN** 人在确认行点"取消"
- **THEN** 不调用任何 Jira 写接口，流程结束

#### Scenario: 确认后更新状态卡并 nudge
- **WHEN** 人确认转换且 Jira 接受
- **THEN** 状态卡被 PATCH 为新状态、scheduler 被即时 nudge、话题内广播转换结果

#### Scenario: 转换已不可用
- **WHEN** 确认时该转换已不在可用列表中
- **THEN** 系统返回错误提示并刷新状态卡，不写入 Jira

### Requirement: Jira 缺席时桥的能力降级

桥作为飞书入口宿主在 `kind: none` 部署下 SHALL 照常构造与运行，但其 tracker 依赖为空。桥内全部 Jira 暴露面 SHALL 收敛到**唯一谓词——tracker 在场性**（装配期决定，桥不读 `tracker.kind`；全桥只允许这一处消费 tracker 可空性）。缺席时：镜像循环在 tick 首行短路（零 Jira 调用）；intake 的 `/issue` 与 `/state` 命中解析后路由到"未知命令。可用：<能力裁剪后清单>"兜底（不使用 Jira 专用错误文案——与 `/help` 裁剪语义自洽："不宣传 ⇒ 即不存在"）；`/help` 帮助卡与文本按能力裁剪（隐藏 `/issue`/`/state`，保留 `/chat`/`/agent` 与直连会话命令）；桥侧卡片按钮 handler（Jira 动作集 `state_open`/`state_refresh`/`state_summon`/`tr`/`tr_confirm`/`tr_cancel`/`agent_set`/`full`——`full` 亦依赖 Jira：它从 Jira 拉取评论全文后投递文件）首判谓词并返回提示 toast——平台入口纪律：外部输入显式降级，不抛异常。Sweep 照常执行（`/chat` 丢失兜底），逐绑定 Jira 拉取因无绑定自然为空。

#### Scenario: intake 敲 /issue 得兜底
- **WHEN** 直连专用部署中用户在 intake 群发 `/issue 修个 bug`
- **THEN** 回复"未知命令。可用：…"（含 `/chat`、`/agent`、`/help`），不创建任何 Jira issue，不抛异常

#### Scenario: /help 按能力裁剪
- **WHEN** 直连专用部署中用户发 `/help`
- **THEN** 帮助内容不含 `/issue` 与 `/state`，含 `/chat` 与 `/agent`

#### Scenario: 镜像循环零 Jira 调用
- **WHEN** 直连专用部署运行并触发 forwardTick
- **THEN** 不产生任何 Jira HTTP 请求，Sweep 正常执行

#### Scenario: 桥卡片按钮防御降级
- **WHEN** 桥侧卡片动作（如 `state_open`）在 tracker 缺席时被触发（防御场景）
- **THEN** 返回提示 toast"该操作需要 Jira 任务源"，不抛异常、不产生 Jira 请求

#### Scenario: /agent 不受影响
- **WHEN** 直连专用部署中用户在 intake 群发 `/agent`
- **THEN** 正常返回 agent 目录列表（该路径无 tracker 依赖）

#### Scenario: Jira 在场零变化
- **WHEN** 现有 Jira+飞书部署运行
- **THEN** 镜像、`/issue`、`/state`、`/help`、卡片按钮行为与现状一致（谓词为真，全路径放行）；唯一变化是 intake 未知命令兜底文案升级为能力清单式（两种模式同构，见上文）

