## ADDED Requirements

### Requirement: 终止升级与进程组击杀
worker SHALL 以独立进程组方式启动 `opencode run` 子进程(detached)。墙钟或不活跃超时触发时,worker SHALL 先仅对子进程(组 leader)发 SIGTERM;若在 kill grace(固定 10000ms,SHALL NOT 暴露为 WORKFLOW.md 配置;实现层 SHALL 可参数化注入供测试)内子进程未退出,SHALL 升级为对整个进程组发 SIGKILL。宽限期间子进程恢复输出 SHALL NOT 撤销升级;宽限定时器 SHALL 幂等(多个超时源先后触发时只设一次)。abort 信号路径(scheduler stall 兜底、daemon 停机)SHALL 直接对整个进程组发 SIGKILL,无宽限。子进程正常退出 SHALL 清理全部定时器(含宽限定时器)。worker SHALL 在逐行解析 stdout 事件流时增量累计 session ID 与 token 用量,SHALL NOT 为此对全量 stdout 做逐 turn 重复解析;注入式 spawnRunner 仅返回 stdout 时 SHALL 走全量解析回退。

#### Scenario: 拒签 SIGTERM 的子进程被组杀
- **WHEN** 子进程捕获并忽略 SIGTERM 且持续运行,墙钟超时触发
- **THEN** SIGTERM 后经 kill grace 子进程仍未退出,整个进程组被 SIGKILL,spawnRunner Promise 以超时结果 resolve

#### Scenario: 宽限内优雅退出则不升级
- **WHEN** 墙钟/不活跃超时发 SIGTERM 后,子进程在 kill grace 内自行退出
- **THEN** 不发生 SIGKILL,close 正常清理全部定时器,attempt 按超时分类

#### Scenario: abort 直接组杀
- **WHEN** AbortSignal 触发(scheduler stall 或 daemon 停机)
- **THEN** 整个进程组被 SIGKILL,无 SIGTERM、无宽限

#### Scenario: 会话与用量单遍累计
- **WHEN** 一轮 turn 的 stdout 含多个 JSON 事件(含 `step_finish` token 与 `sessionID`)
- **THEN** session ID 与累计用量由流式单遍解析得出,与全量 `extractSessionAndUsage` 对同一输入的结果一致

#### Scenario: 仅返回 stdout 的注入式 runner 回退
- **WHEN** 测试注入的 spawnRunner 只提供 `stdout`(无 `sessionAndUsage`)
- **THEN** runAttempt 经 `extractSessionAndUsage(stdout)` 回退取值,行为与现状一致
