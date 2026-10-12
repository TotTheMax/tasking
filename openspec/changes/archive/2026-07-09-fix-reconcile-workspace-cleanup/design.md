## Context

`reconcileTrackerStates`(`src/scheduler/scheduler.ts:372`)的 terminal 分支调用 `removeWorkspace(entry.task.identifier, ...)`,把任务标识符(如 `LJWOS-3`)当作路径传入。`removeWorkspace`(`src/workspace/manager.ts:108`)首步 `existsSync(workspacePath)` 对该相对字符串返回 false,直接 return,清理静默失败。结果:运行中任务转 terminal 时 worker 被 abort、从 `running` 移除,但工作区目录留在磁盘,直到 daemon 重启由 `startupTerminalCleanup`(正确拼接 `<workspace.root>/<sanitized_key>`)回收。

数据流约束:`dispatch`(`scheduler.ts:186`)在 `runAttempt` 之前创建 `RunningEntry` 并放入 `running` map;`createWorkspace`(`manager.ts:67`)在 `runAttempt` 内部用确定性公式 `resolve(workspace.root, sanitizeWorkspaceKey(identifier))` 算出路径并 mkdir。由于公式确定性,调度器可在派发时预计算同一路径,无需等 `runAttempt` 回传。

路径解析公式当前在两处重复:`createWorkspace`(`manager.ts:69-70`)与 `startupTerminalCleanup`(`scheduler.ts:421-423`)。

## Goals / Non-Goals

**Goals:**
- 运行中任务转 terminal 时,其 per-task 工作区目录被实际从磁盘删除。
- reconcile 清理使用与启动清理一致的路径解析,且 `before_remove` hook 先于删除运行。
- 路径解析公式单一来源,消除 `createWorkspace` / `dispatch` / `reconcile` / `startupCleanup` 间的重复与漂移风险。
- 回归测试覆盖"运行中转 terminal → 工作区被删 + before_remove 触发"。

**Non-Goals:**
- 不改变非 active 非 terminal(review/handoff)态保留工作区的行为(设计如此)。
- 不引入持久化 running 状态或跨重启 reconcile(仍为内存态)。
- 不改动 `removeWorkspace` / `createWorkspace` 的内部行为,仅统一调用方传参与抽取共享 helper。
- 不处理 `workspace.root` 热重载后旧工作区的迁移(超出本次缺陷范围)。

## Decisions

### 决策 1:在 `RunningEntry` 上承载 `workspace_path`,派发时预计算

调度器在 `dispatch` 时用共享 helper 预计算 `workspace_path = resolveWorkspacePath(task.identifier, config.workspace.root)` 存入 `RunningEntry`;reconcile terminal 分支改用 `entry.workspace_path`。

**为何不在 reconcile 内现算(备选 A)**:现算需在 reconcile 时重读当前 `config.workspace.root`。若 `workspace.root` 在派发与 reconcile 之间被热重载,现算路径会指向新 root 下的位置,而非工作区实际所在位置,清错对象(漏清旧目录、或对新 root 下不存在的路径 no-op)。承载于 entry 则锁定派发时的路径,与 `createWorkspace` 实际使用的一致。

**为何不从 `runAttempt` 回传路径(备选 B2)**:`runAttempt` 在 worker 内部才创建工作区,但其返回时 worker 已结束;而 reconcile 与 worker 并发运行,需在 worker 仍活、任务转 terminal 时即时拿到路径。回传太晚,无法服务并发 reconcile。预计算确定性公式避免该时序问题。

**确定性保证**:`createWorkspace` 与 `resolveWorkspacePath` 共用同一 helper(见决策 2),路径公式不可漂移。即便 `createWorkspace` 因 `after_create` hook 失败而回滚删除了目录,`entry.workspace_path` 指向不存在的路径时 `removeWorkspace` 的 `existsSync` 守卫会安全 no-op,无崩溃风险。

### 决策 2:抽取 `resolveWorkspacePath(identifier, root)` 共享 helper

在 `src/workspace/manager.ts` 新增并导出 `resolveWorkspacePath(identifier, workspaceRoot): string`,实现 `resolve(workspaceRoot, sanitizeWorkspaceKey(identifier))`。`createWorkspace` 改用之(`manager.ts:70`),`dispatch` 与 `startupTerminalCleanup` 亦改用之。

**理由**:消除三处重复,保证 reconcile/启动/创建三者路径一致——这正是本次 bug 的根因(调用方各自拼路径,terminal 分支拼错)。单一来源使未来变更不会再次漂移。

### 决策 3:`before_remove` hook 在 terminal 清理时运行

`removeWorkspace` 已在删除前运行 `before_remove`(`manager.ts:110`)。修复路径参数后,reconcile terminal 分支将首次真正触发该 hook。无需改 `removeWorkspace`,只需确保传参正确。与启动清理行为一致。

## Risks / Trade-offs

- [Risk] `createWorkspace` 失败回滚后 `entry.workspace_path` 指向不存在的目录 → `removeWorkspace` 的 `existsSync` 守卫安全 no-op。无副作用。→ 无需额外处理,但回归测试应覆盖"工作区不存在时 reconcile terminal 不抛错"。
- [Risk] 路径公式未来被某处局部改写 → 共享 helper 已消除此风险;review 时确保无新重复拼路径代码。
- [Trade-off] `RunningEntry` 增一个 `string` 字段,内存占用可忽略;换来 reconcile 对当前配置零依赖。
- [Trade-off] 派发时预计算路径,若 `workspace.root` 之后热重载,旧 entry 仍指向旧路径——这正是期望行为(清理实际工作区所在),非缺陷。
- [Risk] 回归测试需用 fake tracker + 临时 workspace root,避免真删测试机目录 → 测试用 `tmpdir` + 注入 `removeWorkspace` 或直接断言目录消失。

## Migration Plan

无持久化迁移(状态全内存)。部署即生效:新版本 reconcile terminal 分支立即正确清理。回滚= redeploy 旧版本(已泄漏的工作区由旧版重启时的 `startupTerminalCleanup` 兜底回收,与现状一致)。

## Open Questions

无。路径公式、承载位置、helper 抽取均已确定。
