# 飞书话题消息回执（已收到确认）

## Context

飞书桥（`CommentBridge`）在已绑定话题内把用户非命令自由文本桥成带 sentinel 的 Jira comment（`bridgeMessages()`，`src/bridge/comment-bridge.ts:191-260`），但全程不回复任何确认，用户在话题里只看到自己的消息（显示未读），无法确认是否被 tasking 正确拉取并添加。intake 群根消息已有 intake 回执（TAS-4），话题内尚无对应确认。

拷问结论（TAS-7 Jira 评论 11421/11422）：
- Q1 采用推荐文案：成功回执 `✅ 已收到，已同步到 {issue_key}`。
- Q2 失败也要回执：在 tasking 已尝试写入 Jira 之后，回复失败回执。

## Goals / Non-Goals

Goals：
- 话题内非命令自由文本桥接成功 → 成功回执。
- 话题内非命令自由文本桥接失败（非 404）→ 失败回执（tasking 尝试之后）。
- 回执不回投、不重桥、不进 Jira、不建 binding、不新增配置项。

Non-Goals：
- 不改变命令分支（`/issue`、`/state`、`/help`）现有行为与文案。
- 不做消息重试（失败消息维持现状：日志 + 游标推进）。
- 不新增配置项、不新增依赖、不改数据模型。

## Decisions

### D1：回执以 `reply_in_thread` 回复到该条消息下
桥接成功/失败后，以用户消息 `m.message_id` 为目标调用 `feishu.replyInThread(m.message_id, text)`，回执出现在用户消息下、位于话题内。
- 备选：`replyFlat(b.root_id, ...)`（回复话题根）——回执不与具体消息关联，用户难对应；`postMessage` 平铺到群——脱离话题。
- 理由：与 `executeIssue` 创建后回执（`replyInThread(msgId, "✅ 已创建 ...")`）同一模式，用户最容易对应"这条消息被处理了"。

### D2：回执文案用固定常量，不新增配置项
`src/bridge/commands.ts` 新增 `THREAD_ACK_TEXT = "✅ 已收到，已同步到 {issue_key}"` 与 `THREAD_ACK_FAIL_TEXT = "⚠️ 同步失败，请稍后重试"`，与 intake 回执 `INTAKE_ACK_TEXT` 同级。
- 备选：新增 `feishu.thread_ack_text` 配置项——扩大配置面，文案属展示层，将来需要时再升级。
- 理由：与既有 intake 回执模式一致，范围最小。

### D3：回执由 bot 发出，天然防回投
回执 sender 为 app，`bridgeMessages` 的 `m.sender_type === "app"` 分支已跳过 bot 消息；`forwardComments` 也只会转发无 sentinel 的 Jira comment，回执不写 Jira，故无环。无需额外去重状态。

### D4：回执发送失败不影响游标推进
桥接成功后即使回执发送失败（飞书 API 异常），消息已桥入 Jira，游标照常推进、仅记日志（warn）。失败回执同理。

### D5：404 绑定清理不回执
`postComment` 返回 404 表示 issue 不存在，维持现有 `markTerminal` 绑定清理，不发送失败回执（话题已废弃，无意义）。

## Risks / Trade-offs

- [回执在 busy 话题里刷屏] → 每消息一回执符合"拉取并添加就回复"的需求；若需节流属后续演进，本期不引入。
- [回执文案含 emoji（✅/⚠️）在部分客户端渲染差异] → 与既有 `✅ 已创建`、`✅ 已完结` 风格一致，无新风险。

## Migration Plan

无迁移：纯行为增量，daemon 重启后生效。回滚 = 回退本 MR。

## Open Questions

无。
