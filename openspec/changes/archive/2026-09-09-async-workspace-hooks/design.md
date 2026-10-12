# C4 async-workspace-hooks 设计

## Context

调用链:`runAttempt` →(createWorkspace → after_create hook / before_run hook / after_run hook)与 scheduler →(terminateRunning → removeWorkspace → before_remove hook + deleteSession)。`runHook`/`deleteSession` 用 `execFileSync` 同步执行,阻塞事件循环最长 `hooks.timeout_ms`(60s)。异步化没有别的路线:hook 结果必须 gate 流程(after_create 失败中止创建、before_run 失败中止 attempt),而它们被同步包在 `createWorkspace`/`removeWorkspace` 内部,所以这两个函数必须随之 async。

## Goals / Non-Goals

**Goals:**
- daemon 事件循环在 hook/session 清理执行期间保持运转(其他 worker、bridge、dashboard、timers 不冻结)。
- 全部既有语义不变:超时上限与触发(SIGTERM 于 timeout_ms)、失败分类(`hook_failed`/ETIMEDOUT 判定)、before/after 各自的失败处置、FS 安全不变式。

**Non-Goals:**
- 不改 hook 超时的击杀范围(仍只杀 bash,孙进程孤儿问题记入 ADR 0020 future work)。
- 不改 hook 配置面、错误类别、日志字段。

## Decisions

**D1 `execFile` promisified + 类型化超时判定**:`node:child_process` 的 `execFile` 自带 `timeout` 选项(到点 SIGTERM),async 回调错误对象带 `killed`/`signal`/`code`——超时判定从现行 `"code" in e && code === "ETIMEDOUT"` 改为 `err.killed && err.signal === "SIGTERM"`(或保留 code 判定双保险),`HookResult.timeout` 语义不变。

**D2 波及面与顺序保证**:
- `scheduler.terminateRunning` 变 async;`reconcileTrackerStates`/`reconcileStalledRuns`/`onRetry`/`startupTerminalCleanup` 调用处顺序 `await`——"先终止(含清理)再 scheduleRetry"的次序不变。
- `runAttempt` 的 `finally { runHook(after_run) }` → `await`,失败仍仅记录。
- `reconcileStalledRuns` 由同步循环改为 for-await 循环(每 tick 逐个处理,次序不变;数量 ≤ max_concurrent_agents,无并发放大)。

**D3 测试改造是机械的**:`tests/workspace.test.ts` 全量 `await`;fake timer 不涉及(hook 子进程用真 sleep 脚本,与现状同)。

## Risks / Trade-offs

- [异步化引入漏 await] → TypeScript 严格模式:返回 Promise 的函数不 await 时浮点值/布尔被误用会类型报错;`npm run typecheck` 为门禁。
- [异步后 hook 与 removeWorkspace 竞态(同 task 重入)] → 现状同样存在(removeWorkspace 本就可能在 reconcile 与 onRetry 两路被调);本 change 不改变竞态面,只改执行模型。
