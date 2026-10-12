## Context

三个生产 bug 在代码层面已修复，但暴露了测试体系的系统性问题：

1. **session_id 丢失**：`scheduler.test.ts` 断言 `retryEntry?.session_id` 为 `null`，验证了 bug 行为而非正确行为。同时 `structured-scheduler/spec.md` 自相矛盾——line 21 说"传 null session ID"，line 141 说"传播 session ID"。
2. **token 累加膨胀**：`worker.test.ts` 断言多个 `step_finish` 的 token 被累加（100+50=150），但 opencode 实际报的是累积值（150=150）。`opencode-worker/spec.md` line 85 也错误描述为"累加所有 step 的 token 之和"。
3. **removeWorkspace ENOENT**：`terminateRunning` 未传 `entry.session_id`，但 `removeWorkspace` 的单元测试在隔离环境通过 sidecar fallback 工作正常，没有覆盖调用方。

根因模式：测试用合成数据匹配实现行为，spec 描述跟着实现走而非正确行为走。

## Goals / Non-Goals

**Goals:**
- 消除 `structured-scheduler` 和 `opencode-worker` spec 中的矛盾描述
- 审查所有测试文件，将"匹配实现"的断言改为"验证正确行为"的断言
- 新增集成测试覆盖完整调用链（onWorkerExit → scheduleRetry → onRetry → dispatch）
- 新增测试用真实数据模式（累积 token、session_id 传播）
- 修复测试文件中的 pre-existing 类型错误（assignee 缺失等）

**Non-Goals:**
- 不新增功能或修改生产行为（已在本次会话中完成）
- 不引入新的测试框架或依赖
- 不追求 100% 覆盖率——聚焦高信号路径
- 不修复 E2E 测试（需要真实凭证，不在范围内）

## Decisions

### Decision 1: Spec 修正优先于测试修正

先修正 spec 中的矛盾描述，再让测试断言对齐修正后的 spec。这样测试有明确的"正确行为"可参照，而非凭直觉判断。

**替代方案**：先改测试再改 spec——但测试没有 spec 支撑会变成"我说的对"而非"spec 说的对"。

### Decision 2: 集成测试放在 scheduler.test.ts 而非新文件

session_id 全链路传播涉及 `onWorkerExit → scheduleRetry → onRetry → dispatch → runAttempt`，这些都在 scheduler 内部。放在 `scheduler.test.ts` 的 "session ID propagation" describe 块中扩展，而非新建文件。

**替代方案**：新建 `tests/session-propagation.test.ts`——但会分散 session 相关测试，不利于维护。

### Decision 3: extractSessionAndUsage 测试用真实累积模式数据

测试数据模拟真实 opencode 输出：3 个 step_finish，token 递增（100→150→200），验证取最后值（200）而非累加（450）。

### Decision 4: 修复测试文件 pre-existing 类型错误

`worker.test.ts` 和 `scheduler.test.ts` 中多处缺失 `assignee` 字段和 `TrackerConfig.assignee`。虽然 `tsc` 排除 tests 目录不报错，但 LSP 显示这些错误，且 biome 升级后可能开始检查。一并修复。

**替代方案**：保持现状——但 LSP 错误噪音大，且类型不匹配可能掩盖真实类型 bug。

### Decision 5: suppressStderr 测试注入自定义 stderr sink

用 `ConsoleLogger.withFileSink({}, opts, (line) => stderrLines.push(line))` 注入可捕获的 stderr sink，验证 `suppressStderr()` 后 stderrLines 为空。这比原测试（只验证 file 仍写入）更强。

## Risks / Trade-offs

- [Spec 修正可能引入新的矛盾] → 逐行审查修正后的 spec，确保所有 Requirement 和 Scenario 一致
- [测试类型修复可能引入行为变化] → 只补字段不改逻辑，assignee 统一为 null
- [集成测试可能因时序敏感而 flaky] → 使用 fake timers 和 mock tracker，不依赖真实 I/O
