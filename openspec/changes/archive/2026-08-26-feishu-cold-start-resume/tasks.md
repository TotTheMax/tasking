# Tasks

## 1. FeishuSource 空游标语义 + 分页（TDD）

- [x] 1.1 写失败测试：`listMessages(chatId, "")` 的请求 URL 不含 `start_time`（`tests/feishu-source.test.ts`），运行确认红。
- [x] 1.2 `resolveStartTime` 空游标时返回 `null`，`listMessages` 在 start_time 为空时不传该参数（去除 24h 回退），运行确认绿。
- [x] 1.3 写失败测试：`listMessages(chatId, "1700000000")` 仍带 `start_time=1700000000`（回归），确认绿。
- [x] 1.4 写失败测试：`listMessages` 响应 `has_more=true` 带 `page_token` 时，第二次请求带上 `page_token` 且返回两页全部消息（`tests/feishu-source.test.ts` 自定义 fetch），确认红。
- [x] 1.5 在 `listMessages` 实现分页循环（`has_more` / `page_token`，空 token 停止），确认绿。
- [x] 1.6 写失败测试：`listThreadReplies(threadId, "")` 请求不含 `start_time`，`listThreadReplies(threadId, "1700000000")` 仍含（`tests/feishu-source.test.ts`），确认红。
- [x] 1.7 `listThreadReplies` 复用空游标语义 + 分页循环，确认绿。

## 2. 冷启动探测（TDD）

- [x] 2.1 写失败测试：`discoverIntake` 在 `intake_cursor` 为空且 intake 群存在历史消息时，`listMessages` 被以空 since 调用一次（不带 start_time）、`intake_cursor` 被置为 `max(create_time)`、本轮不建 issue 不回复 ack（`tests/comment-bridge.test.ts`），确认红。
- [x] 2.2 在 `discoverIntake` 加冷启动分支：游标为空 → `listMessages(intakeChat, "")` 探测、取 `max(create_time)` `setMeta("intake_cursor", ...)`、只记不处理并 return，确认绿。
- [x] 2.3 写失败测试：探测记录游标后，再次 `discoverIntake` 正常消费游标之后的 `/issue` 消息（建单 + 推进游标），确认红。
- [x] 2.4 验证下一轮增量消费路径（既有消费逻辑复用，无需大改），确认绿。

## 3. 既有测试适配 + mock 分页

- [x] 3.1 `tests/comment-bridge.test.ts` 既有 `discoverIntake` 用例（建单 / ack / 命令 / recalled）改为预置 `intake_cursor`（如 `setMeta("intake_cursor", "0")` 或较早时间戳），保持原断言语义，运行确认绿。
- [x] 3.2 `tests/helpers/feishu-mock.ts` 支持分页响应（`has_more` / `page_token`）与空 `start_time`（无时间参数时返回全部），运行确认绿。
- [x] 3.3 `tests/bridge-flow.test.ts` 预置 `intake_cursor` 以跳过冷启动探测、保持 E2E 流程语义，`npm run test:e2e` 确认绿。
- [x] 3.4 `tests/integration-real.test.ts` 如有 `listMessages(chatId, "")` 调用依赖旧 24h 语义，适配为探测语义（或确认不受影响）。

## 4. 文档 + 术语

- [x] 4.1 更新 `CONTEXT.md`：澄清 `Intake cursor`/`Cursor fallback` 术语为空游标改走冷启动探测、不再 24h 回看。
- [x] 4.2 新增 `docs/adr/0016-cold-start-intake-cursor.md`：记录冷启动探测决策（替代 24h 回看）与换机停机缺口取舍（Q1/Q3 确认）。
- [x] 4.3 同步 `docs/{en,zh}/configuration.md` feishu 块：说明游标为空时的冷启动探测行为（如需要）。

## 5. 验证

- [x] 5.1 `npm run lint && npm run typecheck && npm test` 全绿。
- [x] 5.2 `npm run test:e2e`（scheduler + bridge-flow 两条）全绿。
