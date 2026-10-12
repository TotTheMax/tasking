## 1. 红灯：方向行为测试

- [x] 1.1 在 `tests/terminal-dashboard.test.ts` 新增测试「↓ shows newer, ↑ shows older in logs view」：构造 >40 条日志（如 `entry 0..39`），进 `logs` 页、`k`/`↑` 退出 follow 锚定可见窗口，断言按 `↓`（`\x1b[B`）后视口顶行显示**更新**的条目、按 `↑`（`\x1b[A`）显示**更旧**的条目（用渲染输出中可见的条目编号断言）。先运行确认失败（当前实现方向相反）。

## 2. 绿灯：修正方向

- [x] 2.1 修改 `src/observability/terminal-dashboard.ts` `scrollLogs`：`currentStart - dir` → `currentStart + dir`；运行 1.1 的测试确认转绿。
- [x] 2.2 补边界断言（或并入 1.1 的第二个用例）：在最新条目（follow 底部）按 `↓` 与最旧条目按 `↑` 均钳制在边界内、不跳回 follow 尾部。

## 3. 回归与门禁

- [x] 3.1 运行 `npx vitest run tests/terminal-dashboard.test.ts` 全绿（现有 pause/follow/roll 测试零回归）。
- [x] 3.2 运行门禁：`npm run lint`、`npm run typecheck`、`npm test` 全绿。
