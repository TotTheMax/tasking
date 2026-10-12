## Context

tasking 是 poll-based daemon：`Daemon` tick（`polling.interval_ms` 30s）跑 `Scheduler.tick`，轮询 Jira 候选 issue + reconcile 状态 + 派发 opencode worker。飞书侧（`FeishuSource`/`InboxStore`/`RouteAgentRunner`）已实现但**未接入**——`triage` 子命令只打印 "not wired"（`cli/index.ts:69`），`new FeishuSource`/`new InboxStore` 仅出现在测试里。agent 经 MCP（`mcp/jira-server.ts`，凭证 = `tracker.api_key`/`api_user`，与 tasking **共享同一 Jira 账号**）读写 Jira REST；grill-openspec 的 grill Q / 人答都走 Jira comment。约束：runtime/agent 不动（ADR 0001）；架构简洁、复用现有逻辑。

## Goals / Non-Goals

**Goals:**

- Feishu 成已存在 Jira issue 的评论同步镜像（双向），1:1 issue↔话题，人只在飞书、agent 只认 Jira。
- runtime/agent/MCP/scheduler 不动（延展 ADR 0001 边界到飞书侧）。
- 复用 `FeishuSource`（token 缓存/`reply()`）/store 模式/`JiraTracker.request()`/`HttpDashboard.requestRefresh`；删 superseded triage。
- 无公网端口、零新依赖。

**Non-Goals:**

- 不改 `src/scheduler/*`/`src/worker/*`/`src/mcp/*`/`prompt.ts`/`runner.ts`。
- 不让 agent 直接发飞书（无 `feishu.reply` MCP）。
- 不支持图片/交互卡片/友好别名/per-issue 字段覆盖/多项目/1:N 扇出/LLM triage/编辑删除同步——皆 deferred。
- 不持久化 binding 跨 tasking 重装（SQLite 本地，重启游标续上即可）。

## Decisions

1. **Feishu = 评论同步镜像，非任务源**（ADR 0002）。删 `RouteAgentRunner`/triage/phantom `TaskSource="feishu"`/`triage` 桩；新增 sibling `CommentBridge` 双向镜像 Jira comment ⇄ 飞书话题。被否：给 agent `feishu.reply` MCP（破 runtime 不动、agent 多副作用）；同步塞 scheduler（破单一职责 + 5s vs 30s 节奏冲突）。

2. **绑定 = 飞书话题(`root_id`)，1 issue↔1 线程，无扇出**（ADR 0002）。一个指定 intake 群（`feishu.intake_chat_id`）承载所有线程；`/issue` 消息即根（Feishu-origin），Jira-origin dispatch 公告即根。被否：一群一 issue（成员管理重）；1:N 扇出（多游标 + 哪个是主场）。

3. **入站 REST 轮询，不用 webhook/长连接**（ADR 0003）。outbound-only、无公网、零依赖（复用 `FeishuSource.fetchImpl`）、与 scheduler tick 对称。5s 定向轮询绑定线程双向同步；`/issue` 在 intake 群内发现、无多群扫描。被否：webhook（需公网/隧道）；长连接 WS（官方 SDK 依赖 + 持久连接可靠性模型，破"全是无状态 tick"极简）。

4. **去重用可见 sentinel，不用作者/隐藏标记**（ADR 0004，被共享凭证强制）。`buildMcpConfig` 把 `tracker.api_key`/`api_user` 注入 agent → tasking 与 agent 同一 Jira 账号 → Jara 侧 comment 作者相同、无法按作者区分 → 必须内容 sentinel。可见前缀 `💬 {sender} via 飞书 [msg:{id}]:` 兼归属+标记。被否：第二 Jira 账号恢复作者去重（运维开销）；Jara `properties` 隐藏 marker（多一套读写机制）。

