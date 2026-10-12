# cli-runtime

## MODIFIED Requirements

### Requirement: 派发预校验

启动校验 SHALL 按任务源分流。`tracker.kind` 为 `jira`（或缺省）时维持现状：`kind` 必须为 `jira`、`api_key` 必填、`project_key`/`project_slug` 二选一。`tracker.kind: none` 时 SHALL 跳过全部 Jira 必填项，转而执行 trackerless 校验：飞书启用时 `app_id`/`app_secret`/`intake_chat_id` 必填（不变），`create_issue_type` 不再必填（该字段纯 `/issue` 使用）；并 SHALL 拒绝两种退化组合（无任何任务源 / 飞书开但直连关）。`opencode.command` SHALL NOT 设必填校验（resolver 以 `opencode run` 默认值兜底），原死检查删除。未知 `tracker.kind` 仍 SHALL 报 `unsupported_tracker_kind`。

#### Scenario: jira 源缺凭证仍拒绝
- **WHEN** `tracker.kind: jira` 且缺 `api_key`
- **THEN** 启动失败，报 `missing_tracker_api_key`（现状不变）

#### Scenario: none 源跳过 Jira 必填
- **WHEN** `tracker.kind: none` 且不配置任何 Jira 字段
- **THEN** 启动校验不因 tracker 字段失败

#### Scenario: none 源下 create_issue_type 缺失不报错
- **WHEN** `tracker.kind: none`、feishu 启用、未配置 `feishu.create_issue_type`
- **THEN** 启动校验通过

## ADDED Requirements

### Requirement: start 装配按任务源分流

`tasking start` SHALL 读取 `tracker.kind`：为 `jira`（或缺省）时按现状构造 `JiraTracker` 与 `Scheduler` 并挂载 tick 循环与终端工作区清理；为 `none` 时 SHALL不构造两者，`ActivityStore` SHALL 独立实例化供直连会话与 dashboard/TUI 消费，dashboard 与 TUI 的调度状态使用空快照（零 running/retrying），`requestRefresh` 为 no-op，`startupTerminalCleanup` 不执行。飞书侧（事件通道、桥、直连管理器、绑定 store）的装配与 kind 无关，仅桥的 tracker 依赖为空。运行中 `tracker.kind` 与启动值不同时 SHALL 记 WARN"任务源变更需重启生效"。

#### Scenario: jira 部署装配不变
- **WHEN** 现有 Jira+飞书配置启动
- **THEN** Scheduler 照常构造并轮询（现状零变化）

#### Scenario: none 部署不构造调度器
- **WHEN** `tracker.kind: none` 启动
- **THEN** 进程内不存在 JiraTracker/Scheduler 实例；直连会话与 dashboard 正常工作
