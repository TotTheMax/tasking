## 1. 分类延迟重试与降级

- [x] 1.1 可重试错误延迟重试成功（红→绿：先在 `tests/direct-sessions.test.ts` 写失败测试——updateCard 首次抛 5xx（`TaskingError("feishu_api_status", …, {status: 504})`）、延迟后重试成功，断言卡片原地继续且无任何工具文本；测试经 deps 注入 `cardRetryDelayMs: 0` 消除真实等待。随后在 `flushTurnCard` 实现错误分类（status≥500 / 429 / `feishu_api_request` 可重试；其余 4xx 快速失败）+ 延迟重试使其通过）
- [x] 1.2 重试仍败降级为增量单条文本（红→绿：先写失败测试——延迟重试仍 504、此前已有工具上卡，断言降级文本为单条消息且只含未上卡工具；现有游标推进语义保证增量，此测试锁定合并单条行为）
- [x] 1.3 下一 turn 自动恢复卡片（红→绿：先写失败测试——某 turn 降级后发新消息开启下一 turn，断言新 turn 创建了新轮次卡片；随后在 `startTurnCard` 重置 `cardsAvailable` 并移除跨 turn 永久禁用路径）
- [x] 1.4 4xx 快速失败（红→绿：先写失败测试——updateCard 抛 `status: 400`，断言无延迟等待（重试计数为 0）且立即进入本 turn 文本降级）
- [x] 1.5 flush 防重入（红→绿：延迟窗口内并发触发两次 flush，断言不产生重复 update/重复文本；`rt.flushInFlight` 串行化）

## 2. 文档与门禁

- [x] 2.1 known-issues 双语补一条环境说明：Lark 国际版 API 需稳定国际线路，代理/劣质直连会造成 5xx 与卡片降级（飞书版不受影响）
- [x] 2.2 全量门禁：`npm run lint`、`npm run typecheck`、`npm test`、`npm run build` 全绿，且 `tests/direct-card.test.ts`、`tests/card-roundtrip.test.ts` 保持通过（卡片交互规约）
