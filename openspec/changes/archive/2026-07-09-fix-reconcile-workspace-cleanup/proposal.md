## Why

运行中任务转为 terminal 状态时(agent 自行转 `Done` 或人工关闭),其 per-task 工作区目录会泄漏。`reconcileTrackerStates` 的 terminal 分支把 `entry.task.identifier`(如 `LJWOS-3`)当作路径传给 `removeWorkspace`,而该函数首步 `existsSync` 对相对标识符字符串返回 false,导致清理静默 no-op。只有启动时 terminal 清理(正确拼接 `<workspace.root>/<sanitized_key>` 绝对路径)生效,故泄漏的工作区会一直堆到 daemon 重启才被回收。

现有 spec 已要求"terminal→终止并清理其工作区",但契约过于抽象("清理其工作区"未约束路径解析与磁盘删除),未能防止此缺陷。需强化契约使回归可被测试捕获。

## What Changes

- 修复 `reconcileTrackerStates` 的 terminal 分支:运行中任务转 terminal 时,其 per-task 工作区目录 SHALL 从磁盘实际删除(当前 silently no-op)。
- 清理所用的路径 SHALL 与启动 terminal 清理一致地解析为 `<workspace.root>/<sanitized_identifier>` 绝对路径,并 SHALL 在删除前运行 `before_remove` hook。
- 调度器 SHALL 在运行态条目上承载 worker 实际使用的工作区路径,reconcile 直接复用,避免依赖当前配置推算(对 `workspace.root` 热重载更健壮)。
- 增加回归测试:运行中任务转 terminal 后,断言工作区目录已被删除、`before_remove` hook 已运行。

## Capabilities

### New Capabilities

(无)

### Modified Capabilities

- `structured-scheduler`: 强化"活动运行 reconcile"需求的 terminal 清理契约——明确工作区目录必须从磁盘删除、路径解析与启动清理一致、`before_remove` 先于删除运行;并新增"运行态条目承载工作区路径"子契约。

## Impact

- 代码:`src/scheduler/scheduler.ts`(reconcile terminal 分支路径解析 + dispatch 处填入 `workspace_path`)、`src/shared/types.ts`(`RunningEntry` 增 `workspace_path` 字段)、`src/workspace/manager.ts`(无行为变更,仅被正确调用)。
- 测试:`tests/` 下调度器回归用例(运行中转 terminal → 工作区被删 + before_remove 触发)。
- 无 API、依赖、配置、prompt 变更;无破坏性。
