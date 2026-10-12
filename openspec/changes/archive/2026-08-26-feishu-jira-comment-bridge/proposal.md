## Why

Feishu 接入当前是"每条 @ 消息 → triage agent 判 → 合成幻影 `source:feishu` 任务"，且 `RouteAgentRunner` 根本未接入 daemon（`triage` 子命令只打印 "not wired"）——是死代码。难以把飞书对话和已有 Jira issue 关联，triage 用 LLM、合成任务无 Jira 实体。需要：飞书话题 ↔ Jira comment 按**已存在 issue** 1:1 双向镜像，人只在飞书、agent 只认 Jira，scheduler/agent/runtime 一概不动（延展 ADR 0001 的"runtime 不动"边界到飞书侧）。

## What Changes

- 新增 sibling 组件 `CommentBridge`（自带 timer、依赖注入 `JiraTracker`+`FeishuSource`+`BindingStore`+config+logger、与 scheduler 并列启停）：双向镜像 Jira comment ⇄ 飞书话题；按 issue 1:1 绑定到飞书话题（`root_id`），一个指定 intake 群承载所有线程；5s 定向轮询绑定线程做双向同步。
- 入站用 REST 轮询（`GET /im/v1/messages`），outbound-only、无公网端口、零新依赖（复用 `FeishuSource.fetchImpl`），与 scheduler tick 对称。
- 去重用可见 sentinel `💬 {sender} via 飞书 [msg:{id}]:`（兼归属+标记；共享 Jira 凭证强制此方案）；Feishu→Jira 跳 bot 作者 + `/` 命令前缀；Jara→飞书跳 sentinel。人直接在 Jira 发的 comment 无 sentinel → 转发（保完整性）。
- 命令面（纯命令、无 LLM）：`/issue <title>\n<desc>` 建真 Jira issue（project/assignee/labels 锁定复用 `tracker.project_key`/`assignee`/`required_labels` 保证被 `isRoutable`/`buildJql` 拾起；type 可 `--type` 覆盖、无参发现可用 type）；`/state`（无参列 issue 可用转移编号、`/state <N|name>` 转状态、转完即时 nudge scheduler 复用 `requestRefresh`）；`/help` 列命令。
- terminal 发"✅ 已完结"ack + 标 binding `terminal` + 停同步；reopen 翻 status 回 active 续同一话题。
- **BREAKING** 删 `RouteAgentRunner`/triage prompt/`TaskSource="feishu"` 幻影任务派发/`triage` 子命令桩（Feishu 不再当任务源，改评论同步镜像）。注：被删部分本就未接入运行 daemon。
- v1 纯文本（Jira comment ADF 拍平成纯文本发飞书；编辑/删除忽略）；图片/交互卡片/友好别名/per-issue 字段覆盖/多项目/扇出/LLM triage 皆 deferred。

## Capabilities

### New Capabilities

- `comment-bridge`: CommentBridge 组件 + Binding（issue↔飞书话题 1:1 + 游标）+ 双向评论同步（sentinel 去重）+ `/issue`/`/state`/`/help` 命令面 + terminal 收尾（ack+停同步+reopen 可逆）。

### Modified Capabilities

- `feishu-source`: FeishuSource 扩展——线程回复（带 `root_id`）、消息轮询（`GET /im/v1/messages`）、ingestion 按 binding/命令分叉（取代旧 triage）；`FeishuConfig` 加 `intake_chat_id`/`poll_interval_ms`/`create_issue_type`，`verification_token`/`encrypt_key` 标注 REST 轮询下不用（保留无害）。
- `jira-tracker`: 加 `fetchComments`/`postComment`/`createIssue`/`fetchTransitions`/`transitionIssue`（皆走现有 `request()` 助手）。
- `unstructured-router`: **REMOVED** `RouteAgentRunner`/triage prompt/`TaskSource="feishu"` 幻影任务派发/`triage` 子命令；inbox store 的 better-sqlite3+WAL 模式复用为 binding store（归 `comment-bridge`）。

## Impact

- 新增：`src/bridge/comment-bridge.ts`（sibling 组件 + timer + 同步循环）、`src/bridge/binding-store.ts`（复用 inbox-store 模式，存 `issue_key→{chat_id,root_id,last_jira_comment_id,last_feishu_msg_id,status}`）、`src/bridge/commands.ts`（`/issue`/`/state`/`/help` 解析+执行）。
- 改：`src/adapters/feishu/source.ts`（线程回复、消息轮询、ingestion 分叉）、`src/adapters/jira/tracker.ts`（加五方法）、`src/config/config-types.ts`+`resolver.ts`+`validator.ts`（三新字段解析 + `feishu.enabled` 时强校 `intake_chat_id`/`create_issue_type`）、`src/cli/init.ts`（init 发现 issueType 列表，复用 `fetchProjectStatuses` 模式）、`src/cli/index.ts`（`start` 实例化 + 启停 CommentBridge，复用 `requestRefresh` 句柄）。
- 删：`src/router/route-agent.ts`、`src/plugin/tools.ts` 的 triage 工具、`src/router/inbox-store.ts` 的 triage 语义、`triage` 子命令桩。
- 不动：`src/scheduler/scheduler.ts`、`src/worker/*`、`src/mcp/*`、`src/worker/prompt.ts`、`src/worker/runner.ts`、`src/observability/http-dashboard.ts`（仅其 `requestRefresh` 被复用）。
- 已落：`docs/adr/0002`/`0003`/`0004` + `CONTEXT.md` 术语（Feishu↔Jira bridge 节）。
