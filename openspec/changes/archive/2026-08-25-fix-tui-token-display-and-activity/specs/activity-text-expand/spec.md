## ADDED Requirements

### Requirement: 活动事件文本按终端宽度感知换行

TUI activity 模式 SHALL 将事件文本按显示宽度换行渲染，正确处理东亚宽字符（CJK 字符占 2 个终端列宽），而非常规的字符数截断。多行文本（含 `\n`）SHALL 先按行拆分再逐行换行。每条事件在列表中最多显示 3 行，超出部分以 `…` 标记截断。

#### Scenario: 中文长文本不溢出终端宽度

- **WHEN** 活动事件文本含 80 个汉字
- **THEN** 该事件按显示宽度换行为多行渲染，任意行不超出终端列宽（CJK 每字符按 2 列计），且不出现半字被截断

#### Scenario: 多行文本逐行渲染

- **WHEN** 事件文本含换行符
- **THEN** 每个换行对应一个渲染行，再按宽度换行

#### Scenario: 超过 3 行显示省略

- **WHEN** 事件文本换行后超过 3 行
- **THEN** 列表仅显示前 3 行，最后一行以 `…` 结尾

### Requirement: 全文浮层

TUI activity 模式 SHALL 支持选中事件（`↑`/`↓`/`j`/`k` 移动选中光标，选中行高亮）并按 `Enter` 打开全文浮层。浮层 SHALL 显示该事件的完整文本（不受 3 行限制、不截断），支持 `↑`/`↓`/`j`/`k` 滚动查看，按 `Esc`/`q` 返回活动列表。footer SHALL 提示 `Enter expand` 与返回键。

#### Scenario: Enter 打开全文浮层

- **WHEN** 在 activity 模式选中某事件并按 `Enter`
- **THEN** 打开 `activity-detail` 浮层，渲染该事件完整文本（不截断）

#### Scenario: 浮层滚动查看长文本

- **WHEN** 全文超过浮层视口
- **THEN** `↑`/`↓`/`j`/`k` 可在浮层内滚动，不离开浮层

#### Scenario: Esc/q 返回活动列表

- **WHEN** 在全文浮层按 `Esc` 或 `q`
- **THEN** 返回 activity 列表，选中位置保留

#### Scenario: footer 提示展开键

- **WHEN** 进入 activity 模式
- **THEN** footer 显示 `Enter` 展开与 `Esc/q back` 提示

### Requirement: 活动选中与跟随

activity 列表 SHALL 维护一个选中光标。跟随（follow）模式下光标跟随最新事件；按 `↑`/`↓` 移动光标 SHALL 退出跟随并锚定视口使选中事件可见。滚动信息（`[start/total]`）与暂停标记 SHALL 继续显示。

#### Scenario: 上下移动选中并退出跟随

- **WHEN** 在跟随状态下按 `↑`
- **THEN** 退出跟随，光标上移一行，视口锚定保证选中行可见

#### Scenario: 选中事件保持可见

- **WHEN** 连续按 `↓` 移动光标到视口底部
- **THEN** 视口随光标滚动，选中行始终可见

#### Scenario: 恢复跟随

- **WHEN** 在非跟随状态按 `Space` 或 `f`
- **THEN** 恢复跟随，光标回到最新事件