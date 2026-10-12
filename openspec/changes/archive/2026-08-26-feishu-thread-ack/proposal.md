# 飞书话题消息回执（已收到确认）

## Why

现在在已绑定话题内发送消息显示的都是未读：用户发一条自由文本，tasking 桥成 Jira comment 后没有任何确认回复，用户不知道消息是否被 tasking 正确拉取并添加到 Jira。需要一个消息确认机制消除这种不确定。

## What Changes

- 话题内桥接成功：`bridgeMessages()` 把用户非命令自由文本桥成 Jira comment 成功后，在该条消息下 `reply_in_thread` 回复成功回执 `✅ 已收到，已同步到 {issue_key}`。
- 话题内桥接失败：tasking 尝试写入 Jira 失败（非 404）后，回复失败回执 `⚠️ 同步失败，请稍后重试`，让用户立刻知道没成功。
- 命令消息（`/issue`、`/state`、`/help`）按各自现有分支处理，不触发话题回执。
- 回执由 bot 发出（`sender_type=app`），下一轮轮询自动跳过，不会回投、不会重桥；回执不进 Jira、不建 binding（与 intake 回执一致）。
- 回执发送失败不影响游标推进（消息已桥入 Jira），仅记日志。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `feishu-source`：话题桥接在桥成 Jira comment 成功后新增成功回执；写入失败时新增失败回执。

## Impact

- `src/bridge/comment-bridge.ts`：`bridgeMessages()` 在 `postComment` 成功/失败分支新增回执发送。
- `src/bridge/commands.ts`：新增 `THREAD_ACK_TEXT` 与 `THREAD_ACK_FAIL_TEXT` 常量。
- `tests/comment-bridge.test.ts`：新增话题回执相关测试。
- 文档：`docs/usage.md` 飞书桥命令/回执说明。
- 无新增依赖、无配置项、无数据模型变更。
