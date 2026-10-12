# C1 fix-scheduler-refresh-immediate-tick 设计

## Context

生产 tick 驱动链:`Daemon.scheduleTick`(固定 `interval_ms` 定时器)→ `onTick` → `scheduler.tick()`。`Scheduler` 自带的 `start()/scheduleTick()/tickTimer` 从未在 `cli/index.ts` 被调用——两套 tick 系统并存正是 refresh 标志接不上消费者的混淆根源。标志现状:`requestRefresh()` 置位并返回是否首次(供 HTTP `coalesced` 字段),`tick()` 开头无条件清零,无人读取、无人提前唤醒。

## Goals / Non-Goals

**Goals:**
- spec 承诺兑现:`requestRefresh()` 后立即执行一轮 poll+reconcile,不等 poll interval。
- 消灭"两套 tick 系统"的混淆:Scheduler 不再拥有无人使用的定时器。

**Non-Goals:**
- 不改 `Daemon` 的定时器机制(不引入 Daemon 侧重置/reset 管道)。
- 不对"refresh tick 后紧跟的 interval tick"去重(幂等只读,多余一次可接受)。
- 不改 HTTP 响应体形状。

## Decisions

**D1 消费者放 Scheduler 内,自驱动 + 重入保护(而非 Daemon 定时器重置)**
- `tick()` 入口同步置 `tickInFlight = true`(finally 清除):重入调用直接 return——interval tick 撞上 out-of-band tick 时跳过,语义安全(刚 poll 过)。
- `requestRefresh()`:置标志;若 `!tickInFlight` → `void this.tick().catch(log)` 立即执行。
- `tick()` 的 `finally`:若标志又为真(poll 期间来了 refresh)→ 立即再跑一轮。
- `tick()` 开头清标志(维持现状):与 finally 重跑组合后,mid-tick refresh 正确触发补跑。
- 备选否决:Daemon 定时器可重置——需在 cli 接线把 HTTP/bridge 的回调改指向 Daemon 或注入 wake 回调,跨组件管道多一截;spec 明文"**调度器** SHALL 暴露 requestRefresh()",行为留在 scheduler 内。

**D2 删除死机器**
- `start()`/`scheduleTick()`/`tickTimer` 移除;`stop()` 保留 running-abort 与 retry-timer 清理,去掉 tickTimer 分支。
- 依赖 `scheduler.start()` 的测试(若有)改为直呼 `await scheduler.tick()`——那些用例测的是 tick 行为而非定时器,改造无损。

**D3 并发语义**:Node 单线程 + `tickInFlight` 同步置位,`requestRefresh()` 的"检查+触发"无竞态窗口;`refreshRequested` 标志与 in-flight 守卫共同实现 coalescing(重复 refresh → 标志已置 → 返回 true,不再触发第二次)。

## Risks / Trade-offs

- [out-of-band tick 与 interval tick 短间隔连打] → 都是幂等只读 poll,最多多一次 JQL;Jira 侧有轮询间隔保护(30s),无配额风险。
- [删除 start() 后某个未知调用方受影响] → 全仓 grep 确认生产仅 Daemon 驱动;测试改造在同 change 内完成。
