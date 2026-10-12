## Why

三层超时模型的"成本有界"承诺存在漏洞:墙钟/不活跃超时只发 SIGTERM 且无升级——**持续输出型拒签子进程**(如 wrapper `trap '' TERM` 且继续产出 token 事件)会不断刷新 `entry.last_event_at`,stall 检测永不满足,slot 被**无限期**占用(docs 场景 4 只分析了静默卡死);静默场景下也要占满 2h 才由 stall 兜底,而 10s 宽限即可解决;且与 `tasking stop` 对 daemon 自身的 SIGTERM→10s→SIGKILL 节奏不对称。另:超时只击杀直接子进程,opencode 的孙进程在硬杀后成为孤儿泄漏(docs 已记录为接受,但组杀可零成本消除)。附带:`runDefaultSubprocess` 无上限累积整路 stdout 且每 turn 全量重解析取 session/usage(跨 turn O(n²)),而数据在流式解析时已经过一遍。

## What Changes

- **终止升级**:`runDefaultSubprocess` 改为 `detached: true` 启动(子进程自成进程组);墙钟/不活跃超时仍先仅对父进程发 SIGTERM(保留 opencode 优雅清理),10s 宽限(kill grace,固定值,`runDefaultSubprocess` 可选参数注入、不进配置)后仍未退出 → **进程组 SIGKILL**(`kill(-pgid)`);abort 路径(stall 兜底/daemon 停机)由"仅父进程 SIGKILL"升级为**直接进程组 SIGKILL**;正常退出清除宽限定时器。宽限期间子进程恢复输出不撤销击杀;宽限定时器幂等只设一次。
- **stdout 有界累计**:逐行解析时增量累计 `sessionAndUsage`;原始 stdout 只保留尾部 64KB;`SubprocessResult` 新增可选 `sessionAndUsage`,`runAttempt` 取值 `result.sessionAndUsage ?? extractSessionAndUsage(result.stdout)`(注入式 spawnRunner seam 零影响)。
- **文档**:`timeout-model.md`(zh/en)重写升级语义与场景 4/5;`architecture.md`(zh/en)三层摘要同步;核对 6 个 WORKFLOW 模板的 stall 注释;新增 ADR 0020 记录推翻"不升级"立场的原因与被否项。

## Capabilities

### New Capabilities

(无)

### Modified Capabilities

- `opencode-worker`:ADDED requirement "终止升级与进程组击杀"(既有"不活跃超时"等 requirement 的 SIGTERM 首选语义不变,升级是其后置阶段);stdout 有界累计为实现细节(seam 兼容、无行为变化),不进 spec。

## Impact

- 代码:`src/worker/runner.ts`(`runDefaultSubprocess` spawn/击杀/宽限/累计、`SubprocessResult`、`runAttempt` 取值)。
- 测试:`tests/worker.test.ts` 新增升级路径用例(真子进程 `trap TERM` + 小宽限参数)。
- 文档:`docs/{zh,en}/timeout-model.md`、`docs/{zh,en}/architecture.md`、6 个 `WORKFLOW*.md.example` 注释、`docs/adr/0020-*.md`。
- 行为变化:拒签子进程的 slot 占用从"无限/2h"降为"超时+10s";硬杀不再留孤儿(孙进程随组终止)。
