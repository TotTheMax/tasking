## Context

`formatRunningDetailFromState`（`src/observability/terminal-dashboard.ts`）是 TUI 运行中任务详情页的进程内 state 渲染路径，也是唯一渲染 Description 区块的路径（`formatRunningDetailFromSnapshot` 与 `formatRetryDetail*` 均不渲染描述）。当前实现把 `task.description` 每行按内容区宽 48 折行后全部输出，无行数上限，导致长描述撑高详情框、上方字段被顶出终端可视区。既有 `capTailLines`（取末尾 N 行并返回丢弃数）与 `wrapToWidth`/`truncateToWidth` 助手已存在，可作为折叠复用的基础。

TAS-26 拷问已确认三项决策：默认折叠 6 行；用 `e` 键切换展开/收起；展开状态不跨任务记忆。

## Goals / Non-Goals

**Goals:**
- 描述过长时详情页不再撑破可视区，上方字段稳定可见。
- 默认折叠到 6 个折行后行，超出显示 `… (N more lines)` 标记。
- `e` 键在 `detail-running` 模式切换展开/收起，footer 提示按键。
- 空/`null` 描述仍不渲染 Description 区块；既有折行保证盒边框完整。

**Non-Goals:**
- 不改动 snapshot 源与 retry 详情（它们不渲染描述）。
- 不做滚动（详情页为紧凑摘要卡，滚动语义交给 activity-detail 已有实现）。
- 不持久化/记忆展开状态（每次渲染默认折叠）。

## Decisions

**D1: 折叠方向取"折行后的行"，而不是"原始换行符行"。**
描述先经 `wrapToWidth(desc, 48)` 折行（保持既有盒宽 48 与逐行 `│  ` 前缀），再对折行结果取前 6 行。理由：与既有渲染路径一致，`… (N more lines)` 的 N 与"被省略的折行行数"直接对应；若按原始行截断会出现半行宽度不齐。

**D2: 新增 `descExpanded` 实例字段（每渲染周期默认 `false`），`e` 键切换。**
`processKey` 在 `detail-running` 模式新增 `case "e"` 翻转 `descExpanded` 后重绘。进入详情时字段保持默认 `false`，天然满足"不跨任务记忆"。

**D3: 折叠标记文案 `… (N more lines)`。**
N = 折行总数 − 显示行数。展开态不再显示标记。footer 折叠态显示 `· e expand`，展开态显示 `· e collapse`。

## Risks / Trade-offs

- [折叠行数固定 6 行在超窄/超高终端下仍可能溢出] → 折行宽 48 与 6 行高度均为既有详情卡典型尺寸；若未来需要可做成终端高度感知（超出本期范围）。
- [既有测试"wraps long description lines"断言不出现 `...` 会与折叠冲突] → 更新该用例为折叠语义，或改用短描述断言折行不破坏盒；将同步调整 spec 中"全量显示"需求。
