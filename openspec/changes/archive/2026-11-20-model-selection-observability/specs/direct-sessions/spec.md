## ADDED Requirements

### Requirement: direct 路径解析模型观测与漂移告警

direct 会话路径 SHALL 记录每个 turn 实际使用的解析模型（driver 返回值）到日志，供事后追溯；同一 opencode 会话相邻 turn 的解析模型不一致时 SHALL 记录一条 `warn` 日志（含 root_id、session ID、旧值与新值，形如 `A → B`），连续 turn 模型相同 SHALL 不重复告警。

#### Scenario: turn 的解析模型记入日志

- **WHEN** 一个 direct turn 以解析模型 `zhipuai-coding-plan/glm-5.3` 完成
- **THEN** 日志中该 turn 的记录含此解析模型

#### Scenario: 相邻 turn 模型变化告警一次

- **WHEN** 同一 direct 会话 turn N 解析模型为 A、turn N+1 解析模型为 B
- **THEN** 记录一条含 `A → B` 的 warn 日志，且后续 turn 仍为 B 时不重复告警
