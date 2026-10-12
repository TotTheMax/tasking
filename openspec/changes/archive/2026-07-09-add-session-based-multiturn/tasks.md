## 1. 共享类型层

- [x] 1.1 `AttemptResult` 新增 `session_id: string | null` 字段(types.ts)
- [x] 1.2 `RetryEntry` 新增 `session_id: string | null` 字段(types.ts)
- [x] 1.3 `RunAttemptOptions` 新增可选 `sessionId?: string | null` 字段(types.ts)
- [x] 1.4 确认 `RunningEntry.session_id` 字段已存在(types.ts:62),无需新增

## 2. Worker 层 — JSON 事件流解析

- [x] 2.1 新增 `extractSessionAndUsage(stdout: string): { session_id: string | null; usage: { input_tokens; output_tokens; total_tokens } }` 函数,遍历 JSON 行,提取第一个 `sessionID` 值,累加所有 `step_finish` 事件的 `part.tokens.input/output/total`
- [x] 2.2 标记旧 `extractUsage` 为废弃或删除,所有调用点改用 `extractSessionAndUsage`
- [x] 2.3 为 `extractSessionAndUsage` 编写单元测试:多 step_finish 累加、session ID 提取、无 JSON 行回退、混合事件类型

## 3. Worker 层 — 命令构建与 session 续接

- [x] 3.1 `buildOpencodeCommand` 新增可选 `sessionId?: string | null` 参数;始终添加 `--format json`;当 sessionId 非空时添加 `-s <sessionId>`
- [x] 3.2 `buildOpencodeCommand` 单元测试:有 session ID 加 `-s`、无 session ID 不加、始终含 `--format json`
- [x] 3.3 `runAttempt` 循环改为 session 续接:turn 1 使用 `buildOpencodeCommand(opencode, ws, prompt)`(无 sessionId,除非从 RunAttemptOptions 传入);turn 1 完成后调用 `extractSessionAndUsage` 提取 session_id;turn 2+ 使用 `buildOpencodeCommand(opencode, ws, prompt, sessionId)` 续接

## 4. Worker 层 — 续轮指引精简

- [x] 4.1 `buildContinuationGuidance` 改为返回 `"Continue."` 单行(session 模式下 agent 有完整上下文)
- [x] 4.2 更新 `prompt.test.ts` 中 `buildContinuationGuidance` 的断言

## 5. Worker 层 — AttemptResult 携带 session ID

- [x] 5.1 `runAttempt` 在循环结束后将提取的 session_id 写入 `AttemptResult.session_id`
- [x] 5.2 `runAttempt` 在 `RunAttemptOptions.sessionId` 非空时(turn 1 续接场景),将其作为初始 session ID 传入 turn 1 的 `buildOpencodeCommand`
- [x] 5.3 更新 `worker.test.ts` 中 `runAttempt` 的 mock 和断言,验证 `AttemptResult.session_id` 被正确填充

## 6. 调度器层 — session ID 传播

- [x] 6.1 `dispatch` 方法接收可选 `sessionId` 参数,写入 `RunningEntry.session_id`
- [x] 6.2 `onWorkerExit` 从 `AttemptResult.session_id` 取值;成功时传给 `scheduleRetry`(continuation=true);失败时传 null(continuation=false)
- [x] 6.3 `scheduleRetry` 新增 `sessionId` 参数,写入 `RetryEntry.session_id`
- [x] 6.4 `onRetry` 从 `RetryEntry.session_id` 取值,传给 `dispatch`
- [x] 6.5 `reconcileStalledRuns` 终止停滞任务时,`scheduleRetry` 传 null session_id
- [x] 6.6 更新 `scheduler.test.ts` 覆盖:continuation 传播 session ID、failure 传 null、stalled 传 null

## 7. 调度器层 — RunningEntry 实时更新

- [x] 7.1 `runWorker` 在 `runAttempt` 返回后,从 `AttemptResult.session_id` 更新 `RunningEntry.session_id`(供仪表板实时可见)

## 8. 工作区层 — session 清理联动

- [x] 8.1 `removeWorkspace` 新增可选 `sessionId?: string | null` 参数;非空时在 `rmSync` 前执行 `opencode session delete <sessionId>`;失败记录警告但不阻塞
- [x] 8.2 新增 `deleteSession(sessionId, logger)` 辅助函数,封装 `execFileSync("opencode", ["session", "delete", sessionId])` 调用与错误处理
- [x] 8.3 `reconcileTrackerStates` 中 terminal 清理调用 `removeWorkspace(path, hooks, logger, entry.session_id)`
- [x] 8.4 `reconcileTerminalIssues` 中启动清理调用 `removeWorkspace(path, hooks, logger, null)`(daemon 可能重启,无 session ID)
- [x] 8.5 更新 `workspace.test.ts` 覆盖:有 session ID 时先 delete、无 session ID 跳过、delete 失败不阻塞

## 8.5.可观测性层 — 快照填充

- [x] 8.6 确认 `RuntimeSnapshot` 的 `session_id` 字段已从 `RunningEntry.session_id` 映射(检查快照构建逻辑,如已有则仅需验证数据流通畅)

## 9. 文档更新

- [x] 9.1 `docs/architecture.md` — 更新多轮模型描述:从"失忆续轮"改为"session 续轮",说明 `-s` 机制与 prompt cache 优势
- [x] 9.2 `docs/configuration.md` — 更新 `max_turns` 字段说明:推荐值、session 续轮行为、续轮指引精简
- [x] 9.3 `docs/usage.md` — 如有涉及多轮或 session 的段落,同步更新

## 10. 集成验证

- [x] 10.1 运行 `npm run lint` 并修复所有问题
- [x] 10.2 运行 `npm run typecheck` 并修复所有类型错误
- [x] 10.3 运行 `npm test` 确保全部测试通过
- [x] 10.4 运行 `npm run build` 确保构建成功
