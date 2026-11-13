## ADDED Requirements

### Requirement: 解析模型观测与漂移告警

worker SHALL 记录每个 turn 实际使用的解析模型（driver 返回值）到日志，供事后追溯；turn 进行中首次观察到解析模型时 SHALL 经 `events.onEvent` 发射 `model_resolved` 事件（含模型标识）供调度器刷新条目；`turn_started` 事件与 turn 开始日志中的 model 字段 SHALL 保持配置值语义不变。同一 opencode 会话相邻 turn 的解析模型不一致时 SHALL 记录一条 `warn` 日志（含任务标识、session ID、旧值与新值，形如 `A → B`），连续 turn 模型相同 SHALL 不重复告警。

#### Scenario: turn 的解析模型记入日志

- **WHEN** 一个 turn 以解析模型 `zhipuai-coding-plan/glm-5.3` 完成
- **THEN** 日志中该 turn 的记录含此解析模型

#### Scenario: 首次观察发射 model_resolved

- **WHEN** turn 进行中的轮询首次观察到解析模型
- **THEN** 经 `events.onEvent` 发射 `model_resolved` 事件

#### Scenario: 相邻 turn 模型变化告警一次

- **WHEN** 同一会话 turn N 解析模型为 A、turn N+1 解析模型为 B
- **THEN** 记录一条含 `A → B` 的 warn 日志，且 turn N+2 仍为 B 时不重复告警

#### Scenario: 相邻 turn 模型不变不告警

- **WHEN** 同一会话连续多个 turn 解析模型相同
- **THEN** 不产生漂移告警日志
