## Why

`tasking` 在实际使用中暴露了一系列逐层出现的 bug(YAML parser 嵌套块丢失、daemon 未接调度器、auth_mode 缺失、endpoint 双斜杠 404、fetchIssueStatesByIds 用错 JQL 字段、dashboard 未接线),每次都是启动 → 报错 → 修一个 → 再启动 → 又报错。这些修复虽然已合入,但**缺少回归测试**,同样的 bug 可能回归。同时,代码审计发现**7 个未触发的新 bug**与**12 个测试覆盖缺口**。需要一次性系统性地补齐修复与回归测试,使"测试通过"真正意味着"可运行"。

## What Changes

**A. 为已修 bug 补回归测试(6 项):**
- YAML parser `parseBlock` 嵌套空-rest key 不递归(导致 `tracker.kind` 丢失)——补嵌套块解析测试。
- daemon `onTick` 空操作未调调度器——补 daemon→scheduler 接线集成测试。
- `auth_mode: bearer` 未支持——补 bearer/basic 双模式 auth header 测试。
- endpoint 末尾斜杠导致 404——补 trailing-slash trim 测试。
- `fetchIssueStatesByIds` 用 `key in` 查数字 id——补数字 id JQL 测试。
- HTTP dashboard 未接 daemon——补 `--port` 启动 + `/api/v1/state` 端到端测试。

**B. 修复代码审计发现的新 bug(7 项):**
- **B1**: `Daemon` 与 `runStart` 各创建一个 `ConfigManager`——配置重载只更新 daemon 内部副本,调度器读到的是 stale 配置。**BREAKING**(重构 daemon 接受外部 ConfigManager)。
- **B2**: route agent 的 `defaultSpawn` 向 stdin 发送空 prompt(`buildTriagePrompt([])`),且 `buildCommand` 不含 prompt 参数——route agent 子进程收不到待分诊内容。
- **B3**: route agent `runOnce` 返回的 `dispatched`/`rejected` 恒为 0——不统计 inbox 决策结果。
- **B4**: `assertCwdIsWorkspace(workspace.path, workspace.path)` 传同一值作两参——安全不变式形同虚设。
- **B5**: `Scheduler.stop()` 不清理 retry timer——关闭后 retry 仍触发 `fetchCandidateIssues`。
- **B6**: `reconcileTrackerStates()` 是 fire-and-forget——与同 tick 内的 dispatch 存在竞态。
- **B7**: `Daemon.scheduleTick` 的 ternary 两分支相同——死代码。

**C. 补测试覆盖缺口(12 项):**
- 见 tasks.md 详列。

## Capabilities

### New Capabilities
- `regression-and-integration-tests`: 为已修 bug 与新修 bug 补回归测试,并补齐 daemon↔scheduler↔worker↔tracker 的集成测试链路,确保"测试通过"= "可运行"。

### Modified Capabilities
<!-- 无 spec 级行为变更;本次为 bug 修复 + 测试补齐,不改设计意图。 -->

## Impact

- **修改源码**:`src/cli/daemon.ts`(接受外部 ConfigManager)、`src/cli/index.ts`(单 ConfigManager)、`src/router/route-agent.ts`(prompt 传递 + 决策计数)、`src/worker/runner.ts`(cwd 不变式修正)、`src/scheduler/scheduler.ts`(retry timer 清理 + reconcile 竞态)。
- **新增/修改测试**:`tests/` 下新增与增强约 15+ 测试用例。
- **无外部 API 变更**:不改变 CLI 接口或 `WORKFLOW.md` schema。
- **无依赖变更**。
