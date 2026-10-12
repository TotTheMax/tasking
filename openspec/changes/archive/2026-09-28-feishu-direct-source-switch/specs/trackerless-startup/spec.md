# trackerless-startup

## ADDED Requirements

### Requirement: tracker.kind none 时的启动校验矩阵

`tracker.kind: none` 表达"无结构化任务源"：daemon 以飞书直连为唯一任务面运行。启动校验按源分流——`kind: none` 时不要求任何 Jira 凭证（`endpoint`/`api_key`/`project_key` 等）；`opencode.command` 永不强制（默认 `opencode run`）；`feishu.create_issue_type` 仅在 `kind: jira` 时必填；`feishu.enabled` 时 `app_id`/`app_secret`/`intake_chat_id` 必填不变。两种退化配置 SHALL 拒绝启动并给出明确错误：① `kind: none` 且 `feishu.enabled: false`（没有任何任务源）；② `kind: none` 且 feishu 启用但 `feishu.direct.enabled: false`（镜像无 Jira 可用、直连被关，无事可做）。

#### Scenario: 直连专用配置启动成功
- **WHEN** WORKFLOW.md 为 `tracker: { kind: none }` + feishu 启用（app_id/app_secret/intake_chat_id 齐备）+ direct 启用
- **THEN** `tasking start` 校验通过，daemon 正常运行

#### Scenario: 退化配置一——无任何任务源
- **WHEN** `tracker.kind: none` 且 `feishu.enabled: false`
- **THEN** 启动失败，错误信息说明没有任何任务源

#### Scenario: 退化配置二——飞书开但直连关
- **WHEN** `tracker.kind: none`、`feishu.enabled: true`、`feishu.direct.enabled: false`
- **THEN** 启动失败，错误信息说明当前组合无事可做

#### Scenario: 旧死检查移除
- **WHEN** 任意配置启动
- **THEN** 不存在 `opencode.command` 必填校验（resolver 以 `opencode run` 兜底）

### Requirement: 缺席即缺席的运行时装配

`kind: none` 时 daemon SHALL NOT 构造 `JiraTracker` 与 `Scheduler`，SHALL NOT 使用任何"空实现 tracker"喂给调度器；`ActivityStore` 独立实例化供直连会话与 dashboard 使用；dashboard/TUI 的运行时状态 SHALL 使用空快照（零 running/retrying）；终端工作区清理不执行。桥（作为飞书入口宿主）照常构造，但其 tracker 依赖为空。

#### Scenario: 启动后零 Jira 请求
- **WHEN** 直连专用部署启动并运行一段时间（含一次 Sweep）
- **THEN** 日志中没有任何 Jira HTTP 请求

#### Scenario: dashboard 空快照
- **WHEN** 直连专用部署访问 `/api/v1/state`
- **THEN** counts 为零 running/retrying，直连会话列表正常展示

### Requirement: 任务源热变更需重启生效

daemon 装配不随配置热重载重建。运行中检测到 `tracker.kind` 与启动值不同 SHALL 打 WARN 提示重启生效；桥内行为以 tracker 在场性为准（装配期决定），因此两个方向的翻转都优雅降级而非崩溃。

#### Scenario: 运行中翻转为 jira 不崩溃
- **WHEN** 直连专用部署运行中把 `tracker.kind` 从 `none` 改为 `jira`（热重载生效）
- **THEN** 记录"需重启生效"WARN；镜像循环不启动（tracker 对象仍缺席），daemon 不崩溃
