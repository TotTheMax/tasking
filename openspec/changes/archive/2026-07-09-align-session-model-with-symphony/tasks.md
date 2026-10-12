## 1. Sidecar 文件辅助函数

- [x] 1.1 新增 `writeSessionSidecar(workspacePath, sessionId)` 函数,原子写入 `.tasking-session.json`(`{ session_id, updated_at }`)
- [x] 1.2 新增 `readSessionSidecar(workspacePath)` 函数,读取 `.tasking-session.json` 返回 session ID 或 null;文件缺失/损坏返回 null
- [x] 1.3 单元测试:写入后读取一致、文件缺失返回 null、损坏 JSON 返回 null

## 2. Worker 层 — sidecar 写入与 prompt 逻辑

- [x] 2.1 `runAttempt` 在 `extractSessionAndUsage` 提取到 session ID 后,调用 `writeSessionSidecar(workspace.path, sessionId)` 写入 sidecar
- [x] 2.2 `runAttempt` turn 1 prompt 逻辑改回 `turn === 1` 恒为全量 `renderPrompt`(移除 `&& !sessionId` 条件)
- [x] 2.3 更新 `worker.test.ts`:`successResult` mock 产生的 session ID 验证 sidecar 写入;turn 1 prompt 不受 sessionId 影响

## 3. Worker 层 — 续轮指引恢复

- [x] 3.1 `buildContinuationGuidance` 恢复为包含 `git log` / `git status` 检查指引:"Continue working on {identifier} (attempt {attempt}, turn {turn}). Check `git log` and `git status` to see what was done. Resume from where you left off."
- [x] 3.2 更新 `prompt.test.ts` 断言验证新指引内容

## 4. 调度器层 — continuation 不传 session ID

- [x] 4.1 `onWorkerExit` continuation 路径改为 `scheduleRetry(task, 1, null, true, null)`(传 null 而非 `result.session_id`)
- [x] 4.2 确认 `scheduleRetry` 的 `session_id` 默认为 null(continuation 也不再传播)
- [x] 4.3 确认 `onRetry` 入口 `claimed.delete(taskId)` 已存在(前序变更修复)
- [x] 4.4 确认 `onRetry` terminal 清理路径从 sidecar 读取 session ID(而非 `retry.session_id`)

## 5. 调度器层 — terminal 清理改用 sidecar

- [x] 5.1 `onRetry` 中任务不在候选时的 terminal 清理:改为 `readSessionSidecar(wsPath)` 获取 session ID,传给 `removeWorkspace`
- [x] 5.2 `reconcileTrackerStates` 中 terminal 清理:改为 `readSessionSidecar(entry.workspace_path)` 获取 session ID
- [x] 5.3 `startupTerminalCleanup` 中启动清理:改为 `readSessionSidecar(wsPath)` 获取 session ID(daemon 重启后 sidecar 可能仍在)
- [x] 5.4 更新 `scheduler.test.ts`:continuation 传 null、terminal 清理从 sidecar 读取

## 6. 工作区层 — removeWorkspace 从 sidecar 读取

- [x] 6.1 `removeWorkspace` 改为:先尝试 `readSessionSidecar` 获取 session ID;有则 `deleteSession`;然后删目录
- [x] 6.2 `removeWorkspace` 的 `sessionId` 参数改为可选:传入时直接用(兼容),未传入时从 sidecar 读取
- [x] 6.3 更新 `workspace.test.ts`:sidecar 存在时自动读取并清理、sidecar 缺失跳过

## 7. 文档更新

- [x] 7.1 `docs/architecture.md` — 更新 session 模型:continuation retry 创建全新 session(对齐 Symphony),sidecar 文件驱动清理
- [x] 7.2 `docs/configuration.md` — 更新 `max_turns` 说明:worker 内续接同一 session,跨 worker 全新 session

## 8. 集成验证

- [x] 8.1 运行 `npm run lint` 并修复所有问题
- [x] 8.2 运行 `npm run typecheck` 并修复所有类型错误
- [x] 8.3 运行 `npm test` 确保全部测试通过
- [x] 8.4 运行 `npm run build` 确保构建成功
