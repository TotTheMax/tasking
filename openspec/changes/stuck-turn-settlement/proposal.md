## Why

一个真实直连 turn 在 opencode 侧已经正常收尾（TUI 已显示最终总结、会话 `outcome=succeeded`、`time.idle` 已前进）之后，tasking 仍然挂着它 12 小时以上：卡片一直「▶ 运行中」、既不结算也不中断，30 分钟的 `inactivity_timeout_ms` 也没有生效。

根因是三层叠加：

- **完成判定锚定在「prompt 消息还在本页」**。`session.message.list` 默认只返回最新 50 条（实测真实会话 ≈1.15 条消息/工具调用，171 次工具 ≈195 条），长 turn 会把自己的 prompt 挤出窗口；此后 `registered/produced/streaming` 恒为 false/true，idle 与 outcome 两个完成信号全部无法结算。
- **`turnStarted` 同一个 poll 里被置 false**，于是 `inactivity_timeout_ms` 的无输出兜底被就地解除——正好是「会话已经不动了」之后最需要它的时刻。
- **`turn_timeout_ms` 是硬墙钟**，现场配置为 50 小时，接不住。

同时暴露了两个独立缺陷：pending 审批挂起期间两个计时器都暂停，且「有 pending」被算作 progress，使「reject 后 15 个静默 poll 收尾」永远够不到（可无限挂起）；卡片一次可重试更新失败就把本轮卡片更新整轮关死，终态那次失败后再无人重绘。

## What Changes

- **完成信号改为会话级 + 消息护栏**：`session.get` 的 `time.idle`（= 最新 idle 记录的 `created`）前进，且「基线之外至少一条 assistant」「没有未 settle 的 assistant」时结算；prompt 消息锚点在页内仍作为更精确的优选路径，但**不再决定能否结算**。
- **无输出超时无条件计时**：从 prompt 提交起算，任何 `session.updated` 变化/新消息/diff 事件重置；等待审批期间暂停。移除「看到锚点才开始计时」的门禁。
- **审批挂起有界**：pending 存在不再算 progress（恢复「自动 reject 后 15 个静默 poll 收尾」）；累计等待达 `2 × permission_timeout_ms` 时以新的 `permission_timeout` 原因结算，覆盖服务端不理会 reject、模型反复申请同一权限等顽固情况。
- **卡片失败处置**：可重试错误（`fetch failed`/429/5xx）不再把整轮 `cardsAvailable` 关死；终态渲染做有界退避重试（3 次，2s/4s）；最终仍失败时补一条纯文本「本轮已结束（卡片更新失败）」。
- **可观测**：`direct turn finished` 增加 `error` / `duration_ms` / `tools` / `settled_by`（`anchor|baseline_idle|outcome|permission_cap|abort`）/ `anchor_seen`；锚点从页内消失时每轮记一次 WARN；`prompt_message_id` 落日志。
- **契约证据**：真机捕获一份「turn 进行中」的 `session.get`（替换当前名不副实的 `session-get-running.json`），证明 `time.idle` 只在收尾时前进。
- **领域与决策**：新增 ADR 0043（完成判定以会话 idle 记录为准）；`CONTEXT.md` 精化 **Turn**、**Segment card**（封段卡是不可变快照，永不回刷），新增 **Idle record**、**Turn settlement**；`docs/{zh,en}/{configuration,architecture}.md` 与 8 个 `WORKFLOW*.md.example` 的 `inactivity_timeout_ms` 注释修正 v1 残留（stdout/SIGTERM）。
- **明确不做**：分段卡片显示语义（保持快照，不回刷、不加封段时刻）、`limit=200` 或 cursor 翻页、新增配置键、版本号 bump、Jira 侧 stall 语义、同一 session 被外部（TUI）并发 prompt 的归属歧义。

## Capabilities

### New Capabilities

（无——全部为既有 capability 的需求变更）

### Modified Capabilities

- `opencode-v2-driver`: 完成判定从「prompt 锚点在消息页内 + idle」改为「会话 `time.idle` 前进 + 基线护栏」；`inactivity_timeout_ms` 不再依赖锚点登记；审批等待新增累计预算上限与 `permission_timeout` 结算原因；消息分页不再参与完成判定。
- `direct-sessions`: 卡片交付的失败处置（可重试不禁用、终态退避重试、终态文本兜底）与结算可观测字段；明确分段卡片是封段即定格的不可变快照。

## Impact

- 代码：`src/driver/turn-driver.ts`（信号、计时器、审批预算、结果字段）、`src/driver/session-ops.ts`（解析 `time.idle`）、`src/direct/driver.ts`（透传）、`src/direct/manager.ts`（卡片失败处置、终态重试、日志字段）、`src/translate/dict.ts`（`permission_timeout` 文案）
- fixtures：`tests/fixtures/opencode-v2/rest/session-get-running.json`（真机重采集）+ `tests/fixtures/opencode-v2/provenance.md`
- 测试：`tests/driver-turn.test.ts`、`tests/driver-session-ops.test.ts`、`tests/direct-sessions.test.ts`、`tests/worker.test.ts`（共享驱动语义）、`tests/direct-card.test.ts`（如涉及渲染断言）
- 文档：`docs/adr/0043-turn-completion-by-session-idle.md`、`CONTEXT.md`、`docs/{zh,en}/{configuration,architecture}.md`、8 个 `assets/workflows/WORKFLOW*.md.example`
- 门禁：`npm run lint` / `npm run typecheck` / `npm test` / `npm run test:integration`，外加一次真机长 turn 冒烟（>50 条消息，确认 `settled_by` 走回退路径且卡片终态正确）
