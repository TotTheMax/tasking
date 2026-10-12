## ADDED Requirements

### Requirement: turn 计数跟踪
调度器 SHALL 在 `RunningEntry` 上维护 `turn_count`(初始为 0),并在收到 worker 发出的 `turn_started` 事件时递增。`turn_count` SHALL 反映当前 worker 生命周期内已启动的 turn 数。快照 SHALL 暴露正确的 `turn_count` 值。

#### Scenario: turn 开始时递增
- **WHEN** runner 在 turn 循环内发出 `turn_started` 事件
- **THEN** scheduler 的 `onEvent` 回调递增 `entry.turn_count`

#### Scenario: 快照反映正确 turn 计数
- **WHEN** 某 worker 已启动 3 个 turn
- **THEN** 快照中该任务的 `turn_count` 为 3

#### Scenario: 新 worker 重置 turn 计数
- **WHEN** 新的 worker attempt 启动(continuation retry 或新 dispatch)
- **THEN** `turn_count` 从 0 开始

### Requirement: refresh 触发
调度器 SHALL 暴露 `requestRefresh()` 方法,设置一个内部 refresh 标志。`tick()` SHALL 在开头检查该标志,若为 true 则立即执行(不等下一个 poll interval)。多次 `requestRefresh()` 调用 SHALL 被合并(coalesced)。

#### Scenario: refresh 立即触发 tick
- **WHEN** 调用 `requestRefresh()` 且当前无待处理 refresh
- **THEN** 下一个 tick 立即执行(不等 poll interval)

#### Scenario: 多次 refresh 合并
- **WHEN** 连续调用 `requestRefresh()` 两次
- **THEN** 仅触发一次额外 tick
