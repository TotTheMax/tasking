## Why

TUI 首页对运行中任务的选中是基于**列表下标**（`selectedIndex`）的。当一个任务在 multiturn 续跑（`scheduleRetry` + 续跑 dispatch）时，它会从 `running` 移除再追加到**末尾**，导致列表重排：`[TAS-19, TAS-20]` 变为 `[TAS-20, TAS-19]`。此时用户的选中随下标**静默漂移**到另一任务——回车查看 TAS-20 详情却进入 TAS-19 的详情/活动页（TAS-21 报告的现象）。此外详情页的 `description` / `last_message` 长行不做折行，超出盒宽后终端换行破坏边框布局，下半部分视觉错乱。

## What Changes

- **选中改按稳定任务标识（task id）跟踪**：新增 `selectedId`，移动/渲染时以任务 id 为准确定游标位置；列表重排、增删时游标**跟随所选任务**而非位置。`moveSelection`/`enterDetail`/`renderSnapshot`（overview 对账）全部改为基于 id。
- **活动事件按当前任务隔离**：远端 TUI 的 `lastActivityEvents` 绑定到其来源 `detailId`（`lastActivityForId`），切换任务后、新数据拉取完成前不渲染旧任务的残留事件。
- **详情页长行折行**：`formatRunningDetailFromState`/`FromSnapshot` 对 `last_message`（宽度 34）与 `description` 每行（宽度 48）按盒宽折行，保留全部内容但保持盒边框完整，消除长行换行导致的视觉错乱。

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `terminal-dashboard`: 新增要求——overview 选中 SHALL 按任务 id 跟踪并在列表重排时跟随任务；活动视图 SHALL 只显示当前任务的事件（远端模式下不残留前一任务数据）；详情页长行（description/last_message）SHALL 按盒宽折行显示且不截断内容。

## Impact

- `src/observability/terminal-dashboard.ts`：新增 `selectedId` / `lastActivityForId` 字段与 `indexOfSelected` / `wrapText` 助手；`moveSelection` / `toggleFocus` / `enterDetail` / `renderSnapshot` / `getActivityEntries` / `renderAsync` / 两处详情格式化逻辑调整。
- `tests/terminal-dashboard.test.ts`：新增"列表重排后选中跟随任务"、"任务移除后选中回退"、"活动视图不残留前一任务事件"、"长描述折行不截断"用例；既有"长描述全量显示"测试改为断言折行后内容完整。
- `openspec/specs/terminal-dashboard/spec.md`：补 delta 要求与场景。
- 不改 config schema、不动 scheduler/worker 语义、不新增依赖；纯 TUI 渲染层修复。