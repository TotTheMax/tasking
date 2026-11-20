## Context

`DirectSessionManager` 目前用 `dirSlots: Map<string, { busy: boolean; waiters: Array<() => void> }>` 对每个 realpath 施加互斥：`runTurnLoop` 在 `startTurnCard` 之后、`executeTurn` 之前 `await acquireDir(session.path)`，`finally` 释放；`busy = activeTurns >= max_concurrent || dirSlotFor(path).busy` 决定卡片是否显示“排队中”。ADR 0022 将 per-directory serialization 定为强制约束，理由是同一工作树上的两个 opencode turn 会抢 git index / 文件锁。

真实需求是同目录多个只读/轻量话题不必互相等待；tasking 无法可靠判断“只读”（agent 仍可 edit/shell），因此把选择权交给用户，并保持默认安全。

## Goals / Non-Goals

**Goals:**

- 提供显式配置 `feishu.direct.max_concurrent_turns_per_dir`，默认 1，按 realpath 限制每目录并行 turn 数
- 默认行为与现状完全一致；放开后 FIFO、全局预算、卡片状态语义保持一致
- 放开与生效过程可观测：启动/热重载 WARN、每轮日志字段、`/api/v1/state` 的 `direct_dirs`
- 决策与术语落档：ADR 0040、ADR 0022 Status、CONTEXT.md

**Non-Goals:**

- 按项目覆盖（`projects.<name>.max_concurrent_turns_per_dir`）
- 只读任务识别、读写锁、只读 ruleset
- 动态扩容时主动唤醒排队者
- TUI 展示目录占用；doctor/init 新交互
- 改变全局 `feishu.direct.max_concurrent` 或 Jira 的并发预算

## Decisions

1. **数字型全局键，默认 1。** 名称 `max_concurrent_turns_per_dir`：与 `max_concurrent` 同族，`turns` 明确单位，`per_dir` 明确作用域，避免与 `agent.max_turns`（每 attempt 总 turn 数）混淆。备选：`max_concurrent_per_dir`（更短但单位靠上下文）、布尔 `allow_same_dir_parallel`（无中间档，一开就到全局上限）、删锁（对所有部署默认不安全）。
2. **布尔互斥改计数信号量。** 按 realpath 维护 `{ active: number; waiters: Array<() => void> }`；`acquire` 时 `active < limit` 则占用，否则入 FIFO；`release` 时有 waiter 且 `active <= limit` 则移交（`active` 不变），否则 `active--`。严格 FIFO、不抢占、一次 release 移交一个 waiter。
3. **上限每次 acquire/release 现读配置。** `dirConcurrencyLimit() = max(1, floor(config.feishu.direct.max_concurrent_turns_per_dir))`。热重载只影响之后进入的 turn；已排队的 waiter 在下一次 release 时按新值判断；limit 调大不主动唤醒 waiter（新来的 turn 可先占用新增槽位）；调小到低于 `active` 时不再放新 turn 进入，直到 `active < limit`。
4. **取更严者。** 目录上限只放宽目录维度；`feishu.direct.max_concurrent` 仍是全局硬上限，`busy` 与执行判断均取 `active >= limit || activeTurns >= max_concurrent`。
5. **审批等待继续占槽。** 挂起等审批的 turn 尚未结束，释放槽位会允许别人在“暂停”期间改工作树，恢复后可能对着已变化的文件执行被批准的操作；重新排队也引入顺序/公平复杂度。用户显式调大上限即接受一个审批卡占用一个名额。
6. **取值语义。** 整数 ≥1；`2.9 → 2`；`0`/负数/非数字 → 回退 `1`（不把 `0` 解释为无限制，避免非法输入静默全开）；无显式上限，由全局 `max_concurrent` 兜底。
7. **可观测性。** `>1` 时 `DirectSessionManager.start()` 记一条 WARN（字段 `max_concurrent_turns_per_dir`；若 `auto_approve: true` 追加“并发 turn 可在无提示下写文件”）。通过 `ConfigManager.onReload` 监听热重载：`≤1 → >1` 再记一次同样的 WARN，回落到 1 不记。每轮 `direct turn starting` 增加 `max_concurrent_turns_per_dir` 字段。现有“排队中”文案不改。
8. **`/api/v1/state` 的 `direct_dirs`。** `RuntimeSnapshot` 顶层新增始终输出的数组（空为 `[]`），元素 `{ path, active, limit, waiters }`：
   - 只含有活动的目录（`active > 0` 或 `waiters > 0`），空闲目录从内部 map 清理；
   - `path` 为 realpath；`active` = 已占用的目录槽位（含占槽但在等全局名额的 turn）；`waiters` = 仅等目录槽位的 turn；`limit` = 该目录生效上限；
   - 按 `path` 升序输出，保证快照稳定、测试可断言；
   - TUI 不消费该字段；`tasking status` 不改。
9. **spec 组织。** 重命名 “运行中追问排队、同目录串行” → “运行中追问排队、同目录并发预算”（RENAMED + 完整 MODIFIED）；新增 “直连目录占用可观测”；修改 “feishu.direct 零配置默认可用”的默认值清单加入 `max_concurrent_turns_per_dir: 1`。
10. **记录取舍。** ADR 0040 说明默认仍是串行、放开是用户责任、拒绝删锁/布尔/按项目/自动只读；ADR 0022 加 Status 标注 amended；CONTEXT.md 增加术语 **Per-directory turn limit (目录并发上限)**，`_Avoid_: Directory lock, parallel chat, same-dir parallelism`。
11. **模板与漂移。** 8 个模板（4 变体 × 中英）加 `max_concurrent_turns_per_dir: 1` 与注释，并修正 `max_concurrent` 旁“同目录始终串行”的措辞。`en-templates` 的默认键覆盖测试会强制所有模板包含该键；已有 WORKFLOW 的 `--update` 漂移报告会出现该键（仅报告，不写入），接受。
12. **测试切面。** 配置解析（默认/显式/取整/非法回退）、调度（默认串行、limit=2 三会话前二并行第三 FIFO、全局上限更严、审批占槽、热重载下一轮生效）、WARN（启动/热重载/`=1` 不告警）、日志字段、快照（形状/语义/空数组/清理/排序）、模板默认值。卡片按钮回路测试不需要（无新按钮）。

## Risks / Trade-offs

- [同目录并发写导致工作树损坏/丢失改动] → 默认 1；文档与启动/热重载 WARN 明确风险；写任务建议用 worktree；tasking 不做内容级隔离。
- [用户误以为 >1 等于安全] → 配置名直白、WARN 点明共享工作树、文档写明“用户显式调大即自担竞态”。
- [热重载 limit 变化语义不直观] → 只对之后进入的 turn 生效；文档与 design 明确“不主动唤醒”。
- [计数实现槽位泄漏] → `runTurnLoop` 的 `try/finally` 保证 release；测试覆盖三会话、limit=2 的移交与收尾；空闲目录清理避免 map 无限增长。
- [`direct_dirs` 暴露路径] → 与既有 `direct[].path` 一致，未新增敏感信息；只含活动目录。
- [新键进入 `--update` 漂移报告] → 仅提示、不写文件；接受，避免为单键加漂移例外。
- [全局上限掩盖配置效果] → 测试覆盖 `max_concurrent` 更小时仍串行；文档写明取更严者。

## Migration Plan

纯增量发布：默认 `1` 无行为变化，无配置/数据迁移。回滚 = 将配置改回 `1` 或 revert；`direct_dirs` 为新增字段，旧消费者忽略。`--update` 仅报告新键。
