# interactive-init

## MODIFIED Requirements

### Requirement: 完成提示

init 完成后 SHALL 按变体打印分级提示：feishu-direct SHALL 打印"配置完成"与可执行首句（`tasking start`，然后在群里发 `/chat <项目名> <消息>`），跳过项目问答时附 path 模式不限制目录的警告行；Jira 变体（minimal/code-mr/grill-openspec）SHALL 列出仍需手动编辑的字段，且该清单 SHALL 跟随状态预填结果——状态自动预填成功时去掉 `active_states`/`terminal_states`/`review_state`（只留 `after_create` 与 MR 变体的 `env.GITLAB_*`）；预填跳过或失败时保留原有四项清单。

#### Scenario: feishu-direct 打印首句命令
- **WHEN** feishu-direct 分支完成 init
- **THEN** 提示含 `tasking start` 与 `/chat` 示例命令

#### Scenario: Jira 状态已预填时提示去掉状态字段
- **WHEN** 接 Jira 且状态映射确认写入成功
- **THEN** 完成提示的手工字段清单不含 `active_states`/`terminal_states`/`review_state`

#### Scenario: 预填未发生时保留四项清单
- **WHEN** 接 Jira 且用户选择保持默认（或映射失败/连接失败）
- **THEN** 完成提示列出 `active_states`、`terminal_states`、`review_state`、`after_create`
