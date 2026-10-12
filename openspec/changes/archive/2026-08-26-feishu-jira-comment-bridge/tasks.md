## 1. Config 与类型基础

- [x] 1.1 `FeishuConfig` 加 `intake_chat_id`/`poll_interval_ms`/`create_issue_type` 字段 + `DEFAULTS.feishu`（`poll_interval_ms=5000`）；`resolver.ts` 解析三字段（红：测试解析与默认值；绿：实现）。
- [x] 1.2 `validator.ts`：`feishu.enabled` 时缺 `intake_chat_id` 或 `create_issue_type` → 校验错误（红：测试报错；绿：实现）。

## 2. JiraTracker 新操作（走现有 `request()`）

- [x] 2.1 实现 `fetchComments(issueKey, afterId)`：`GET /issue/{key}/comment`，返回 id > afterId 的评论（红：mock-http 测试增量返回；绿：实现）。
- [x] 2.2 实现 `postComment(issueKey, body)` + `wrapCommentBody(text)`：v3 包 ADF、v2 裸串（红：mock-http 断言 POST body 形态；绿：实现）。
- [x] 2.3 实现 `createIssue(fields)`：`POST /issue` 带返回 key（红：mock-http 断言；绿：实现）。
- [x] 2.4 实现 `fetchTransitions(issueKey)` + `transitionIssue(issueKey, transitionId)`：GET 查表找 id、POST 转状态（红：mock-http 断言；绿：实现）。
- [x] 2.5 实现 `fetchIssueTypes(projectKey)`：`GET /project/{key}/issueTypes` 列可用 type（红：mock-http 断言；绿：实现，复用 `fetchProjectStatuses` 模式）。

## 3. FeishuSource 扩展

- [x] 3.1 实现 `listMessages(chatId, sinceCursor)`：`GET /im/v1/messages?container_id=<chat>&start_time=<cursor>`（红：mock fetch 断言；绿：实现）。
- [x] 3.2 实现 `replyInThread(chatId, rootId, text)`：POST 带 `root_id`，复用 `reply` 的 token 缓存（红：mock fetch 断言带 root_id；绿：实现）。

## 4. BindingStore（复用 inbox-store 的 better-sqlite3+WAL 模式）

- [x] 4.1 建 `src/bridge/binding-store.ts`：schema `issue_key → {chat_id, root_id, last_jira_comment_id, last_feishu_msg_id, status}`；方法 get/upsertBinding/advanceJiraCursor/advanceFeishuCursor/markTerminal/markActive（红：测试 upsert+get+游标推进+terminal 翻转；绿：实现）。

## 5. 命令解析与执行（`src/bridge/commands.ts`）

- [x] 5.1 `/help`：返回含 `/issue`/`/state`/`/help` 语法的静态文本（红：测试文本；绿：实现）。
- [x] 5.2 `/issue` 解析：位置式 title(第 1 行)+desc(余行)+`--type <name|N>` 覆盖+无参标记（红：测试各形态解析；绿：实现 `parseIssue`）。
- [x] 5.3 `/issue` 执行：`createIssue`（summary=title, description=desc, project/assignee/labels=`tracker.*` 锁定, type=config 或 `--type`）+ 建 binding（`/issue` 消息为根）+ 确保 active 状态（红：mock tracker+bindingStore 测试建成+binding 写入+三字段锁定；绿：实现 `executeIssue`）。
- [x] 5.4 `/issue` 无参发现：`fetchIssueTypes` 列可用 type + 标默认（红：测试列表格式；绿：实现）。
- [x] 5.5 `/state` 无参：`fetchTransitions` → 列当前状态 + 编号转移（红：测试列表；绿：实现）。
- [x] 5.6 `/state <N|name>`：匹配可用转移 + `transitionIssue` + nudge（红：测试编号/名字匹配转 + nudge 回调被调；绿：实现，nudge 回调注入）。

## 6. CommentBridge 同步循环（`src/bridge/comment-bridge.ts`）

- [x] 6.1 Jara→飞书 forward 循环：拉 `id>cursor` 评论、有 sentinel 跳过不回发但仍推进游标、无 sentinel 转发为话题回复（红：mock 三依赖测试；绿：实现 `forwardComments`）。
- [x] 6.2 飞书→Jira bridge 循环：拉 `msg>cursor`、bot 作者跳过、`/` 命令跳过、人自由文本桥成带 sentinel 的 Jara comment + 推进（红：mock 三依赖测试；绿：实现 `bridgeMessages`）。
- [x] 6.3 intake `/issue` 发现：轮询 intake 群顶层找 `/issue` → `executeIssue`（红：测试发现+执行+建 binding；绿：实现 `discoverIntake`）。
- [x] 6.4 terminal 收尾：scheduler terminal 事件 → 发"✅ 已完结"ack + `markTerminal` + 停该话题同步（红：测试事件→ack+mark；绿：实现，hook scheduler terminate 事件）。
- [x] 6.5 reopen 可逆：terminal binding 在 issue 回 active 时翻 `status` 回 active + 续同步（红：测试翻转；绿：实现 `markActive`）。
- [x] 6.6 start/stop 生命周期 + 自带 timer：start 启 `feishu.poll_interval_ms` timer、stop 清 timer、与 scheduler 并列互不阻塞（红：测试 isRunning+不阻塞；绿：实现 `CommentBridge` 类 + tick 循环）。

## 7. cli/index.ts start 接线

- [x] 7.1 `start` 实例化 CommentBridge（注入 JiraTracker+FeishuSource+BindingStore+config+logger + `requestRefresh` 句柄）+ 与 scheduler 并列启停（红：测试 start 后 bridge 运行、stop 后停；绿：接线）。

## 8. 删 superseded triage

- [x] 8.1 删 `src/router/route-agent.ts`、`src/plugin/tools.ts`（triage 工具）、`triage` 子命令桩、`TaskSource="feishu"` 幻影用法；删/调相关测试（`route-agent.test.ts`/`plugin-tools.test.ts` 等）使全绿。
- [x] 8.2 删 `src/router/inbox-store.ts` + `tests/inbox-store.test.ts`（模式已迁 `binding-store`）；若 `src/router/`/`src/plugin/` 空则删空目录。

## 9. init 发现 issueType

- [x] 9.1 `init.ts`：init 流程列项目可用 issueType（`fetchIssueTypes`）帮人配 `feishu.create_issue_type`（红：测试 init 输出含 issueType 列表；绿：实现，复用 `fetchProjectStatuses` 的展示模式）。

## 10. 文档同步

- [x] 10.1 `docs/configuration.md`：加 `feishu.intake_chat_id`/`poll_interval_ms`/`create_issue_type` 字段表 + 默认 + REST 轮询下 `verification_token`/`encrypt_key` 不用说明。
- [x] 10.2 `docs/usage.md`：加飞书桥 setup（app scope `im:message`/`im:chat`/`im:message:send_as_bot`、intake 群、`GET /im/v1/chats` 取 `intake_chat_id`）+ `/issue`/`/state`/`/help` 用法 + 双向同步/延迟说明。
- [x] 10.3 `docs/state-flow.md`：加飞书↔Jara 桥流转图。

## 11. 验证

- [x] 11.1 `npm run lint` 全绿
- [x] 11.2 `npm run typecheck` 全绿
- [x] 11.3 `npm test` 全绿

> 注：delta specs 同步到主 specs 由 `openspec archive` 在归档时完成（`openspec archive` 会 update main specs），不在实施阶段手动同步。
