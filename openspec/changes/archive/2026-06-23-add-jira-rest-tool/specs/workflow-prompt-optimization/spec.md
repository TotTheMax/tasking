## ADDED Requirements

### Requirement: WORKFLOW.md prompt 模板包含 jira_rest 使用指南
`WORKFLOW.md.example` 的 prompt body SHALL 包含 `jira_rest` 工具的使用说明,告诉 agent 如何调用 Jira REST API 转状态、添加评论、添加标签。说明 SHALL 包含具体示例(如 `GET /issue/{key}/transitions` 查可用 transitions、`POST /issue/{key}/transitions` 转状态、`POST /issue/{key}/comment` 加评论)。

#### Scenario: prompt 包含 jira_rest 用法
- **WHEN** 查看 `WORKFLOW.md.example` 的 prompt body
- **THEN** 包含 `jira_rest` 工具的使用说明与 API 路径示例

### Requirement: 代码任务走 review 交接态而非直接完成
prompt 模板 SHALL 指示:对于需要提交代码的任务,agent 完成后 SHALL 用 `jira_rest` 转为 review 交接态(由 `tracker.review_state` 配置),SHALL NOT 直接转"完成"。prompt SHALL 指示 agent 添加评论含变更摘要与 PR 链接,SHALL 指示 agent 添加 `needs-review` 标签。人工 review + merge 后由人工转"完成"。

#### Scenario: prompt 指示代码任务走 review
- **WHEN** prompt 模板渲染给代码任务的 agent
- **THEN** 包含"转 review 交接态、加评论、加标签,不直接完成"的指示

### Requirement: 非代码任务直接完成
prompt 模板 SHALL 指示:对于非代码任务(文档、调研、配置等),agent 完成后 SHALL 用 `jira_rest` 直接转"完成"态,SHALL 添加评论含工作摘要与产出说明。

#### Scenario: prompt 指示非代码任务直接完成
- **WHEN** prompt 模板渲染给非代码任务的 agent
- **THEN** 包含"转完成、加评论"的指示

### Requirement: agent 先查 transitions 再转状态
prompt 模板 SHALL 指示 agent 在转状态前先 `GET /issue/{key}/transitions` 查询可用 transitions,再按状态名称选择对应 id 执行转换。SHALL NOT 硬编码 transition id(因不同 Jira 部署的 id 不同)。

#### Scenario: prompt 指示先查 transitions
- **WHEN** prompt 模板包含转状态指示
- **THEN** 指示 agent 先查询可用 transitions 再按名称选 id

### Requirement: agent 在 Jira 中添加跟踪信息
prompt 模板 SHALL 指示 agent 在工作过程中和完成时用 `jira_rest` 在 Jira 任务中添加跟踪信息:
- 完成时:变更摘要评论(改了什么、为什么)
- 如有 PR:评论中附 PR 链接
- 如有 demo/截图:评论中附链接或描述
- 完成时:添加标签(如 `agent-done` 或 `needs-review`)便于团队筛选

#### Scenario: prompt 指示添加评论
- **WHEN** prompt 模板包含完成指示
- **THEN** 指示 agent 用 `jira_rest` 添加含变更摘要的评论

#### Scenario: prompt 指示添加标签
- **WHEN** prompt 模板包含完成指示
- **THEN** 指示 agent 用 `jira_rest` 添加 `needs-review` 或 `agent-done` 标签

### Requirement: prompt 根据 attempt 区分首次与重试
prompt 模板 SHALL 根据 `attempt` 变量提供不同指令(参考 Symphony §12.3):首次(`attempt` null)给完整任务指令;重试(`attempt` >= 1)给"检查工作区当前状态,继续未完成的工作"指令。

#### Scenario: 首次 attempt 给完整指令
- **WHEN** `attempt` 为 null
- **THEN** prompt 包含完整任务说明与 jira_rest 使用指南

#### Scenario: 重试 attempt 给续轮指令
- **WHEN** `attempt` >= 1
- **THEN** prompt 指示检查 git status / 工作区状态,继续未完成的工作
