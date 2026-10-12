## MODIFIED Requirements

### Requirement: 模式键绑定

`processKey` SHALL 在 `logs` 与 `activity` 模式下处理 `Space`/`f` 作为暂停/恢复跟随的开关；两种模式 SHALL 表现一致：暂停时视口 SHALL 冻结在当前可见的条目窗口上（锚定视口顶行条目的身份），此后新到达的日志/事件 SHALL NOT 顶走画面上的旧条目，直到用户滚动或再次按 `Space`/`f` 恢复跟随；恢复跟随 SHALL 清除锚点并回到最新条目。`activity` 模式下 `j/k`/`↑`/`↓` SHALL 移动事件选中光标（光标移动退出跟随并锚定视口保证选中行可见），`Enter` 打开选中事件的全文浮层（`activity-detail`），`Esc/q` 返回 `detail-running`。`activity-detail` 模式下 `j/k`/`↑`/`↓` 滚动全文、`Esc/q` 返回 `activity`。`activity`/`activity-detail` 模式 SHALL NOT 影响 `overview`/`logs`/`config` 既存键绑定。

#### Scenario: logs 模式 Space/f 暂停冻结视口

- **WHEN** 在 `logs` 模式跟随最新日志时按 `Space` 或 `f`
- **THEN** 标签显示 `[paused]`，且此后新日志到达时画面保持静止——新行不出现、不把旧行顶走

#### Scenario: activity 模式 Space/f 暂停冻结视口

- **WHEN** 在 `activity` 模式跟随最新事件时按 `Space` 或 `f`
- **THEN** 标签显示 `[paused]`，且此后新事件到达时画面保持静止——新行不出现、不把旧行顶走

#### Scenario: 暂停期间缓冲滑动不漂移

- **WHEN** 暂停时缓冲内已有超过 200 条日志（渲染窗口 `recent(200)` 持续滑动）且新日志持续到达
- **THEN** 画面仍锚定在暂停时可见的条目上不漂移；若锚定条目已滚出可用窗口，则停在仍可见的最旧条目处而非跳回最新

#### Scenario: 再次 Space/f 恢复跟随

- **WHEN** 暂停中再次按 `Space` 或 `f`
- **THEN** 清除锚点、回到跟随最新，视口显示最新到达的条目

#### Scenario: 暂停后手动滚动

- **WHEN** `logs`/`activity` 处于暂停且用户按 `j/k`/`↑`/`↓` 手动滚动
- **THEN** 视口从锚点位置上下移动，不因新条目到达而自动跳回最新

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

## ADDED Requirements

### Requirement: overview 页脚帮助文案准确

overview 页脚 SHALL 只提示在 overview 模式有实际作用的按键；SHALL NOT 宣称 `Space pause`（空格在 overview 模式无任何绑定动作）。`Space/f pause` 提示 SHALL 仅出现在确实支持暂停的 Log view 与 Activity view 页脚。

#### Scenario: overview 页脚不含 Space pause

- **WHEN** overview 渲染页脚
- **THEN** 页脚不出现 `Space pause` 或等价声称空格可暂停的文案

#### Scenario: Log/Activity 页脚保留 Space/f pause

- **WHEN** `logs` 或 `activity` 模式渲染页脚
- **THEN** 页脚继续提示 `Space/f pause`
