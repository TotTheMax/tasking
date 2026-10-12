# activity-text-expand Specification

## Purpose
TBD - created by archiving change fix-tui-token-display-and-activity. Update Purpose after archive.
## Requirements
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

TUI activity 模式 SHALL 支持选中事件（`↑`/`↓`/`j`/`k` 移动选中光标，选中行高亮）并按 `Enter` 打开浮层。对 `text` 事件，浮层 SHALL 显示该事件的完整文本（不受 3 行限制、不截断）。对 `tool_use` 事件，浮层 SHALL 渲染结构化执行详情块：状态与退出码（非零退出码高亮显示）、工具名、参数/命令区（bash 的 `command` 原样显示，其余参数格式化为可读 JSON）、stdout 输出区（按大输出截断规则）、耗时（`durationMs` 格式化为秒/毫秒）；详情字段缺失时 SHALL 隐藏对应行，不显示空占位。浮层 SHALL 支持 `↑`/`↓`/`j`/`k` 滚动查看，按 `Esc`/`q` 返回活动列表。footer SHALL 提示 `Enter expand` 与返回键。

#### Scenario: Enter 打开全文浮层

- **WHEN** 在 activity 模式选中某事件并按 `Enter`
- **THEN** 打开 `activity-detail` 浮层，渲染该事件完整文本（不截断）

#### Scenario: 工具调用浮层显示执行详情

- **WHEN** 选中 tool_use 事件 `{ tool:"bash", title:"false", input:{command:"false"}, output:"", exit:1, durationMs:300 }` 并按 `Enter`
- **THEN** 浮层渲染状态/退出码（exit 1 高亮）、工具名 `bash`、参数区含 `false`、输出区与耗时，可滚动

#### Scenario: 非工具事件浮层保持文本

- **WHEN** 选中 `text` 事件并按 `Enter`
- **THEN** 浮层渲染该事件完整文本，不显示工具详情块

#### Scenario: 浮层滚动查看长文本

- **WHEN** 浮层内容超过视口
- **THEN** `↑`/`↓`/`j`/`k` 可在浮层内滚动，不离开浮层

#### Scenario: Esc/q 返回活动列表

- **WHEN** 在浮层按 `Esc` 或 `q`
- **THEN** 返回 activity 列表，选中位置保留

#### Scenario: footer 提示展开键

- **WHEN** 进入 activity 模式
- **THEN** footer 显示 `Enter` 展开与 `Esc/q back` 提示

#### Scenario: 详情字段缺失隐藏对应行

- **WHEN** tool_use 事件仅有 `{ tool:"read" }`（无详情字段）并按 `Enter`
- **THEN** 浮层仅显示状态/工具名等既有行，无空占位，不报错

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

### Requirement: 工具调用列表摘要行

TUI activity 模式对 `tool_use` 事件的行渲染 SHALL 显示 `🔧 <工具> · <摘要>`，其中摘要优先取 opencode 提供的 `title`（bash→命令、write/read→文件路径）；`title` 缺失时 SHALL 从 `input` 派生（bash 取 `command`、write/read 取 `filePath`）；两者皆缺时回退为仅工具名。摘要 SHALL 按终端宽度截断（CJK 按 2 列），单行显示。当 `exit` 存在且非 0 时，行 SHALL 以 `✗` 标记并以警示色渲染。

#### Scenario: 列表显示工具与命令摘要

- **WHEN** activity 列表含 tool_use 事件 `{ tool:"bash", title:"echo hello", exit:0 }`
- **THEN** 该行渲染为 `🔧 bash · echo hello`，不超过终端宽度

#### Scenario: title 缺失时从参数派生

- **WHEN** tool_use 事件 `{ tool:"write", input:{ filePath:"src/a.ts" }, title:undefined }`
- **THEN** 该行渲染为 `🔧 write · src/a.ts`

#### Scenario: 无摘要时回退工具名

- **WHEN** tool_use 事件仅有 `{ tool:"read" }`，无 `title` 与可派生的 `input`
- **THEN** 该行渲染为 `🔧 read`

#### Scenario: 长摘要截断

- **WHEN** 摘要超过终端显示宽度
- **THEN** 按宽度截断为一行，CJK 字符按 2 列不出现半字

#### Scenario: 失败命令红色标记

- **WHEN** tool_use 事件 `{ tool:"bash", title:"false", exit:127 }`
- **THEN** 该行以警示色渲染且带 `✗` 标记

### Requirement: 大输出截断

工具调用详情浮层的输出区 SHALL 限制展示行数：输出超过 100 行时 SHALL 仅显示末尾 100 行，并在其上方渲染 `… (N more lines)` 标记。当 opencode 自身已截断（`metadata.truncated` 为真）时 SHALL 在输出末尾追加 `… (opencode truncated)` 标记。输出区 SHALL 与浮层其它内容一同支持滚动。

#### Scenario: 超长输出尾部展示并标记

- **WHEN** 某工具输出 150 行且详情浮层打开
- **THEN** 仅显示末尾 100 行，顶部有 `… (50 more lines)` 标记，可滚动查看

#### Scenario: opencode 截断标记

- **WHEN** 事件 `metadata.truncated` 为真
- **THEN** 输出末尾追加 `… (opencode truncated)`

