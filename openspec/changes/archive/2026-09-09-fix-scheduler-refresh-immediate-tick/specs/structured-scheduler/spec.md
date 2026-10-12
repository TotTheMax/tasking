## MODIFIED Requirements

### Requirement: refresh 触发
调度器 SHALL 暴露 `requestRefresh()` 方法,设置一个内部 refresh 标志。`tick()` SHALL 在开头检查该标志,若为 true 则立即执行(不等下一个 poll interval)。多次 `requestRefresh()` 调用 SHALL 被合并(coalesced)。`requestRefresh()` 在无进行中 tick 时 SHALL 立即自驱动执行一轮 tick;`tick()` 进行中到达的 refresh SHALL 在该轮结束后立即再执行一轮。tick SHALL 具备重入保护:进行中的 tick 与新触发的 tick SHALL NOT 并发重叠(interval 定时 tick 撞上进行中的 tick 时 SHALL 跳过)。调度器 SHALL NOT 自持轮询定时器(tick 由 Daemon 驱动;refresh 自驱动的 out-of-band tick 除外)。

#### Scenario: refresh 立即触发 tick
- **WHEN** 调用 `requestRefresh()` 且当前无待处理 refresh、无进行中 tick
- **THEN** 下一个 tick 立即执行(不等 poll interval)

#### Scenario: 多次 refresh 合并
- **WHEN** 连续调用 `requestRefresh()` 两次
- **THEN** 仅触发一次额外 tick

#### Scenario: tick 进行中的 refresh 结束后补跑
- **WHEN** 一轮 tick 正在执行,期间调用 `requestRefresh()`
- **THEN** 该轮 tick 结束后立即再执行一轮(标志被消费,不丢失)

#### Scenario: 重入跳过
- **WHEN** interval 定时 tick 在一轮 out-of-band tick 进行中触发
- **THEN** 该 interval tick 被跳过,SHALL NOT 并发执行
