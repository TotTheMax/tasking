## 1. 共享路径解析 helper

- [x] 1.1 在 `src/workspace/manager.ts` 新增并导出 `resolveWorkspacePath(identifier: string, workspaceRoot: string): string`,实现 `resolvePath(workspaceRoot, sanitizeWorkspaceKey(identifier))`
- [x] 1.2 重构 `createWorkspace`(`manager.ts:69-70`)改用 `resolveWorkspacePath`,行为不变
- [x] 1.3 重构 `startupTerminalCleanup`(`scheduler.ts:421-423`)改用 `resolveWorkspacePath`,行为不变

## 2. RunningEntry 承载工作区路径

- [x] 2.1 在 `src/shared/types.ts` 的 `RunningEntry` 接口增加 `workspace_path: string` 字段
- [x] 2.2 在 `dispatch`(`scheduler.ts:188-205`)构造 `RunningEntry` 时填入 `workspace_path: resolveWorkspacePath(task.identifier, config.workspace.root)`
- [x] 2.3 排查所有构造 `RunningEntry` 的位置(含测试 stub `tests/worker.test.ts:45`、`tests/mcp.test.ts:21`),补齐新字段

## 3. 修复 reconcile terminal 清理

- [x] 3.1 修改 `reconcileTrackerStates`(`scheduler.ts:388-394`)terminal 分支:把 `removeWorkspace(entry.task.identifier, ...)` 改为 `removeWorkspace(entry.workspace_path, ...)`
- [x] 3.2 确认 `before_remove` hook 现可通过正确路径触发(无需改 `removeWorkspace`,仅靠传参修正)
- [x] 3.3 核查 `onWorkerExit`/其他分支无遗漏的 `removeWorkspace(identifier)` 误用

## 4. 回归测试

- [x] 4.1 在 `tests/scheduler.test.ts` 增用例:运行中任务转 terminal → 断言工作区目录被删、`before_remove` hook 已运行(用 `tmpdir` + fake tracker + 真 `removeWorkspace`)
- [x] 4.2 增用例:terminal 清理使用 `entry.workspace_path`(模拟 `workspace.root` 热重载后,reconcile 仍删派发时的旧路径目录)
- [x] 4.3 增用例:`workspace_path` 指向不存在的目录时 terminal 分支安全 no-op、不抛错、worker 仍被终止
- [x] 4.4 增用例:非 active 非 terminal 状态仍保留工作区(回归保护,确保只改了 terminal 分支)
- [x] 4.5 在 `tests/workspace.test.ts` 增 `resolveWorkspacePath` 单测:清洗 + 与 `createWorkspace` 输出一致

## 5. 验证

- [x] 5.1 `npm run lint`
- [x] 5.2 `npm run typecheck`
- [x] 5.3 `npm test`
