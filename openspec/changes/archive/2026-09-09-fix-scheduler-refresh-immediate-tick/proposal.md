## Why

`structured-scheduler` spec 要求 `requestRefresh()` 后"立即执行 tick(不等下一个 poll interval)",但实现只置/清 `refreshRequested` 标志,无任何消费者:生产接线里 tick 定时器归 `Daemon` 所有,`Scheduler.start()/scheduleTick()` 是死代码,标志永远等不到提前 tick。`POST /api/v1/refresh` 返回 `{queued:true}` 与事实不符;Feishu 桥在 `/issue`、`/state`、`/agent` 后调用它期望快速派发,实际仍要等最长 30s 周期。考古确认:`2026-07-09-document-symphony-gaps` 的 design/tasks 只写了"设标志 + tick() 检查"(实现照做),其 spec delta 却承诺"立即执行"——同一 change 内三份工件承诺不一致,最弱版本落了地;测试只验证了端点→回调接线。

## What Changes

- `Scheduler.tick()` 增加重入保护:in-flight 时新调用直接跳过;`tick()` 结束时若 refresh 标志又被置位则立即再跑一轮。
- `requestRefresh()` 置标志时,若无 in-flight tick 则立即自驱动执行一次 out-of-band `tick()`。
- 删除 `Scheduler.start()/scheduleTick()/tickTimer` 死机器(生产由 `Daemon` 驱动 tick;`stop()` 保留 abort 逻辑、去掉 timer 部分)。
- `Daemon` 与 `cli/index.ts` 接线不变;HTTP `coalesced` 语义天然成立。

## Capabilities

### New Capabilities

(无)

### Modified Capabilities

- `structured-scheduler`:MODIFIED "refresh 触发" requirement——把"立即执行"落为可测的具体行为(空闲时自驱动立即 tick;tick 进行中的 refresh 在其结束后立即再跑;interval tick 与 out-of-band tick 不重叠),现有 scenario 文字本已要求,此处补齐可测的边界语义。

## Impact

- 代码:`src/scheduler/scheduler.ts`(tick 守卫 + finally 重跑 + requestRefresh 自驱动 + 删死代码)。
- 测试:`tests/scheduler.test.ts`(若依赖 `scheduler.start()` 自驱循环的旧用例,改造为直呼 `tick()`);新增三个行为测试。
- 行为变化:refresh 后不久可能紧跟一次 interval tick(多一次幂等只读 JQL),接受。
- 无文档/配置变更。
