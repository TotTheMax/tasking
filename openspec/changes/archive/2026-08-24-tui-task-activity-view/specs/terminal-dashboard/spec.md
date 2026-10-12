## ADDED Requirements

### Requirement: 任务详情视图显示 model 与活动入口

`detail-running` 模式 SHALL 显示当前 turn 解析的 `Agent` / `Model` / `Variant`（来自 `RunningEntry`，进程内直读；远端经 `RuntimeSnapshot` running 行）。`detail-running` footer SHALL 提示 `a` 进入活动视图（在原 `Esc/q back` 旁）。`detail-running` SHALL 支持 `a` 键进入 `activity` 模式。

#### Scenario: 详情页显示 model 行

- **WHEN** 进入 `detail-running` 且当前 turn 解析得 model/agent/variant
- **THEN** 详情页渲染 `Agent` / `Model` / `Variant` 行

#### Scenario: 详情页提示 a 键

- **WHEN** 进入 `detail-running`
- **THEN** footer 显示 `Esc/q back · a 活动`（或等价提示）

#### Scenario: a 键进入活动视图

- **WHEN** 在 `detail-running` 按 `a`
- **THEN** 模式切换为 `activity`，渲染活动事件

### Requirement: 模式键绑定

`processKey` SHALL 在 `activity` 模式下处理 `j/k`/`↑`/`↓`/`PgUp`/`PgDn` 滚动与 `Esc/q` 返回 `detail-running`。`activity` 模式 SHALL 不影响 `overview`/`logs`/`config` 既存键绑定。

#### Scenario: activity 模式 j/k 滚动

- **WHEN** 在 `activity` 模式按 `j` 或 `↓`
- **THEN** 事件列表向下滚动

#### Scenario: activity 模式 Esc 返回

- **WHEN** 在 `activity` 模式按 `Esc` 或 `q`
- **THEN** 返回 `detail-running`

#### Scenario: overview 键不受影响

- **WHEN** 在 `overview` 按 `j`/`Enter`/`L`/`c`
- **THEN** 行为与引入 activity 模式前完全一致（零回归）
