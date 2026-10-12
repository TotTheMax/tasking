## Why

三个生产 bug（session_id 丢失导致同一任务创建多个 session、token 累加导致计数膨胀 6 倍、removeWorkspace 未传 session_id 导致 ENOENT）均未被现有测试捕获。根因是测试"验证代码做了什么"而非"代码应该做什么"——测试用合成数据+错误假设匹配实现行为，且 spec 自身存在矛盾（structured-scheduler 同时说 continuation retry 传 null 和传播 session_id）。

## What Changes

- 修复 `opencode-worker` spec 中"continuation retry 创建全新 session"的矛盾描述，统一为"continuation retry 续接已有 session"
- 修复 `structured-scheduler` spec 中"传 null session ID"的矛盾描述，统一为"continuation retry 传播 session ID"
- 修复 `opencode-worker` spec 中"累加所有 step 的 token 之和"的错误描述，改为"取最后一个 step_finish 的累积值"
- 审查全部测试文件，将"匹配实现行为"的断言改为"验证正确行为"的断言
- 新增集成测试覆盖完整调用链：`onWorkerExit → scheduleRetry → onRetry → dispatch`，验证 session_id 全链路传播
- 新增 `extractSessionAndUsage` 测试用真实累积模式的 step_finish 数据（多个 step 的 token 递增而非重复累加）
- 新增 `removeWorkspace` 集成测试：`terminateRunning` 传入 `entry.session_id` 而非依赖 sidecar 文件 fallback
- 新增 `suppressStderr` 测试验证 stderr 实际被抑制（原测试只验证 file sink 仍写入）

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `opencode-worker`: 修正 continuation retry session 行为描述（从"创建全新 session"改为"续接已有 session"）；修正 token 提取描述（从"累加所有 step"改为"取最后一个 step_finish 的累积值"）
- `structured-scheduler`: 修正 continuation retry session ID 传播描述（从"传 null"改为"传播 session ID"），消除与 Session ID 传播 Requirement 的矛盾
- `regression-and-integration-tests`: 新增集成测试覆盖 session_id 全链路传播、token 累积值提取、removeWorkspace 传 session_id、suppressStderr 实际抑制验证

## Impact

- `openspec/specs/opencode-worker/spec.md` — 修正 2 处行为描述
- `openspec/specs/structured-scheduler/spec.md` — 修正 2 处行为描述，消除矛盾
- `openspec/specs/regression-and-integration-tests/spec.md` — 新增测试要求
- `tests/scheduler.test.ts` — 已修复 continuation retry session_id 断言（null → 传播值），需补充全链路集成测试
- `tests/worker.test.ts` — 已修复 extractSessionAndUsage 断言（累加 → 取最后值），需补充累积模式测试
- `tests/observability.test.ts` — 已补充 suppressStderr 实际抑制验证和 child logger 继承抑制验证，需补充更多行为测试
- `tests/workspace.test.ts` — 需补充 removeWorkspace 传入 session_id 的集成测试
