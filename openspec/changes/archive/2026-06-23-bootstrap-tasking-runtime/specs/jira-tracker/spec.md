## ADDED Requirements

### Requirement: Jira tracker 适配器操作
`jira-tracker` 适配器 SHALL 支持三个操作:`fetch_candidate_issues()`(配置活跃状态下、配置项目内的 issue)、`fetch_issues_by_states(state_names)`(用于启动 terminal 清理)、`fetch_issue_states_by_ids(issue_ids)`(用于活动运行 reconcile)。空的 `fetch_issues_by_states([])` SHALL 不发起 API 调用而返回空。

#### Scenario: 候选拉取使用活跃状态与项目
- **WHEN** 调用 `fetch_candidate_issues()`
- **THEN** 适配器查询配置活跃状态、配置项目范围内的 Jira issue

#### Scenario: 空状态列表为无操作
- **WHEN** 调用 `fetch_issues_by_states([])`
- **THEN** 不发起 Jira API 调用,返回空结果

#### Scenario: 按 id 状态刷新
- **WHEN** 调用 `fetch_issue_states_by_ids(["ID1","ID2"])`
- **THEN** 适配器返回这些 issue id 的当前状态

### Requirement: JQL 候选查询与分页
适配器 SHALL 使用 JQL 按项目(如 `project = <KEY>`)与配置活跃状态过滤候选。候选结果 SHALL 分页,默认页大小 50,网络超时 30000 ms。分页 SHALL 跨页保持顺序。

#### Scenario: JQL 按项目与活跃状态过滤
- **WHEN** 拉取候选
- **THEN** JQL 含项目与活跃状态过滤

#### Scenario: 分页保持顺序
- **WHEN** 候选结果跨多页
- **THEN** 合并结果保持页顺序

### Requirement: 归一化到共享任务模型
适配器 SHALL 将 Jira 负载归一化到共享 `Task` 模型,字段:id、identifier、title、description、priority、state、branch_name、url、labels(修剪并小写化)、blocked_by(blocker 引用列表,含 id/identifier/state)、created_at、updated_at。`priority` SHALL 为整数或 null(非整数变为 null)。时间戳 SHALL 从 ISO-8601 解析。

#### Scenario: labels 归一化
- **WHEN** 某 Jira issue 有 labels `["Bug", " High "]`
- **THEN** 归一化任务 labels 为 `["bug", "high"]`

#### Scenario: 非整数 priority 变为 null
- **WHEN** Jira priority 字段非数值
- **THEN** 归一化任务 `priority` 为 null

#### Scenario: blocker 从链接派生
- **WHEN** 某 Jira issue 有阻塞类型的 issue link
- **THEN** 归一化任务 `blocked_by` 含 blocker 引用

### Requirement: Jira 认证与端点配置
适配器 SHALL 读取 `tracker.endpoint`(默认 Jira Cloud REST base URL)、`tracker.api_key`/`tracker.api_key_env`(或 `$VAR` 间接引用,规范环境变量 `JIRA_API_TOKEN`)、以及 `tracker.project_slug`/`project_key`(派发必需)。认证 SHALL 按配置发送(如 Cloud 的 email + API token Basic auth)。`$` 解析后凭据缺失 SHALL 为校验错误。

#### Scenario: 缺失 api key 校验失败
- **WHEN** `$` 解析后 `tracker.api_key` 缺失
- **THEN** 派发校验失败

#### Scenario: 缺失 project key 校验失败
- **WHEN** `tracker.project_key` 缺失
- **THEN** 派发校验失败

### Requirement: 错误处理契约
适配器 SHALL 将失败映射到归一化错误类别:`unsupported_tracker_kind`、`missing_tracker_api_key`、`missing_tracker_project_slug`、`jira_api_request`(传输)、`jira_api_status`(非 2xx)、针对 Jira 错误负载的等价 `jira_graphql_errors`、以及 `jira_unknown_payload`(畸形)。候选拉取失败 SHALL 使调度器跳过该 tick 派发。状态刷新失败 SHALL 保留 worker 运行。启动 terminal 清理失败 SHALL 记录警告并继续。

#### Scenario: 候选拉取失败跳过 tick
- **WHEN** `fetch_candidate_issues()` 失败
- **THEN** 调度器记录错误并跳过该 tick 派发

#### Scenario: 状态刷新失败保留 worker
- **WHEN** `fetch_issue_states_by_ids()` 失败
- **THEN** 保留运行中 worker,reconcile 下个 tick 重试

#### Scenario: 启动清理失败非致命
- **WHEN** 启动时 terminal 状态拉取失败
- **THEN** 记录警告并继续启动

### Requirement: Tracker 写入边界
编排器 SHALL NOT 提供 first-class tracker 写 API。工单变更(状态转换、评论)SHALL 由 coding agent 使用工作流/运行时环境中的工具完成。服务 SHALL 保持为 scheduler/runner 与 tracker 读取者。

#### Scenario: 编排器无 tracker 写入
- **WHEN** 结构化调度器派发与 reconcile
- **THEN** 编排器不调用任何 Jira 写/变更 API

### Requirement: 活跃与 terminal 状态配置
适配器 SHALL 遵循 `tracker.active_states`(默认 `["To Do", "In Progress"]`)与 `tracker.terminal_states`(默认 `["Done", "Closed", "Cancelled", "Canceled", "Duplicate"]`),归一化后 SHALL 大小写不敏感比较。

#### Scenario: 活跃状态默认
- **WHEN** 省略 `tracker.active_states`
- **THEN** Jira "To Do" 与 "In Progress" 视为活跃

#### Scenario: terminal 状态默认
- **WHEN** 省略 `tracker.terminal_states`
- **THEN** "Done"、"Closed" 等视为 terminal
