## 1. 逐步 token 实时累计（live step_usage）

- [x] 1.1 写失败测试：worker 在收到 `step_finish`（含 tokens）时上报 `step_usage` 事件（含 usage），且 `turn_completed` 不再携带 usage（`tests/worker.test.ts`）
- [x] 1.2 实现：`runAttempt` 的 `onOpencodeEvent` 在 `evt.tokens` 存在时经 `opts.events.onEvent` 上报 `step_usage`；`turn_completed` 事件移除 `usage` 字段
- [x] 1.3 更新 `tests/scheduler.test.ts`「token dedup」测试：改为断言 `step_usage` 事件累计到 `RunningEntry`（两次事件相加、turn_completed 不计）

## 2. 会话级 token 持久化（sidecar）

- [x] 2.1 写失败测试：`writeSessionSidecar` 携带 token 写入、`readSessionSidecar` 读回；旧 sidecar（无 token 字段）读回 0（`tests/workspace.test.ts`）
- [x] 2.2 实现：`SessionSidecar` 增加可选 token 字段；`writeSessionSidecar` 接受可选 tokens 参数并写入；`readSessionSidecar` 解析
- [x] 2.3 写失败测试：`runAttempt` 写入 sidecar 时保存「恢复基线 + 本次累计」的会话累计（`tests/worker.test.ts`）
- [x] 2.4 实现：`RunAttemptOptions` 增加 `baseTokens`；`runAttempt` 每 turn 写 sidecar 时累计 base + usage
- [x] 2.5 写失败测试：scheduler 派发时从 sidecar 恢复 token 到新建 `RunningEntry`（`tests/scheduler.test.ts`）
- [x] 2.6 实现：`dispatch()` 用 sidecar token 初始化 `RunningEntry` 的 token 字段

## 3. 显示宽度工具（CJK 感知）

- [x] 3.1 写失败测试：`displayWidth` / `wrapToWidth` / `truncateToWidth` 正确处理 CJK 双宽、ASCII 单宽、组合/控制字符（`tests/wrap.test.ts`）
- [x] 3.2 实现：新增 `src/observability/wrap.ts`（零依赖，含东亚宽字符范围表）

## 4. 活动视图换行渲染与选中

- [x] 4.1 写失败测试：`formatActivity` 长文本（含中文）按宽度换行、最多 3 行、超出 `…`，选中行高亮，footer 提示 Enter expand（`tests/terminal-dashboard.test.ts`）
- [x] 4.2 实现：activity 模式增加选中光标 `activityCursor`；`↑/↓/j/k` 移动光标并锚定视口；`formatActivity` 用 `wrapToWidth` 渲染事件文本（拆 `\n` 后逐行 wrap），选中行高亮

## 5. 全文浮层（activity-detail）

- [x] 5.1 写失败测试：activity 模式按 `Enter` 进入 `activity-detail` 显示选中事件全文；`↑/↓/j/k` 滚动；`Esc/q` 返回 activity（`tests/terminal-dashboard.test.ts`）
- [x] 5.2 实现：新增 `activity-detail` 模式、`activityDetailScroll` 状态与 `formatActivityDetail`；`processKey` 增加 Enter 展开/浮层滚动/返回绑定
- [x] 5.3 更新既有 activity 滚动测试为光标语义（j/k 移动光标、Space/f 恢复跟随到最新）

## 6. 收尾

- [x] 6.1 更新 `docs/en/usage.md` 与 `docs/zh/usage.md` 的 TUI 键位说明（Enter expand）
- [x] 6.2 运行全量 gate：`npm run lint` / `npm run typecheck` / `npm test` / `npm run build`