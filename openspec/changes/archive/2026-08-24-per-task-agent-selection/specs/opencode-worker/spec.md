## ADDED Requirements

### Requirement: 每 turn 解析 per-task agent
worker 的 turn 循环 SHALL 在每个 turn 构造 `opencode run` 命令前，调用共享纯函数 `resolveAgent(currentTask, config)` 解析该 turn 的 agent，并 SHALL 将解析结果注入 `buildOpencodeCommand` 的 `--agent` 参数（覆盖 `config.opencode.agent`）。`currentTask` SHALL 为该 turn 最新可见的 Task（turn 1 为派发时的 task，turn 2+ 为 `trackerStateChecker` 刷新后的 Task）。因此运行中切换 agent（由 `/agent <name>` 改 label 触发）SHALL 在下一 turn 边界生效——当前正在运行的 `opencode run` turn 不被中断，turn 结束后循环从刷新的 Task 重新解析 agent。解析产出未知 agent 警告时 SHALL 记录日志但不 SHALL 中止 turn 或 attempt。

#### Scenario: turn 1 用任务 agent 标签
- **WHEN** 派发一个含 `agent:review` 标签的任务且 `opencode.agents` 含 `review`
- **THEN** turn 1 的 `opencode run` 命令含 `--agent Review`

#### Scenario: 运行中切换下一 turn 生效
- **WHEN** 任务 turn 1 用 `agent:build` 运行中，期间 `/agent review` 改了 issue 标签，turn 1 完成后 `trackerStateChecker` 刷新到含 `agent:review` 的 Task
- **THEN** turn 2 的 `opencode run` 命令含 `--agent Review`（当前 turn 未被中断）

#### Scenario: 无标签每 turn 用默认
- **WHEN** 任务无 `agent:` 标签
- **THEN** 每个 turn 的 `opencode run` 命令含 `--agent <opencode.agent>`（与原行为一致）

#### Scenario: 未知 agent 不中止 turn
- **WHEN** 任务标签含 `agent:foo` 且 `opencode.agents` 非空不含 `foo`
- **THEN** 记录未知 agent 警告，该 turn 仍以默认 agent 启动，attempt 不失败
