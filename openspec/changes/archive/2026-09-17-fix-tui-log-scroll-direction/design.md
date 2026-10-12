## Context

TAS-40 报告：TUI 日志页（overview 按 `L` 进入）中按 `↓` 或滚轮向下，视口反而向更旧日志移动，与习惯相反。根因（事实，已从代码确认）：

- `src/observability/terminal-dashboard.ts:499` `scrollLogs(dir)`：`const next = Math.max(0, Math.min(maxStart, currentStart - dir))` —— 方向被取反。
- `processKey`（:193-210）映射 `↑/k → scrollLogs(-1)`、`↓/j → scrollLogs(1)`。
- 同文件兄弟视图 `scrollConfig`（:492）与 `scrollActivityDetail`（:436）均为 `offset + dir`，语义正确；日志视图是唯一反向者。
- TUI 未启用原生鼠标跟踪（全库无 `\x1b[?1000h`/SGR 鼠标解析）：替代屏（`\x1b[?1049h`）下，终端模拟器把滚轮事件翻译为 ↑/↓ 方向键序列，因此滚轮与方向键走同一条路径、呈现同样的反向。
- 暂停锚定（ADR 0019）：`logPinnedTop` 以条目身份锚定，`logPinnedStart` 从身份反查下标——方向修正不影响该机制。
- `jumpMatch`（`n` 向后一个匹配 = 视口向新）已与「向下 = 更新」一致。

## Goals / Non-Goals

**Goals:**

- 日志页滚动方向与终端习惯一致：`↓`/`j`/滚轮向下 → 视口向更新条目；`↑`/`k`/滚轮向上 → 向更旧条目。
- 保持 ADR 0019 的暂停锚定、follow/paused 语义、`n/N` 搜索跳转、`1-4` level 过滤等一切行为不变。
- 用行为测试（渲染输出断言）钉住方向，防回归。

**Non-Goals:**

- 不启用原生鼠标跟踪（SGR 1006/1000h）——见 ADR 0021；替代屏下终端已把滚轮译为方向键，无需新增转义解析，且原生跟踪会牺牲终端原生文本选择。
- 不改 Config / Activity / activity-detail 视图（它们方向本就正确）。
- 不改 `n/N` 匹配跳转、`Space/f` 暂停、level 过滤与提示文案。
- 不处理「在跟随态按 `↓` 已在底部」是否应保持 follow 的边缘细节（现状即翻转为 paused 且停在底部，保持不变）。

## Decisions

1. **`dir` 语义统一为「视口向下」**：`scrollLogs` 改为 `currentStart + dir`。`dir` 不表示「画面文字移动方向」而表示「视口沿内容向下的位移」，与 `scrollConfig`/`scrollActivityDetail` 完全一致。替代方案（交换 `processKey` 里 `↑/↓` 的 dir 实参）只会把同样的歧义挪个位置，且让 `j/k`（vim 惯例 `j`=下）一起变反，否决。
2. **不为滚轮启用原生鼠标跟踪**：修方向即修滚轮（终端翻译机制）；新增 SGR 鼠标解析需扩展 `escBuffer` 的定长转义消歧逻辑（当前只处理 3 字节序列），复杂度与回归面不成比例（ADR 0021）。
3. **测试走渲染输出 seam**：与现有 `tests/terminal-dashboard.test.ts` 一致，通过 `handleKey` + 渲染输出断言可见条目，不触私有方法。

## Risks / Trade-offs

- [现有测试恰好依赖反向行为] → 已核查：现有日志滚动测试只断言「滚动会退出 follow」与暂停冻结，未断言方向，不会翻红。
- [`noUncheckedIndexedAccess` 下 `entries[next]` 仍可能 undefined] → 沿用现有 `?? null` 写法，不新增风险。
- [滚轮在个别终端（如未开启替代屏滚轮翻译的配置）无效] → 属终端模拟器行为，非本修复范围；键盘方向键始终可用。

## Migration Plan

单行修正 + 测试，无状态迁移、无配置变化；合并即生效，回滚即恢复。

## Open Questions

无——grill 阶段所有事实已从代码解析，零开放决策（见 proposal / ADR 0021）。
