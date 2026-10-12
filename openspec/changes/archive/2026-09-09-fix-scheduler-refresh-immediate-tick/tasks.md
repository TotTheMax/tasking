## 1. 行为测试(TDD)

- [x] 1.1 `tests/scheduler.test.ts` 写失败测试:mock tracker 记录 `fetchCandidateIssues` 调用时刻/次数——空闲状态调用 `requestRefresh()` → 无需等 interval,一轮 tick 立即发生。运行确认红
- [x] 1.2 写失败测试:tick 进行中(用一个 pending Promise 挂住 `fetchCandidateIssues`)调用 `requestRefresh()` → 该轮结束后立即补跑一轮。确认红
- [x] 1.3 写失败测试:tick 进行中再触发一次 tick(直接调用)→ 被重入保护跳过,不并发。确认红

## 2. 实现

- [x] 2.1 `src/scheduler/scheduler.ts`:`tick()` 加 `tickInFlight` 守卫 + `finally` 中检查 refresh 标志补跑;`requestRefresh()` 无 in-flight 时自驱动 `void this.tick()`(catch 记日志)。1.1–1.3 转绿
- [x] 2.2 删除 `start()/scheduleTick()/tickTimer` 死机器;`stop()` 保留 abort/retry-timer 清理。全仓 grep 确认生产无调用方;改造 `tests/scheduler.test.ts` 等处对 `scheduler.start()` 的依赖为直呼 `tick()`
- [x] 2.3 `tests/observability.test.ts` 增补:HTTP `/api/v1/refresh` 接真实(非 mock)Scheduler 时 `coalesced` 语义成立(可选,若现有接线测试已覆盖则跳过)

## 3. 门禁

- [x] 3.1 `npm run lint && npm run typecheck && npm test -- tests/scheduler.test.ts tests/observability.test.ts tests/regression.test.ts`
- [x] 3.2 `npm run test:e2e`(scheduler 变更硬门禁);内网可达时 `npm run test:integration`,不可达注明原因
