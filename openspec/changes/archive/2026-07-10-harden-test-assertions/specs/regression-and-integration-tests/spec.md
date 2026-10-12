## ADDED Requirements

### Requirement: session ID 全链路传播集成测试
测试 SHALL 覆盖 session ID 从 `onWorkerExit` 经 `scheduleRetry` 到 `RetryEntry.session_id` 再经 `onRetry` 到 `dispatch` 再到 `runAttempt` 的完整传播链路。测试 SHALL 验证 continuation retry 传播非 null session ID，failure retry 传播 null session ID。测试 SHALL 使用 fake timers 控制 retry 时序，SHALL 使用 mock tracker 避免真实 I/O。

#### Scenario: continuation retry 全链路传播 session ID
- **WHEN** worker 正常退出返回 session_id="ses_abc"，continuation retry 触发并派发
- **THEN** `runAttempt` 收到的 `sessionId` 参数为 "ses_abc"（非 null）

#### Scenario: failure retry 全链路传播 null session ID
- **WHEN** worker 异常退出返回 session_id="ses_xyz"，failure retry 触发并派发
- **THEN** `runAttempt` 收到的 `sessionId` 参数为 null

### Requirement: extractSessionAndUsage 累积 token 提取测试
测试 SHALL 覆盖 `extractSessionAndUsage` 对多个 `step_finish` 事件取最后一个累积值（非累加）的行为。测试 SHALL 使用模拟真实 opencode 输出的数据：多个 step 的 token 递增（如 100→150→200），验证取最后值（200）而非累加（450）。

#### Scenario: 多个 step_finish 取最后累积值
- **WHEN** stdout 含 3 个 step_finish，token 递增（input: 100→150→200, total: 110→165→220）
- **THEN** 提取结果为 input=200, total=220（最后值），非 input=450, total=495（累加）

#### Scenario: 单个 step_finish
- **WHEN** stdout 只含 1 个 step_finish
- **THEN** 提取结果为该 step 的 token 值

### Requirement: removeWorkspace 传入 session_id 集成测试
测试 SHALL 覆盖 `terminateRunning` 调用 `removeWorkspace` 时传入 `entry.session_id`（而非依赖 sidecar 文件 fallback）。测试 SHALL 验证传入的 session_id 被用于 `deleteSession` 调用。

#### Scenario: terminateRunning 传入 session_id
- **WHEN** `terminateRunning` 清理工作区且 `entry.session_id` 非空
- **THEN** `removeWorkspace` 使用传入的 session_id 执行 `opencode session delete`

#### Scenario: entry.session_id 为 null 时回退到 sidecar
- **WHEN** `terminateRunning` 清理工作区且 `entry.session_id` 为 null
- **THEN** `removeWorkspace` 从 sidecar 文件读取 session_id

### Requirement: suppressStderr 实际抑制验证
测试 SHALL 验证 `ConsoleLogger.suppressStderr()` 后 stderr sink 不再收到输出（而非仅验证 file sink 仍写入）。测试 SHALL 注入可捕获的 stderr sink，验证抑制后 stderrLines 为空。测试 SHALL 验证 child logger 继承 stderr 抑制。

#### Scenario: suppressStderr 后 stderr 无输出
- **WHEN** `ConsoleLogger.withFileSink` 创建 logger 并调用 `suppressStderr()`，然后 `logger.info("msg")`
- **THEN** stderr sink 收到 0 行，file sink 仍包含 "msg"

#### Scenario: child logger 继承 stderr 抑制
- **WHEN** parent logger 已 `suppressStderr()`，child logger `child.info("msg")`
- **THEN** stderr sink 收到 0 行，file sink 仍包含 "msg"

### Requirement: 测试文件类型错误修复
测试文件中缺失的类型字段（`Task.assignee`、`TrackerConfig.assignee`、`RetryEntry.session_id`）SHALL 被补全，以消除 LSP 报错并确保测试数据符合当前类型定义。

#### Scenario: Task 对象含 assignee 字段
- **WHEN** 测试构造 `Task` 对象
- **THEN** 包含 `assignee: string | null` 字段

#### Scenario: TrackerConfig 含 assignee 字段
- **WHEN** 测试构造 `TrackerConfig` 对象
- **THEN** 包含 `assignee` 字段

#### Scenario: RetryEntry 含 session_id 字段
- **WHEN** 测试构造 `RetryEntry` 对象
- **THEN** 包含 `session_id: string | null` 字段
