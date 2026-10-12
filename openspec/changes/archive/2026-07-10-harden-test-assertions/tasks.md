## 1. Spec 修正（消除矛盾描述）

- [x] 1.1 修正 `openspec/specs/opencode-worker/spec.md` 的"有界续轮循环"Requirement：将"continuation retry SHALL 创建全新 session"改为"continuation retry SHALL 续接已有 session（传入上次 worker 返回的 session ID）"
- [x] 1.2 修正 `openspec/specs/opencode-worker/spec.md` 的"Session 生命周期管理"Requirement：将"continuation retry 创建全新 session"改为"continuation retry 续接已有 session"
- [x] 1.3 修正 `openspec/specs/opencode-worker/spec.md` 的"聚合 token 与运行时记账"Requirement：将"累加所有 step 的 token 之和"改为"取最后一个 step_finish 的累积值"
- [x] 1.4 修正 `openspec/specs/structured-scheduler/spec.md` 的"任务编排状态机"Requirement：将"传 null session ID（continuation retry 创建全新 session）"改为"传播 worker 返回的 session ID（continuation retry 续接已有 session）"
- [x] 1.5 修正 `openspec/specs/structured-scheduler/spec.md` 的"retry 与指数退避"Requirement：将"所有 retry 携带 null session ID"改为"continuation retry 携带 session ID，failure/stalled retry 携带 null"
- [x] 1.6 逐行审查修正后的 spec，确保所有 Requirement 和 Scenario 一致无矛盾

## 2. 测试文件类型错误修复

- [x] 2.1 修复 `tests/worker.test.ts` 中所有 `Task` 对象缺失的 `assignee` 字段（统一补 `assignee: null`）
- [x] 2.2 修复 `tests/worker.test.ts` 中所有 `TrackerConfig` 对象缺失的 `assignee` 字段
- [x] 2.3 修复 `tests/worker.test.ts` 中 `error` 字段类型不匹配（`"exit 1"` 赋给 `null` 类型）
- [x] 2.4 修复 `tests/scheduler.test.ts` 中 `OrchestratorRuntimeState` mock 的 `claimed` 类型（`Set<unknown>` → `Set<string>`）
- [x] 2.5 修复 `tests/observability.test.ts` 中 `RetryEntry` 缺失的 `session_id` 字段
- [x] 2.6 修复 `tests/regression.test.ts` 中 `RetryEntry` 缺失的 `session_id` 字段

## 3. 已有测试断言修正（验证正确行为而非实现行为）

- [x] 3.1 确认 `tests/scheduler.test.ts` 的"continuation retry preserves session_id"断言正确（已在本次会话修复，验证通过）
- [x] 3.2 确认 `tests/worker.test.ts` 的"takes last step_finish tokens"断言正确（已在本次会话修复，验证通过）
- [x] 3.3 确认 `tests/observability.test.ts` 的"suppressStderr prevents stderr output"断言正确（已在本次会话修复，验证通过）
- [x] 3.4 确认 `tests/observability.test.ts` 的"child logger inherits stderr suppression"断言正确（已在本次会话添加，验证通过）
- [x] 3.5 审查 `tests/scheduler.test.ts` 所有断言，确认没有其他"匹配实现行为"而非"验证正确行为"的断言
- [x] 3.6 审查 `tests/worker.test.ts` 所有断言，同上
- [x] 3.7 审查 `tests/observability.test.ts` 所有断言，同上

## 4. 新增集成测试

- [x] 4.1 在 `tests/scheduler.test.ts` 的 "session ID propagation" describe 块中新增全链路测试：worker 正常退出 → scheduleRetry 传播 session_id → onRetry 派发 → runAttempt 收到非 null sessionId
- [x] 4.2 在 `tests/scheduler.test.ts` 中新增全链路测试：worker 异常退出 → scheduleRetry 传 null → onRetry 派发 → runAttempt 收到 null sessionId
- [x] 4.3 在 `tests/worker.test.ts` 中新增 extractSessionAndUsage 测试：3 个 step_finish token 递增（100→150→200），验证取最后值 200 而非累加 450
- [x] 4.4 在 `tests/worker.test.ts` 中新增 extractSessionAndUsage 测试：单个 step_finish，验证取该值
- [x] 4.5 在 `tests/workspace.test.ts` 中新增 removeWorkspace 测试：传入 session_id 参数，验证 deleteSession 被调用
- [x] 4.6 在 `tests/workspace.test.ts` 中新增 removeWorkspace 测试：session_id 为 undefined 时回退到 sidecar 文件读取

## 5. 验证

- [x] 5.1 运行 `npm run lint` 确认无错误
- [x] 5.2 运行 `npm run typecheck` 确认无错误
- [x] 5.3 运行 `npm test` 确认所有测试通过
- [x] 5.4 运行 `npm run build` 确认构建成功
