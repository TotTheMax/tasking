## ADDED Requirements

### Requirement: 不活跃超时
worker SHALL 对 `opencode run` 子进程实施不活跃超时监控：当 `opencode.inactivity_timeout_ms` > 0 时，SHALL 在子进程启动后启动不活跃计时器，并在每次收到 stdout 或 stderr 数据时重置该计时器。计时器触发时 SHALL 以 SIGTERM 终止子进程并标记为超时。当 `opencode.inactivity_timeout_ms` = 0 时 SHALL 禁用不活跃超时监控。不活跃超时与墙钟超时（`turn_timeout_ms`）独立运行，先触发者先终止子进程。worker SHALL 在不活跃超时触发时将 attempt 错误分类为 `inactivity_timeout`。

#### Scenario: 持续输出时不触发不活跃超时
- **WHEN** `opencode.inactivity_timeout_ms` 为 600000（10min）且子进程持续在 10 分钟内产出 stdout 或 stderr 数据
- **THEN** 不活跃计时器被持续重置，不触发超时

#### Scenario: 静默后触发不活跃超时
- **WHEN** `opencode.inactivity_timeout_ms` 为 600000（10min）且子进程超过 10 分钟未产出任何 stdout/stderr 数据
- **THEN** 不活跃计时器触发，子进程被 SIGTERM 终止，attempt 错误分类为 `inactivity_timeout`

#### Scenario: 禁用不活跃超时
- **WHEN** `opencode.inactivity_timeout_ms` 为 0
- **THEN** 不启动不活跃计时器，仅依赖墙钟超时和 stall 检测

#### Scenario: 不活跃超时与墙钟超时独立
- **WHEN** 不活跃超时设为 10min、墙钟超时设为 1h，且子进程在 10 分钟内持续输出
- **THEN** 不活跃计时器不触发，子进程可存活至墙钟超时（1h）

#### Scenario: 不活跃超时先于墙钟触发
- **WHEN** 不活跃超时设为 10min、墙钟超时设为 1h，且子进程在启动后立即静默
- **THEN** 不活跃计时器在 10min 时先触发，墙钟计时器被清理

## MODIFIED Requirements

### Requirement: Attempt 生命周期与失败分类
每次 attempt SHALL 经历阶段:准备工作区、构建 prompt、启动 agent、完成、以及 succeeded/failed/timed_out/stalled/canceled_by_reconciliation 之一。turn 墙钟超时(`opencode.turn_timeout_ms`)SHALL 使 attempt 失败并分类为 `turn_timeout`。不活跃超时(`opencode.inactivity_timeout_ms`)SHALL 使 attempt 失败并分类为 `inactivity_timeout`。子进程异常退出 SHALL 使 attempt 失败。调度器 SHALL 将 worker 结果转换为显式状态转换。attempt 结果 SHALL 包含从 JSON 事件流提取的 session ID(若可用)。

#### Scenario: 墙钟超时使 attempt 失败
- **WHEN** 一次 `opencode run` 调用总时长超过 `opencode.turn_timeout_ms`
- **THEN** attempt 被分类为 timed_out 并失败，错误标注为 `turn_timeout`

#### Scenario: 不活跃超时使 attempt 失败
- **WHEN** 一次 `opencode run` 调用在 `opencode.inactivity_timeout_ms` 时间内无 stdout/stderr 输出
- **THEN** attempt 被分类为 timed_out 并失败，错误标注为 `inactivity_timeout`

#### Scenario: 异常退出使 attempt 失败
- **WHEN** `opencode run` 子进程异常退出
- **THEN** attempt 被分类为失败

#### Scenario: 结果携带 session ID
- **WHEN** attempt 完成
- **THEN** 结果包含从 JSON 事件流提取的 session ID(若可用)

### Requirement: 错误分类
worker SHALL 将 attempt 失败分类为以下类别之一:`invalid_workspace_cwd`、`spawn_failed`、`turn_timeout`、`inactivity_timeout`、`agent_exit_error`、`stalled`。每个类别 SHALL 在 `AttemptResult` 的 `error` 字段中标注。调度器 SHALL 使用错误类别决定 retry 行为。

#### Scenario: 墙钟超时分类
- **WHEN** opencode run 子进程总时长超过 `turn_timeout_ms`
- **THEN** attempt 错误分类为 `turn_timeout`

#### Scenario: 不活跃超时分类
- **WHEN** opencode run 子进程在 `inactivity_timeout_ms` 时间内无输出
- **THEN** attempt 错误分类为 `inactivity_timeout`

#### Scenario: spawn 失败分类
- **WHEN** `opencode run` 命令无法启动
- **THEN** attempt 错误分类为 `spawn_failed`

#### Scenario: 异常退出分类
- **WHEN** `opencode run` 子进程以非零退出码退出
- **THEN** attempt 错误分类为 `agent_exit_error`
