## MODIFIED Requirements

### Requirement: 模式键绑定

`processKey` SHALL 在 `activity` 模式下处理 `j/k`/`↑`/`↓` 移动事件选中光标（光标移动退出跟随并锚定视口）、`Space`/`f` 暂停/恢复跟随、`Enter` 打开选中事件的全文浮层（`activity-detail`）、`Esc/q` 返回 `detail-running`。`activity-detail` 模式下 `j/k`/`↑`/`↓` 滚动全文、`Esc/q` 返回 `activity`。`activity`/`activity-detail` 模式 SHALL NOT 影响 `overview`/`logs`/`config` 既存键绑定。

#### Scenario: activity 模式移动光标

- **WHEN** 在 `activity` 模式按 `j` 或 `↓`
- **THEN** 事件选中光标向下移动一行，退出跟随，视口锚定保证选中行可见

#### Scenario: activity 模式 Enter 展开

- **WHEN** 在 `activity` 模式按 `Enter`
- **THEN** 进入 `activity-detail` 浮层显示选中事件全文

#### Scenario: activity-detail 滚动与返回

- **WHEN** 在 `activity-detail` 按 `↑`/`↓` 或 `Esc`
- **THEN** `↑`/`↓` 滚动全文、`Esc`/`q` 返回 `activity` 列表

#### Scenario: activity 模式 Esc 返回

- **WHEN** 在 `activity` 模式按 `Esc` 或 `q`
- **THEN** 返回 `detail-running`

#### Scenario: overview 键不受影响

- **WHEN** 在 `overview` 按 `j`/`Enter`/`L`/`c`
- **THEN** 行为与引入 activity 模式前完全一致（零回归）

### Requirement: 任务详情视图显示 model 与活动入口

`detail-running` 模式 SHALL 显示当前 turn 解析的 `Agent` / `Model` / `Variant`（来自 `RunningEntry`，进程内直读；远端经 `RuntimeSnapshot` running 行）。`detail-running` footer SHALL 提示 `a` 进入活动视图（在原 `Esc/q back` 旁）。`detail-running` SHALL 支持 `a` 键进入 `activity` 模式。

#### Scenario: 详情页显示 model 行

- **WHEN** 进入 `detail-running` 且当前 turn 解析得 model/agent/variant
- **THEN** 详情页渲染 `Agent` / `Model` / `Variant` 行

#### Scenario: 详情页提示 a 键

- **WHEN** 进入 `detail-running`
- **THEN** footer 显示 `Esc/q back · a activity`（或等价提示）

#### Scenario: a 键进入活动视图

- **WHEN** 在 `detail-running` 按 `a`
- **THEN** 模式切换为 `activity`，渲染活动事件

## ADDED Requirements

### Requirement: 活动视图宽度感知渲染与选中高亮

`formatActivity` SHALL 将事件文本按显示宽度换行（CJK 宽字符按 2 列计，见 activity-text-expand spec），每条最多 3 行、超出以 `…` 截断。选中事件行 SHALL 高亮（如加亮光标/颜色标记）。活动头部 SHALL 继续显示 agent/model/variant/turn/tokens（token 为会话累计，含跨重启恢复值）。

#### Scenario: 长文本换行不溢出

- **WHEN** 事件文本含中文且超过终端宽度
- **THEN** 按显示宽度换行渲染，任意渲染行不超出终端列宽

#### Scenario: 选中行高亮

- **WHEN** 在 activity 列表选中某事件
- **THEN** 该事件行以醒目标记（颜色/光标）区别于未选中行

#### Scenario: 头部显示会话累计 token

- **WHEN** 任务从 sidecar 恢复 token 后进入活动视图
- **THEN** 头部 tokens 显示恢复值加本次增量（非 0）