5. **Binding 表 + 双游标**（持久 SQLite，复用 inbox-store 的 better-sqlite3+WAL 模式）：`issue_key → {chat_id, root_id, last_jira_comment_id, last_feishu_msg_id, status}`。Jara→飞书 拉 `id>cursor` 评论，有 sentinel 跳过不回发但仍推进游标，无 sentinel 转发+推进；飞书→Jira 拉 `msg>cursor`，bot 作者/`/`命令跳过不桥仍推进，人自由文本桥成带 sentinel 的 Jara comment+推进。崩在半路由 sentinel/`msg_id` 兜底幂等。

6. **`CommentBridge` sibling，自带 timer**。依赖注入同 scheduler（`JiraTracker`+`FeishuSource`+`BindingStore`+config+logger），`cli/index.ts` 的 `start` 里并列实例化 + 启停。一个 fast timer（`feishu.poll_interval_ms` 默认 5000）跑双向绑定同步。scheduler 不动。

7. **命令面纯命令、无 LLM**。`/issue <title>\n<desc>` 位置式（title→Jira `summary`、desc→`description` 字段非 comment → 无回显；project/assignee/labels 锁定复用 `tracker.project_key`/`assignee`/`required_labels` 保证被拾起；type `--type` 覆盖 + 无参发现 `GET /project/{key}/issueTypes`，复用 `fetchProjectStatuses` 的 init-发现模式）。`/state` 无参列 issue 可用转移编号（`GET /issue/{key}/transitions` 运行时发现、不硬编码状态名）、`/state <N|name>` 匹配转。`/help` 静态文本。命令皆 `/` 前缀 → Feishu→Jira 跳过、consumed。

8. **`/state` 转完即时 nudge scheduler**，复用 `HttpDashboard.requestRefresh`，不等 30s 轮询。控制命令该即时。

9. **terminal 收尾可逆**。scheduler terminal 检测 → 发"✅ 已完结"ack（Feishu-only、bot、consumed）+ 标 binding `terminal` + 停同步；reopen（Jira 状态回 active）翻 status 回 active 续同一话题（行 + root_id 还在）。

10. **`/issue` 三字段锁定复用 tracker**：project/assignee/labels 从 `tracker.*` 取、不可 per-issue 覆盖——覆盖会破坏 `buildJql`(assignee)/`isRoutable`(labels) 匹配 → issue 成孤儿不被派发。只有 type（`isRoutable` 不看）可覆盖。

## Risks / Trade-offs

- **[轮询延迟]** ≤`feishu.poll_interval_ms`（5s）。→ 与 Jira 30s 同类、人体验一致；要亚秒级再上长连接。
- **[API 限流]** 绑定线程数 × 节奏。→ 中小规模（≤20-50 活跃线程）5s 无压力；大规模再调或上长连接。
- **[sentinel 碰撞]** 真评论含 `via 飞书 [msg:`。→ 带 `message_id` 的独特形态几乎零碰撞；且碰撞只导致少转一条、非破坏。
- **[agent 读到 sentinel 归属前缀]** 对 agent 轻微噪声。→ 也是有用归属（知道来自人/飞书）；可接受。
- **[删 triage 是 BREAKING]** 但被删部分本就未接入运行 daemon。→ 无运行时影响，只删测试 + 桩。
- **[intake 群单一]** 所有 issue 线程在一个群。→ 一个群多话题是 D2 模型最简形态；要多群分论后加。
- **[编辑/删除不同步]** v1 忽略。→ 游标 + sentinel 兜底重发（按新消息处理），可接受；要严格同步后加。

## Migration Plan

无需数据迁移（新功能 + 删未接入代码）。部署前置：配 `feishu.enabled=true` + `feishu.intake_chat_id`（`GET /im/v1/chats` 取）+ `feishu.create_issue_type`（init 发现）+ 飞书 app 授权 scope（`im:message` 读、`im:chat` 列群、`im:message:send_as_bot` 发）；bot 加进 intake 群；`tasking start`。
