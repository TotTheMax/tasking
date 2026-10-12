# C3 worker-termination-escalation 设计

## Context

`runDefaultSubprocess` 现状:墙钟/不活跃超时 `child.kill("SIGTERM")` 后无任何后续;abort 监听 `child.kill("SIGKILL")` 仅打父进程;stdout 无上限累积,每 turn 由 `extractSessionAndUsage` 全量重解析。`docs/zh|en/timeout-model.md` 场景 4/5 以"2h stall 兜底"收尾并接受孤儿泄漏,但其有界性论证只覆盖静默卡死——活跃输出型拒签子进程会持续刷新 `last_event_at`,stall 永不触发。`cli-runtime` spec 已为 `tasking stop` 规定 SIGTERM→10s→SIGKILL,worker 路径无理由更宽。

## Goals / Non-Goals

**Goals:**
- 任何超时路径的 slot 占用有硬上界:超时触发 + kill grace(10s)。
- 硬杀不留孤儿:SIGKILL 阶段击杀整个进程组。
- stdout 内存有界,session/usage 单遍累计,seam 完全兼容。

**Non-Goals:**
- 不改三层模型的分层与触发条件(inactivity/wall-clock/stall 各自语义不变,stall 仍是最后兜底)。
- kill grace 不进 WORKFLOW.md 配置(测试经参数注入)。
- 不做 TERM 阶段的组杀(保留 opencode 优雅清理其子进程的职责边界)。
- hook 超时的组杀不在本 change(记入 ADR 0020 future work,另行立项)。

## Decisions

**D1 三入口击杀范围**
| 入口 | 首选 | 升级 |
|---|---|---|
| 墙钟/不活跃超时 | 仅父进程 SIGTERM(优雅) | 10s 后进程组 SIGKILL |
| abort(stall/停机) | 进程组 SIGKILL(直接,无宽限) | — |
| 正常退出 | close 清理全部定时器(含宽限) | — |

**D2 `detached: true` + `kill(-pid)`**:子进程自成进程组,`child.pid` 即 pgid;TERM 仍 `child.kill("SIGTERM")`(只打父进程);KILL 用 `process.kill(-pid, "SIGKILL")`。daemon 自身崩溃时 detached 子进程与现状一样成为孤儿(无恶化)。

**D3 kill grace = 10s 固定**,与 `tasking stop` 的节奏对齐;`runDefaultSubprocess` 增可选参数 `killGraceMs = 10000`(测试传 100ms 级)。宽限语义:期间子进程恢复输出不撤销(TERM 已发,语义已定);定时器幂等只设一次(墙钟与不活跃先后 TERM 过不重置)。否决配置项:为几乎不需调的安全参数增加配置面/校验/双语文档/init 漂移,纯开销。

**D4 stdout 单遍累计 + 有界保留 + seam 回退**
- 逐行解析循环(已有 `parseOpencodeLine`)顺手累计:首个 `sessionID` + 全部 `step_finish` token 求和 → `SubprocessResult.sessionAndUsage?`。
- 原始 stdout 只保留尾部 64KB(诊断够用),内存无界→有界。
- `runAttempt` 取 `result.sessionAndUsage ?? extractSessionAndUsage(result.stdout)`;`extractSessionAndUsage` 保留导出——注入式假 runner 只给 stdout,自动走回退,`tests/worker.test.ts` 现有用例零改动。
- 否决:靠 onOpencodeEvent 回调累计(数据通道耦合进 activity/events 展示通道,方向反了)。

## Risks / Trade-offs

- [组杀波及 agent 故意留下的后台进程] → 仅发生在 KILL 阶段,走到那里意味着 attempt 已被判死,后台进程本就失去存在意义;ADR 记录取舍。
- [`kill(-pgid)` 目标已不存在抛错] → try/catch 吞掉(与 child.kill 同待遇),close 事件才是权威。
- [Windows 无进程组语义] → 本仓目标是 linux/macOS(CI/部署环境),`process.kill(-pid)` 在 win32 会失败——包裹后退化为 `child.kill("SIGKILL")`,行为不劣于现状。
- [64KB 截断影响诊断] → 错误信息只需尾部上下文;`extractSessionAndUsage` 回退路径在同数据量下本来也只有尾部可用性(累积 parse 不受截断影响——累计在截断前完成)。

## Migration Plan

单 MR 部署;无配置/数据迁移。回滚 = git revert(升级路径只在超时分支激活,正常路径行为不变)。
