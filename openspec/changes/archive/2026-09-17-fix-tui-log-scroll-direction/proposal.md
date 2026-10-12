## Why

TAS-40: 在 TUI 中按 `L` 进入日志页后，按 `↓`（以及鼠标滚轮向下）视口却向更旧（更早）的日志移动，与终端滚动习惯（`less`、终端回滚、其他 TUI 页面）恰恰相反。根因已定位：`scrollLogs` 用 `currentStart - dir` 计算新视口起点，而键位映射 `↑→-1`、`↓→+1`，方向被反转；同文件的 `scrollConfig` / `scrollActivityDetail` 均正确使用 `+ dir`，日志视图是唯一反向的视图。

## What Changes

- 修正 Log 视图滚动方向：`scrollLogs` 改为 `currentStart + dir`（`dir` 语义 = 视口向下移动一格），使 `↓`/`j`/滚轮向下显示更新的日志、`↑`/`k`/滚轮向上显示更旧的日志。
- 暂停锚定机制（ADR 0019 的 `logPinnedTop` 条目身份锚定）不变，仅修正方向算术。
- 明确不做：不启用原生鼠标跟踪（SGR `\x1b[?1000h`/1006）。替代屏下终端已把滚轮事件翻译为 ↑/↓ 方向键，修好方向键即同时修好滚轮（见 ADR 0021）。
- 在 `terminal-dashboard` 规格中补充 Log 视图滚动方向的确定性要求与场景。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `terminal-dashboard`: 模式键绑定要求中补充日志视图滚动方向约定——`↓`/`j`/滚轮向下 SHALL 使视口向更新（更晚）条目移动，`↑`/`k`/滚轮向上 SHALL 向更旧条目移动；替代屏下滚轮依赖终端的箭头键模拟，不启用原生鼠标跟踪。

## Impact

- 代码：`src/observability/terminal-dashboard.ts`（`scrollLogs` 一行方向修正）。
- 测试：`tests/terminal-dashboard.test.ts` 新增方向断言（红→绿）。
- 文档：`CONTEXT.md` 新增术语「Scroll direction（滚动方向）」；新增 `docs/adr/0021-tui-scroll-delta-viewport-down.md`。
- 无配置模式、无 API、无其他子系统改动；`↑↓ scroll` 提示文案不变。
