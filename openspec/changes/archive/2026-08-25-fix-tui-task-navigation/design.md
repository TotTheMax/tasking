## Context

TUI（`src/observability/terminal-dashboard.ts`，手写 ANSI，无框架）overview 模式用 `selectedIndex`（整数下标）标记当前选中行，`formatOverview` 在 `i === this.selectedIndex` 处画游标（spinner）。选中、移动、进入详情全部经 `getFocusedItems()`（`lastSnapshot.running`/`retrying` 按位置映射 `{id}`）+ `selectedIndex` 完成。

数据流：进程内 `tasking start --tui` 直读 `scheduler.state`（sync render）；远端 `tasking tui` 1Hz 轮询 `/api/v1/state`（async render，`fetchSnapshot`）。`state.running` 是 `Map<taskId, RunningEntry>`，插入序即显示序。multiturn 续跑路径（`scheduler.ts` `onWorkerExit` → `scheduleRetry(continuation)` → `onRetry` → `dispatch`）会 `running.delete(id)` 再 `running.set(id, ...)`，把续跑任务**追加到 Map 末尾**——列表在两次渲染之间重排，`selectedIndex` 不动，游标就静默指向另一任务。

活动视图（`activity` 模式）在远端模式下把 `fetchActivity(detailId)` 结果缓存进 `lastActivityEvents`；该字段不与 `detailId` 绑定，切换任务后旧任务事件会在新数据到达前（或拉取失败时）被渲染，表现为"activity 内容是上一个任务(TAS-19)的"。

详情页（`formatRunningDetail*`）对 `last_message` 与 `task.description` 各长行原样输出，超出盒宽（footer 51 列，`│  ` 前缀内容区 48 列）后终端自动换行破坏盒边框，下半部分视觉错乱（TAS-21 补充描述的现象）。

## Goals / Non-Goals

**Goals:**
- overview 选中在列表重排/增删时**跟随所选任务**（按稳定 id），回车/详情/活动始终对应同一任务。
- 活动视图永不显示其他任务的事件。
- 详情页长行按盒宽折行，内容不截断、盒边框不破。
- 零回归：既有键绑定、模式流转、进程内/远端两种数据源行为不变。

**Non-Goals:**
- 不改 scheduler/worker 语义、不改列表排序策略本身（重排来自既有 multiturn 续跑，属正常运行）。
- 不做终端宽度探测/自适应（盒宽固定，与现有 footer 一致）。
- 不改 activity 拉取频率或数据模型。

## Decisions

1. **选中按稳定 id 跟踪（`selectedId`）**：新增字段记录当前选中任务的 id。`indexOfSelected(items)` 优先在 `items` 中按 `selectedId` 定位；找不到（任务离开列表）则回退到 `selectedIndex`（夹取到合法范围）。`moveSelection` 从 `indexOfSelected` 出发移动并写回 `selectedIndex`+`selectedId`；`enterDetail` 用 `indexOfSelected` 取条目；`renderSnapshot` 在 overview 对账：每帧把 `selectedIndex` 对齐到 `selectedId` 所在位置（并刷新 `selectedId`），从而列表重排时游标跟人走。`toggleFocus` 切换 running/backoff 时重置 `selectedId`。备选（渲染后按标识符字符串匹配）——否决：需额外字段且与现有 `selectedIndex` 并存冗余；id 直存最简。
2. **活动事件按源任务隔离（`lastActivityForId`）**：`getActivityEntries` 在远端模式仅当 `lastActivityForId === detailId` 时返回 `lastActivityEvents`，否则返回空。`renderAsync` 拉取成功后把 `lastActivityForId` 置为本次 `detailId`。这样切换任务到新数据到达前显示"无活动事件"占位而非旧任务事件。备选（进入活动时主动清空）——等价且更早清；但清空+异步拉取会造成闪空，保留 `lastActivityForId` 门控即可同时覆盖拉取失败场景（失败时也不回退到旧任务数据）。
3. **详情页长行折行（`wrapText`）**：新增助手按固定宽度把文本折成多行（逐行 `split("\n")`，超宽行按宽度切片），内容零丢失。`last_message` 折行宽 34（`│  Last message: ` 前缀 17 列，盒宽 51 余 34）；`description` 每行折行宽 48（`│  ` 前缀 3 列，51-3=48）。两处 `formatRunningDetail*` 复用。备选截断加 `…`——否决：违背"详情全量显示描述"既有 spec；折行保留全部内容。

## Risks / Trade-offs

- [选中回退到下标夹取] → 仅当所选任务离开当前列表时发生（任务完成/转 retry/切 focus），属预期行为；回退后 `selectedId` 更新为新条目，后续移动基于新 id。
- [折行宽度为常数] → 与现有固定盒宽一致；若终端更窄，`│  ` 前缀仍保证换行可读（不再依赖终端自动换行打断边框）。
- [`lastActivityForId` 门控导致拉取间隙显示空] → 间隙仅一帧（下一次 async render 完成即填充），且永不显示错误归属的数据，正确性优先于瞬时填充。

## Migration Plan

纯渲染层增量：`npm run build` 产出新 CLI；TUI 重启即生效。无 config/storage 迁移、无新依赖。回滚 = revert 分支。