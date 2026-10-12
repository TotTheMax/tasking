## Why

当前 tasking 的多轮循环是"失忆续轮"——每个 turn 都启动全新 `opencode run` 进程,agent 没有前序对话上下文,只能从文件系统推断进度。同时 `extractUsage` 因未使用 `--format json` 输出,token 统计始终返回零值。opencode 原生支持 session 机制(`-s <sessionID>` 续接、`--format json` 结构化事件流、`session delete` 清理),这些能力此前未被利用。启用 session 续轮可使 agent 跨 turn 保持完整上下文(含 prompt cache 命中,续轮成本极低),并修复 token 统计。

## What Changes

- **BREAKING**: `opencode run` 调用 SHALL 统一使用 `--format json` 输出模式,以提取 session ID 与 token 用量
- 续轮循环 SHALL 改为 session 续轮:turn 1 创建 session 并提取 session ID;turn 2+ 使用 `-s <sessionID>` 续接同一 session,agent 享有完整对话上下文
- `extractUsage` SHALL 按 opencode JSON 事件 schema(`part.tokens`)重写,正确累加多步骤 token
- `AttemptResult` SHALL 新增 `session_id` 字段,从 turn 1 的 JSON 事件流中提取
- 成功续轮 retry(continuation)SHALL 传入 session ID 以续接;失败 retry 与停滞 retry SHALL 传 null(全新 session)
- `RetryEntry` SHALL 新增 `session_id` 字段,在调度器中传播 session 续接决策
- `RunningEntry.session_id`(字段已存在)SHALL 在 worker 运行期间实时更新,供仪表板展示
- 任务进入 terminal 状态触发工作区清理时,SHALL 先执行 `opencode session delete <sessionID>` 清理对应 session
- 续轮指引 prompt SHALL 精简(agent 已有完整上下文,无需重新描述任务)
- `RunAttemptOptions` SHALL 新增可选 `sessionId` 参数,支持 attempt 级别的 session 续接

## Capabilities

### New Capabilities

(无)

### Modified Capabilities

- `opencode-worker`: 续轮循环改为 session 续接模式;`--format json` 输出解析;token 统计修复;session 生命周期管理(创建/续接/删除);`AttemptResult` 新增 session_id
- `workspace-management`: 工作区清理时联动删除关联 session;`removeWorkspace` 接收并清理 session ID
- `structured-scheduler`: retry/continuation 路径传播 session ID;`RetryEntry` 新增 session_id;`RunningEntry.session_id` 实时更新
- `observability`: session_id 在运行时快照中实际填充;token 统计数据准确

## Impact

- `src/worker/runner.ts` — `buildOpencodeCommand` 加 `--format json` 与可选 `-s`;`extractUsage` 重写为 `extractSessionAndUsage`;`runAttempt` 循环用 session 续接;`AttemptResult` 加字段
- `src/worker/prompt.ts` — `buildContinuationGuidance` 精简
- `src/shared/types.ts` — `AttemptResult`、`RetryEntry` 加 `session_id`;`RunAttemptOptions` 加可选 `sessionId`
- `src/scheduler/scheduler.ts` — `dispatch`/`onWorkerExit`/`scheduleRetry`/`onRetry` 传播 session_id;`RunningEntry.session_id` 更新
- `src/workspace/manager.ts` — `removeWorkspace` 接收 session_id 并执行 `opencode session delete`
- `src/observability/` — 运行时快照填充 session_id
- `tests/` — 新增/更新测试覆盖 session 续接、JSON 解析、token 累加、session 清理
- `docs/architecture.md` — 更新多轮模型描述
- `docs/configuration.md` — 更新 `max_turns` 说明(建议值与 session 续轮行为)
