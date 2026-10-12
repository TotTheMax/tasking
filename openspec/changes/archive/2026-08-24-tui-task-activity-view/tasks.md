## 1. 活动数据模型与 opencode 事件解析（先红后绿）

- [ ] 1.1 写失败测试：`parseOpencodeLine` 对 `text`/`tool_use`/`step_finish` 行返回结构化 `OpencodeEvent`；非 JSON 行返回 `null`；未知 `type` 保留 `type` 不抛错（`tests/worker.test.ts` 新 describe）
- [ ] 1.2 实现 `parseOpencodeLine(line: string): OpencodeEvent | null` 与 `OpencodeEvent` 类型（`src/worker/runner.ts`）
- [ ] 1.3 写失败测试：`ActivityStore.record`/`recent`/`clear`——3 事件读取、500 上限丢最旧、多 task 隔离、未记录返回空、clear 后空（新 `tests/activity-store.test.ts`）
- [ ] 1.4 实现 `src/observability/activity-store.ts`：`ActivityEvent` + `ActivityStore`（每 task 环形缓冲上限 500）

## 2. worker 增量捕获与事件上报（先红后绿）

- [ ] 2.1 写失败测试：`runDefaultSubprocess` 经 `onOpencodeEvent` 回调按到达顺序上报 `text`/`tool_use`/`step_finish`；跨 chunk 的 JSON 行被正确拼接后上报；非 JSON 行跳过；`stdout` 字符串与 `extractSessionAndUsage` 结果不变（`tests/worker.test.ts`，用伪 opencode 脚本产 stdout chunk）
- [ ] 2.2 实现：`runDefaultSubprocess` 加可选 `onOpencodeEvent` 尾参 + 行缓冲 `stdoutLineBuffer` + 共用 `handleStdoutChunk`（inactivity 与 else 两支）；解析用 `parseOpencodeLine`
- [ ] 2.3 写失败测试：`runAttempt` 经 `onActivity` 上报带 `turn` 的 `ActivityEvent`（turn 3 的 text 事件 → `{turn:3,type:"text",text}`）；`turn_started` WorkerEvent 携带 `agent`/`model`/`variant`（含 model 为 null 场景）（`tests/worker.test.ts`，注入产 stdout 的 spawnRunner）
- [ ] 2.4 实现：`RunAttemptOptions` 加 `onActivity?`；`spawnRunner` 类型加可选 `onOpencodeEvent` 尾参；turn 循环构造闭包（捕获 `turn`/`opencodeForTurn`/`config.opencode`）调 spawnRunner 传回调；`turn_started` 事件加 `agent`/`model`/`variant`

## 3. RunningEntry/snapshot/lookupIssue model 字段 + scheduler 接线（先红后绿）

- [ ] 3.1 写失败测试：`RunningEntry` 含 `agent`/`model`/`variant`（`string|null`）；`buildSnapshot` running 行映射三者（`tests/snapshot.test.ts` 或 co-located）
- [ ] 3.2 实现：`src/shared/types.ts` 给 `RunningEntry` + `RuntimeSnapshot` running 行加 `agent`/`model`/`variant`；`src/observability/snapshot.ts` 映射
- [ ] 3.3 写失败测试：scheduler `onEvent` 收到 `turn_started` 时写回 entry.agent/model/variant；`runWorker` 传 `onActivity` 写 `ActivityStore`；`onWorkerExit` 清该 task 缓冲（`tests/scheduler.test.ts`）
- [ ] 3.4 实现：`src/scheduler/scheduler.ts` 持有 `ActivityStore`；`runWorker` 传 `onActivity`；`onEvent` 写回三者；`onWorkerExit` 清缓冲
- [ ] 3.5 实现：`src/observability/http-dashboard.ts` `lookupIssue` running 分支与 `buildSnapshotResponse` 暴露 `agent`/`model`/`variant`

## 4. HTTP 活动端点（先红后绿）

- [ ] 4.1 写失败测试：`GET /api/v1/<id>/activity` 返回 `{activity:[...]}`；`?limit=N` 裁剪；上限 500；未知 task 404 `issue_not_found`；无 activityStore 404 `activity_not_available`；`GET /api/v1/<id>`（无后缀）仍走兜底含 model 字段（`tests/http-dashboard.test.ts` 或 helpers mock server）
- [ ] 4.2 实现：`HttpDashboardOptions` 加 `activityStore?`；`handle` 在兜底路由前匹配 `/api/v1/<id>/activity`（解析 issue identifier，复用 lookupIssue 的标识匹配逻辑查 store）

## 5. TUI 活动模式与详情页 model 显示（先红后绿）

- [ ] 5.1 写失败测试：`TuiMode` 含 `"activity"`；`detail-running` 按 `a` → mode 变 `activity`；`activity` 按 `Esc`/`q` → 回 `detail-running`；`j`/`k` 在 activity 滚动（`tests/terminal-dashboard.test.ts` 或 co-located，断言 mode 转移与 scrollOffset）
- [ ] 5.2 实现：`terminal-dashboard.ts` `TuiMode` 加 `activity`；`TerminalDashboardOptions` 加 `activityStore?`/`fetchActivity?`；`processKey` 加 `a`（detail-running）+ `j/k`/`Esc/q` 在 activity；`enterActivity`/`exitActivity`/`scrollActivity`
- [ ] 5.3 实现：`formatActivity` 头部（task id、model、agent、variant、turn、tokens）+ 事件列表渲染（text/tool_use/step tokens）；进程内直读 `activityStore.recent(detailId)`，远端 1Hz fetch（仿 logs）
- [ ] 5.4 写失败测试：`formatRunningDetailFromState`/`FromSnapshot` 渲染 `Agent`/`Model`/`Variant` 行；footer 含 `a` 提示
- [ ] 5.5 实现：两处详情格式补 model 行与 footer 提示

## 6. CLI 接线与项目记忆/文档

- [ ] 6.1 实现 `src/cli/index.ts`：in-process 构造 `TerminalDashboard`/`HttpDashboard` 注入共享 `activityStore`（scheduler 持有，dashboard/TUI 引用同一实例）；远端 TUI `fetchActivity` 拉活动端点
- [ ] 6.2 更新 `CONTEXT.md`：`Observability` 段补 `活动视图` / `opencode 事件流` 术语
- [ ] 6.3 写 `docs/adr/0012-task-activity-capture-render.md`：A 捕获并渲染 优于 B server 模型 与 C 直读 opencode.db 的决策
- [ ] 6.4 更新 `docs/architecture.md`、`docs/usage.md`：活动视图按键 `a` 与 `GET /api/v1/<id>/activity` 端点；需求2 分析结论（只分析不实现）

## 7. 验证

- [ ] 7.1 跑 `npm run lint` ＋ `npm run typecheck` ＋ `npm test`，全绿后提交
