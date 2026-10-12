## 1. manager 层异步化(TDD)

- [x] 1.1 `tests/workspace.test.ts` 写失败测试:运行一个 sleep 2s 的 `before_run` hook 期间,事件循环保持运转(如一个 50ms 的 `setTimeout` 回调在 hook 结束前已执行,用 Promise 标志断言)。确认红
- [x] 1.2 实现:`runHook` 改 `execFile` promisified(`timeout` 选项到点 SIGTERM,`err.killed/signal` 判定 timeout,`HookResult` 形状不变);`createWorkspace`/`removeWorkspace`/`deleteSession` 变 async。1.1 转绿
- [x] 1.3 `tests/workspace.test.ts` 既有用例全量加 await(含超时分类、before_remove 失败继续、after_create 失败中止回滚等),全部保持绿

## 2. 调用点接线

- [x] 2.1 `src/worker/runner.ts`:`runAttempt` 内 createWorkspace/两个 runHook 调用加 await;`finally` 中 after_run 改 await;`tests/worker.test.ts` 保持绿
- [x] 2.2 `src/scheduler/scheduler.ts`:`terminateRunning` 变 async,`reconcileTrackerStates`/`reconcileStalledRuns`(改 for-await)/`onRetry`/`startupTerminalCleanup` 调用处顺序 await;"先终止后 retry"次序不变;`tests/scheduler.test.ts`、`tests/regression.test.ts`、`tests/e2e.test.ts` 保持绿

## 3. 门禁

- [x] 3.1 `npm run lint && npm run typecheck && npm test -- tests/workspace.test.ts tests/worker.test.ts tests/scheduler.test.ts`
- [x] 3.2 `npm run test:e2e`(scheduler/worker 链路硬门禁);内网可达时 `npm run test:integration`,不可达注明原因
