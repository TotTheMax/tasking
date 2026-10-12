# jira-state-autofill

## ADDED Requirements

### Requirement: Jira 状态名映射分桶

Jira 变体的 init 在连接测试取得项目状态列表后 SHALL 按常见中英文名将状态映射到三类桶（比较不区分大小写并去除首尾空白）：active（如 待办 / to do / 处理中 / 进行中 / in progress / 合并中 / merging / 重置处理 / reset）、review（如 代码评审中 / 评审中 / 待评审 / in review / review）、terminal（如 完成 / done / 关闭 / closed / 取消 / cancelled / canceled / 重复 / duplicate / resolved）。未匹配的状态名 SHALL 忽略并在输出中列出。

#### Scenario: 常见名分桶
- **WHEN** 项目状态为「待办、处理中、代码评审中、完成、关闭、重复」
- **THEN** active 桶含 待办/处理中，review 桶含 代码评审中，terminal 桶含 完成/关闭/重复

#### Scenario: 未匹配名列出
- **WHEN** 项目含一个不在映射表内的状态名（如「已评审待发布」）
- **THEN** 输出列出该未匹配名，且不写入任何桶

### Requirement: 确认后预填状态字段

`active` 与 `terminal` 两桶均非空时 init SHALL 打印提议映射并询问确认（回车默认确认 / 可选保持默认）；`review` 桶允许为空，此时 `review_state` 写 `null`。确认后 SHALL 将 active 桶写入 `active_states`、terminal 桶写入 `terminal_states`、review 桶首个匹配名（或 `null`）写入 `review_state`。未匹配的状态名 SHALL 在提议或回落信息中列出。用户选择保持默认、`active`/`terminal` 任一为空、或连接测试失败时 SHALL 回落模板默认值。

#### Scenario: 确认写入
- **WHEN** 三类桶均非空且用户确认
- **THEN** 生成的 WORKFLOW.md `active_states`/`terminal_states`/`review_state` 为映射结果

#### Scenario: 拒绝则回落
- **WHEN** 用户选择保持默认
- **THEN** 生成物保留模板默认状态名，完成提示仍列出需手动编辑的状态字段

#### Scenario: 缺桶回落
- **WHEN** 映射后 terminal 桶为空（如项目状态名全不匹配）
- **THEN** 不写入任何状态字段，回落模板默认，并在输出中列出未匹配名

#### Scenario: review 桶为空仍可预填
- **WHEN** active 与 terminal 两桶非空但 review 桶为空
- **THEN** 仍打印提议并确认，写入 `review_state: null`

#### Scenario: 连接失败不预填
- **WHEN** Jira 连接测试失败
- **THEN** 跳过状态预填，生成物保留模板默认状态名
