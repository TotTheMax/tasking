# Tasks

## 1. 回执常量

- [x] 1.1 在 `src/bridge/commands.ts` 新增 `THREAD_ACK_TEXT`（`✅ 已收到，已同步到 {issue_key}`）与 `THREAD_ACK_FAIL_TEXT`（`⚠️ 同步失败，请稍后重试`）常量。

## 2. 话题桥接回执（TDD）

- [x] 2.1 写失败测试：`bridgeMessages` 桥接成功时对用户消息 `reply_in_thread` 回复 `✅ 已收到，已同步到 {issue_key}`（`tests/comment-bridge.test.ts`），运行确认红。
- [x] 2.2 在 `bridgeMessages` 的 `postComment` 成功分支新增成功回执（回复到 `m.message_id`，`try/catch` 包裹、失败仅 warn），运行确认绿。
- [x] 2.3 写失败测试：`bridgeMessages` 桥接失败（非 404）时回复 `⚠️ 同步失败，请稍后重试` 且游标推进，运行确认红。
- [x] 2.4 在 `bridgeMessages` 的 `postComment` 非 404 失败分支新增失败回执（`try/catch` 包裹、失败仅 warn），运行确认绿。
- [x] 2.5 写失败测试：`postComment` 404 时维持绑定清理（markTerminal）且不回执，运行确认红。
- [x] 2.6 验证 404 分支不回执（维持现有清理行为，无需改动或最小改动），运行确认绿。
- [x] 2.7 补回归断言：回执（bot 消息）在下轮轮询被跳过、不重桥、不重复回执（跨 tick 幂等）。

## 3. 文档

- [x] 3.1 更新 `docs/usage.md` 飞书桥说明：话题内自由文本桥接成功/失败回执。
- [x] 3.2 如回执文案/行为涉及文档其他处（`docs/README.md`、`docs/feishu-quickstart.md`）同步。

## 4. 验证

- [x] 4.1 `npm run lint && npm run typecheck && npm test` 全绿。
