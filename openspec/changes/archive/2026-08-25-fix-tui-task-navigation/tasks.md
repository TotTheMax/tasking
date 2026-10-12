## 1. overview 选中按任务 id 跟踪（先红后绿）

- [ ] 1.1 写失败测试：running 列表重排（`delete("19")` + 重新 `set("19")` 追加到末尾）后，原先按 `j` 选中的任务仍被游标跟随，回车进入的是原选中任务而非位置上的新任务（`tests/terminal-dashboard.test.ts` 新用例 "keeps selection pinned to task when running list reorders"）
- [ ] 1.2 写失败测试：任务从 running 列表移除后，选中回退到夹取后的位置，`j/k` 从该位置继续（用例 "keeps selection pinned to task when a task is removed from the list"）
- [ ] 1.3 实现：`terminal-dashboard.ts` 新增 `selectedId: string | null` 字段与 `indexOfSelected(items)`（按 `selectedId` 定位，找不到回退 `selectedIndex` 夹取）；`moveSelection`/`enterDetail` 改用 `indexOfSelected` 并写回 `selectedId`；`toggleFocus` 重置 `selectedId`；`renderSnapshot` overview 对账每帧把 `selectedIndex` 对齐到 `selectedId` 位置并刷新 `selectedId`

## 2. 活动事件按源任务隔离（先红后绿）

- [ ] 2.1 写失败测试：远端模式（`fetchActivity` 数据源）先查看任务 1 活动，再切到任务 2 活动，任务 2 事件拉取前不渲染任务 1 的任何事件（用例 "activity view does not show stale events from a previously viewed task"）
- [ ] 2.2 实现：新增 `lastActivityForId: string | null` 字段；`renderAsync` 拉取成功后记录 `lastActivityForId = detailId`；`getActivityEntries` 仅当 `lastActivityForId === detailId` 时返回 `lastActivityEvents`，否则返回空

## 3. 详情页长行折行（先红后绿）

- [ ] 3.1 改测试：既有 "shows full description in running detail without truncation" 改为断言折行后长行内容完整（含末尾 `end-of-line` 片段）且无 `...` 截断（用例 "wraps long description lines instead of breaking the box"）
- [ ] 3.2 写失败测试：`last_message` 超长时详情页折行渲染且不截断
- [ ] 3.3 实现：新增 `wrapText(text, width)` 助手（逐行按宽度切片，内容零丢失）；`formatRunningDetailFromState`/`FromSnapshot` 的 `last_message`（宽 34）与 state 源 `description` 每行（宽 48）改经 `wrapText` 折行后渲染

## 4. 验证

- [ ] 4.1 跑 `npm run lint` ＋ `npm run typecheck` ＋ `npm test` ＋ `npm run build`，全绿后提交