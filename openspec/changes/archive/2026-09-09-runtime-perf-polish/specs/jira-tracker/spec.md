## MODIFIED Requirements

### Requirement: JQL 候选查询与分页
适配器 SHALL 使用 JQL 按项目(如 `project = <KEY>`)与配置活跃状态过滤候选。候选结果 SHALL 分页,默认页大小 50,网络超时 30000 ms。分页 SHALL 跨页保持顺序。候选查询 SHALL 请求枚举字段集(`summary`、`description`、`priority`、`status`、`labels`、`assignee`、`issuelinks`、`created`、`updated`)而非 `*all`,以约束请求负载;归一化输出(Task 模型字段)SHALL 与全字段拉取时一致。

#### Scenario: JQL 按项目与活跃状态过滤
- **WHEN** 拉取候选
- **THEN** JQL 含项目与活跃状态过滤

#### Scenario: 分页保持顺序
- **WHEN** 候选结果跨多页
- **THEN** 合并结果保持页顺序

#### Scenario: 候选查询请求枚举字段集
- **WHEN** 候选查询发起 `/search` 请求
- **THEN** 请求体 `fields` 为上述枚举列表,不含 `*all`;归一化 Task 的 labels/assignee/blocked_by/priority/时间戳与全字段拉取结果一致
