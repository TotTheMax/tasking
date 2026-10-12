## 1. Store 层(TDD)

- [x] 1.1 `tests/binding-store.test.ts` 写失败测试:对同一 `issue_id` 二次 `upsertBinding` 携带新 `thread_id` → `getBinding` 返回新值;携带 NULL → 现有好值不被抹掉;携带同值 → 行不更新(status/游标不变,terminal 行不复活)。运行确认红
- [x] 1.2 `src/bridge/binding-store.ts` 将 `upsertBinding` 改为 conditional upsert(`ON CONFLICT(issue_id) DO UPDATE SET thread_id = excluded.thread_id WHERE excluded.thread_id IS NOT NULL AND bindings.thread_id IS NOT excluded.thread_id`),确认绿

## 2. Bridge 治愈路径(TDD)

- [x] 2.1 `tests/comment-bridge.test.ts` 写失败测试:构造 thread_id 为 NULL 的 active binding → mock `replyInThread` 响应携带 thread_id → 跑 `forwardComments` → 断言 `bindings.getBinding(issue_id).thread_id` 已持久化(直查 store,非内存副本)。运行确认红
- [x] 2.2 验证现有实现经 1.2 修复后该测试转绿(预期 1.2 已使其绿;若红,修 `forwardComments` 调用点)

## 3. 门禁

- [x] 3.1 `npm run lint && npm run typecheck && npm test -- tests/binding-store.test.ts tests/comment-bridge.test.ts tests/bridge-flow.test.ts`
- [x] 3.2 `npm run test:e2e`(bridge 变更硬门禁);内网可达时 `npm run test:integration`,不可达则在交付说明注明原因
