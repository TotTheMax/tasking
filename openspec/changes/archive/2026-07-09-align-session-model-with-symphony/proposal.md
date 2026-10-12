## Why

`add-session-based-multiturn` 变更将 continuation retry 设计为续接同一 opencode session。但讨论后发现:这使 continuation retry 与设置更大的 `max_turns` 功能上等价(同一 session、同一上下文),continuation retry 机制失去存在意义。Symphony 的原始设计是:worker 内续接同一 thread,worker 退出后 continuation retry 开全新 thread(agent 从文件系统重新评估进度)。这种模式更合理——强制 agent 定期从 `git log`/文件系统这一 ground truth 重新定位,避免对话历史膨胀和错误沿袭。本变将对齐 Symphony 模式。

## What Changes

- **BREAKING**: continuation retry SHALL NOT 传入 session ID;每次 continuation retry 创建全新 opencode session
- continuation retry 的 turn 1 SHALL 使用完整渲染的任务 prompt(新 session 无上下文,需重新告知任务)
- worker 内 turn 2+ 仍 SHALL 使用 `-s <sessionID>` 续接同一 session(此行为不变)
- `RetryEntry.session_id` 字段语义变更:仅用于 terminal 清理时定位 last session,NOT 用于 continuation 续接
- session 清理 SHALL 通过 workspace sidecar 文件(`.tasking-session.json`)记录 last session ID,`removeWorkspace` 读取该文件执行 `opencode session delete`
- `scheduleRetry` 的 continuation 路径 SHALL 传 null session ID 给 `dispatch`/`runAttempt`
- `onRetry` 的 terminal 清理路径 SHALL 从 sidecar 文件读取 session ID(而非从 `RetryEntry`)
- `buildContinuationGuidance` SHALL 恢复为包含 `git log` 检查指引(新 session agent 需从文件系统推断进度)

## Capabilities

### New Capabilities

(无)

### Modified Capabilities

- `opencode-worker`: continuation retry 创建新 session;turn 1 用全量 prompt;session 清理改为 sidecar 文件驱动;续轮指引恢复文件系统检查指引
- `workspace-management`: 新增 workspace sidecar 文件(`.tasking-session.json`)写入与读取;`removeWorkspace` 从 sidecar 获取 session ID 执行清理
- `structured-scheduler`: continuation retry 不传播 session ID;`RetryEntry.session_id` 仅用于清理;`onRetry` terminal 清理从 sidecar 读取;`onRetry` 入口释放 claim 修复

## Impact

- `src/worker/runner.ts` — `runAttempt` 写 sidecar 文件;turn 1 prompt 逻辑改回 `turn === 1` 时全量;continuation retry 不再从 `opts.sessionId` 启动
- `src/worker/prompt.ts` — `buildContinuationGuidance` 恢复文件系统检查指引
- `src/shared/types.ts` — `RetryEntry.session_id` 保留(用于清理);`RunAttemptOptions.sessionId` 保留(但 continuation 不再使用)
- `src/scheduler/scheduler.ts` — `onWorkerExit` continuation 传 null;`onRetry` 清理从 sidecar 读取;`onRetry` 入口释放 claim(已修复)
- `src/workspace/manager.ts` — `removeWorkspace` 从 sidecar 文件读取 session ID;新增 sidecar 读写辅助函数
- `tests/` — 更新测试覆盖新行为
- `docs/architecture.md` — 更新 session 模型描述
