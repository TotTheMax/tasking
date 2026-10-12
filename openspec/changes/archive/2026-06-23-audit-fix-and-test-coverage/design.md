## Context

`tasking` 核心实现完成后,实际对接自建 Jira 时连续暴露 6 个 bug(逐个修复但无回归测试)。随后代码审计又发现 7 个未触发 bug 与 12 个测试覆盖缺口。现状:126 个测试通过,但"通过"不等于"可运行"——大量测试用 mock 绕过了真实路径,且关键集成点(daemon→scheduler、config reload→scheduler、route agent prompt 传递)无测试覆盖。

约束:不改 CLI 接口与 `WORKFLOW.md` schema;不改外部依赖;保持 126 个现有测试不回归。

## Goals / Non-Goals

**Goals:**
- 修复 7 个代码审计发现的 bug(B1-B7)。
- 为 6 个已修 bug + 7 个新修 bug 补回归测试,每个 bug 至少一个失败-即-修复的测试用例。
- 补齐 12 个测试覆盖缺口,使关键集成路径有端到端测试。
- 达到"测试通过 = 可运行"的信心水平。

**Non-Goals:**
- 不做性能测试或负载测试。
- 不引入新的测试框架或依赖(继续用 vitest + mock)。
- 不改 CLI 接口或配置 schema。
- 不做真实 Jira/飞书/opencode 的集成测试(保持 mock,真实集成 profile 仅 skip)。

## Decisions

### 决策 1:Daemon 接受外部 ConfigManager(修复 B1)
**选择:** `Daemon` 构造函数改为接受 `ConfigManager` 实例而非 `workflowPath` 字符串。

**理由:** 当前 `runStart` 和 `Daemon` 各创建一个 `ConfigManager`,配置重载只更新 daemon 的内部副本,调度器读到的是 stale 配置。统一为单一实例,重载对两者生效。

### 决策 2:route agent prompt 通过命令行参数传递(修复 B2)
**选择:** `buildCommand` 增加末尾 prompt 参数(与 worker runner 一致),删除 stdin 写入逻辑。

**理由:** `opencode run` 的一次性 prompt 通过命令行参数传递(与 worker 一致),stdin 写入是错误路径且发了空 prompt。统一为命令行参数最简单可靠。

### 决策 3:route agent 决策计数从 inbox 查询(修复 B3)
**选择:** `runOnce` 在 route agent 完成后查询 inbox 中 `decided`/`dispatched`/`rejected` 的增量,填入返回值。

**理由:** route agent 的决策通过 `inbox.mark_decision` 工具写入 inbox,而非通过返回值。最准确的方式是对比运行前后的 inbox 状态计数。

### 决策 4:cwd 不变式改为校验 spawn 时的 cwd 参数(修复 B4)
**选择:** 移除 `assertCwdIsWorkspace(workspace.path, workspace.path)`(永远通过的无用检查),改为在 `runDefaultSubprocess` 内部通过日志断言 `spawn` 的 `cwd` 参数等于 workspace path。

**理由:** 当前检查传入同一值作两参,形同虚设。worker 的 cwd 由 `spawn(..., { cwd })` 设置,校验应在 spawn 前。

### 决策 5:Scheduler.stop() 清理全部 retry timer(修复 B5)
**选择:** `stop()` 遍历 `retry_attempts`,clearTimeout 全部 timer。

**理由:** 当前 `stop()` 只清 `tickTimer`,retry timer 继续触发 `onRetry` → `fetchCandidateIssues`。

### 决策 6:reconcileTrackerStates 改为 await(修复 B6)
**选择:** `reconcileRunningIssues` 改为 `async`,`await reconcileTrackerStates()`。`tick()` 在 dispatch 前 `await reconcileRunningIssues()`。

**理由:** 当前 `void this.reconcileTrackerStates()` 是 fire-and-forget,与同 tick 内 dispatch 竞态。改为 await 确保对账完成后才 dispatch。

### 决策 7:测试用 fake timers 控制 retry/continuation 时序
**选择:** scheduler 测试用 vitest 的 `useFakeTimers()` 控制 retry timer 触发,而非用 `never-resolving` mock。

**理由:** 当前测试用 `new Promise(() => {})` 阻止 worker 完成,无法测试 worker 退出→retry→重新派发的完整流程。fake timers 可精确控制时序。

## Risks / Trade-offs

- **[风险] Daemon 构造签名变更** → B1 修复改变 `Daemon` 构造函数,可能影响现有测试。**缓解:** 更新受影响测试;`Daemon` 是内部类,不影响外部 API。
- **[风险] reconcile 改为 await 增加 tick 耗时** → B6 修复使 tick 等待网络请求完成。**缓解:** 对账与 dispatch 本就有先后依赖;网络超时由 tracker 的 30s timeout 兜底。
- **[权衡] 测试仍用 mock 而非真实集成** → 无法完全保证真实 Jira/飞书兼容。接受:真实集成 profile 作为 skip-only,回归测试用 mock 覆盖逻辑正确性。
