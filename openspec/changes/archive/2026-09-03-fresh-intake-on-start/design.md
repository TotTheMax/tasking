# Design: fresh-intake-on-start

## Context

切回旧机器运行 tasking 时，本地 `bindings.db` 是机器本地的持久化（ADR 0016/0018 明示），不会随换机迁移：新机器从空 db 冷启动（探测游标锚定到飞书时钟），旧机器却带着落后的 `intake_cursor` 回来。intake 游标只在 Sweep（启动 / WS 重连 / 12h 定时器）时推进，事件模式下可落后很远；旧机器一重启，启动即 Sweep 的 `discoverIntake` 会把「游标之后」的全部根消息当新消息重放，其中新机器已消费的 `/issue` 在旧机器本地无 binding → 重复建单 → 调度器重复派发「已完成的任务」。

Jira 调度器本身在新/旧机器上无行为差异（只拉 active 态；终态不成为候选），故修复落在桥的本地持久游标。Grill 已确认（GQ1=机制成立、GQ2=方案 b、GQ3=`--fresh`）：重放是根因，选项语义 = 清 intake 游标 + binding 与 Jira 现状对账。

## Goals / Non-Goals

**Goals:**
- 旧机器用 `tasking start --fresh` 后不再重放停机窗口内的 intake 历史（行为等同 ADR 0016 的新机器冷启动：只消费当前时刻起的新消息）
- 旧机器自己仍 active/review 的线程镜像不误杀，只在 issue 已完结/消失时停止镜像
- 改动收敛在桥启动路径 + CLI option + 帮助/文档，不碰调度器与事件通道

**Non-Goals:**
- 自动检测「机器切换」——`--fresh` 是一次性显式 option，不做启发式判断
- 全量删除本地 `bindings.db`（Grill GQ2=方案 b 否决 c）：旧机器自己仍活着的线程镜像应保留
- 过滤 Jira 调度器对存量 active 态 issue 的接管（GQ1 确认属正常行为）
- bindings 外置 / 迁移 db 文件（ADR 0016 已否决）

## Decisions

### D1: 复用既有冷启动探测路径，只删游标（GQ2 方案 a 的机制）

`freshStartReset` 第一件事是 `bindings.deleteMeta("intake_cursor")`，把游标置回「空」。`discoverIntake` 已有「游标为空 → 冷启动探测（带窗 now-120s，只记不处理）」分支，无需新增探测逻辑。理由：零新代码路径、行为与新机器逐位一致、已被 `tests/comment-bridge.test.ts` 冷启动用例覆盖。

### D2: binding 对账 = 终态/缺失标 terminal、其余保留（GQ2 方案 b）

对每个 active binding，用一次 `tracker.fetchIssueStatesByIds(ids)` 批量取状态（Jira 侧单次 search，不逐条打 API）：状态属 `terminal_states` → `markTerminal`；id 不在返回集（issue 已删/换 project 不可见）→ 同样 `markTerminal`（语义等同既有 `isJiraNotFound` 的「binding cleaned」）；仍 active/review → 保留。**对账失败（fetch 抛错）时保守跳过、全部保留**，只 WARN——新机器语义是「接管现状」，网络抖动不应误杀镜像。

### D3: CLI `--fresh` 只在 feishu.enabled 时接线，否则提示 no-op（GQ3）

`runStart` 解析 `--fresh`；`feishu.enabled=false` 时打印一行提示（说明该 option 只在启用飞书桥时生效）后照常以 0 继续，不报错。启用时在 `bridge.start()`（内部 scheduleSweep(0)）**之前** `await bridge.freshStartReset()`，保证首次 Sweep 就按新机语义跑（清游标 → 探测轮），杜绝「先重放后重置」的窗口。与 `--detach`/`--tui` 正交（`--detach` 子进程继承 args，`--fresh` 随之传递）。

### D4: 命名与帮助文案（GQ3）

option 名 `--fresh`；help 描述：「以新机器方式启动飞书桥：丢弃本地入站游标并在 Jira 现状对账过期绑定，不回放停机窗口内的历史消息（走冷启动探测）」。CLI help 单源在 `src/cli/help.ts`（ADR 0008）。

## Risks / Trade-offs

- **[停机窗口内「两台机器都没消费」的消息被跳过]** → 与 ADR 0016 新机器冷启动取舍一致（120s 窗口外不消费），`--fresh` 接受同一语义；`/issue` 重建需人工补发
- **[对账把「换 project/暂时不可见」的 issue binding 误标 terminal]** → 概率低；可逆（`/state` 或重新 dispatch 会 `markActive`，见 `onDispatch`/`executeState`）
- **[`--fresh` 被当作日常重启开关滥用]** → help/文档明示它是「换机器回来」的一次性操作，非日常重启；日常重启仍靠持久游标续拉

## Migration Plan

1. 实施期（单 PR）：`deleteMeta` + `freshStartReset` + CLI `--fresh` + help + 测试，一次合入
2. 部署期：升级二进制即可；无配置迁移、无 db 迁移、lockfile 不变（不需要 pack-deps）
3. 回滚：git revert 即回；游标/binding 语义未变，双向兼容
