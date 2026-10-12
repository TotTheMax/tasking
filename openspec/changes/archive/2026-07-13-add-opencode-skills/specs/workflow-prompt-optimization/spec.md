## MODIFIED Requirements

### Requirement: prompt 根据 attempt 区分首次与重试
prompt 模板 SHALL 根据 `attempt` 变量提供不同指令(参考 Symphony §12.3):首次(`attempt` null)给完整任务指令;重试(`attempt` >= 1)给"检查工作区当前状态,继续未完成的工作"指令。重试指令 SHALL 包含技能引用：当存在已创建的 MR 时，SHALL 指示 agent 使用 `land` 技能监控 CI、处理 review 反馈并合并。

#### Scenario: 首次 attempt 给完整指令
- **WHEN** `attempt` 为 null
- **THEN** prompt 包含完整任务说明与 jira_rest 使用指南

#### Scenario: 重试 attempt 给续轮指令
- **WHEN** `attempt` >= 1
- **THEN** prompt 指示检查 git status / 工作区状态,继续未完成的工作

#### Scenario: 重试 attempt 引用 land 技能
- **WHEN** `attempt` >= 1 且 workspace 存在已创建的 MR
- **THEN** prompt 指示 agent 使用 `land` 技能监控 CI 并处理 review 反馈
