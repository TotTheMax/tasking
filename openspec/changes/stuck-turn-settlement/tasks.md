## 1. 契约证据（fixture 先行）

- [x] 1.1 真机捕获「turn 进行中」的 `session.get`（同一 session 的续轮，prompt 后 / 结束前各抓一份），用中途那份覆盖 `tests/fixtures/opencode-v2/rest/session-get-running.json`，并在 `tests/fixtures/opencode-v2/provenance.md` 记录语义（`time.idle` 是否保持上一轮值、`outcome` 是否沿用上轮）
- [x] 1.2 解析 `time.idle`（先写失败测试：`tests/driver-session-ops.test.ts` 用捕获载荷断言 `getSession` 返回 `idleAt`、缺失时为 `null`；再在 `src/driver/session-ops.ts` 的 `SessionInfo` 增加 `idleAt` 并从 `time.idle` 读入；`tests/helpers/opencode-fixtures.ts` 增加派生自捕获的构造器）

## 2. 结算信号（驱动）

- [x] 2.1 锚点掉出分页窗口后仍能结算（先写失败测试：`tests/driver-turn.test.ts` 构造「先有 prompt，随后页内只剩新的 idle+assistant」两页，断言 succeeded；再改 `turn-driver.ts` 的锚点判定：锚点不在页内时回退到基线 idle/assistant）
- [x] 2.2 会话级 `time.idle` 作为完成信号（先写失败测试：锚点从未出现，`idleAt` 前进 + 基线外 assistant → succeeded；`idleAt` 缺失时退回基线通道；再实现信号合流）
- [x] 2.3 产出护栏（先写失败测试：`idleAt` 前进但基线外没有 assistant（僵尸迟到 idle）→ 不结算；有未 settle assistant → 不结算；再在 `runTurn` 中把护栏应用到两条通道）
- [x] 2.4 结算原因可回传（先写失败测试：三种路径分别断言 `settledBy`/`anchorSeen`；再在 `TurnResult` 增加 `settledBy`、`promptMessageId`、`anchorSeen` 并在各返回点填值）

## 3. 计时器与审批预算

- [x] 3.1 无输出超时不再依赖 prompt 登记（先写失败测试：prompt 从未出现在消息页、此后零活动超过 `inactivityTimeoutMs` → `timed_out`/`inactivity_timeout`；改写现有「prompt 仍在服务端排队时不计时」用例；再删除 `turnStarted` 门禁）
- [x] 3.2 自动 reject 后无进展收尾（先写失败测试：pending 持续存在且无新消息，15 个轮询周期后以 failed 结算；再修改 progress 判定：`pending > 0` 不再计数）
- [x] 3.3 累计审批等待硬上限（先写失败测试：pending 反复申请/反复 reject，累计达 `2 × permissionTimeoutMs` → `timed_out`/`permission_timeout`；再用 `waitAccumMs` 实现上限）
- [x] 3.4 `permission_timeout` 文案（先写失败测试：`tests/direct-sessions.test.ts` 断言超时回复含「审批超时」；再在 `src/direct/manager.ts` 映射原因并补 `src/translate/dict.ts` 词条）

## 4. 卡片交付韧性

- [x] 4.1 可重试失败不再整轮禁用卡片（先写失败测试：一次 5xx/网络错误后恢复，断言后续 flush 仍更新同一张卡、且不投递降级文本；再改 `flushTurnCardInner` 的 `cardsAvailable` 语义）
- [x] 4.2 终态退避重试（先写失败测试：终态首次更新失败后第二次成功，断言收到完成态；再在 `finalizeCardPhase` 增加 3 次退避重试）
- [x] 4.3 终态全部失败补文本（先写失败测试：终态 3 次均失败，断言话题内出现「本轮已结束（卡片更新失败）」；再实现兜底消息）
- [x] 4.4 不可重试错误保持即时降级（既有用例保持通过，确认 4xx 只尝试一次并进入文本降级）

## 5. 可观测

- [x] 5.1 `direct turn finished` 字段（先写失败测试：日志行含 `settled_by`/`anchor_seen`/`error`/`duration_ms`/`tools`；再在 `manager.ts` 落地）
- [x] 5.2 锚点丢失告警（先写失败测试：锚点曾出现但当前页不再包含时恰好一条 WARN，下一轮可再记一条；再实现每轮一次的计数）
- [x] 5.3 `prompt_message_id` 落日志（先写失败测试：finished 行包含 prompt 消息 id，且不包含完整 prompt 文本；再接入）

## 6. 领域模型与文档

- [x] 6.1 新增 `docs/adr/0043-turn-completion-by-session-idle.md`（决策、被否决方案：粘性锚点/时间戳/`limit=200`/翻页；Consequences：护栏与兜底）
- [x] 6.2 `CONTEXT.md` 更新：精化 **Turn**（覆盖直连）、**Segment card**（封段为不可变快照）、新增 **Idle record** 与 **Turn settlement**
- [x] 6.3 `docs/{en,zh}/configuration.md` 与 `docs/{en,zh}/architecture.md`：`inactivity_timeout_ms` 自 prompt 提交计时、`permission_timeout_ms` 的累计硬上限、结算信号说明
- [x] 6.4 8 个 `assets/workflows/WORKFLOW*.md.example` 的 `inactivity_timeout_ms` 注释：把 v1 的「stdout/stderr / SIGTERM」改为 v2 的「轮询期间无新消息」

## 7. 门禁

- [x] 7.1 `npm run lint`、`npm run typecheck`、`npm test` 全绿（含 `tests/driver-turn.test.ts`、`tests/driver-session-ops.test.ts`、`tests/direct-sessions.test.ts`、`tests/worker.test.ts`）
- [x] 7.2 `npm run test:integration`（真飞书 + 真 opencode）；不可达时在交付说明里写明原因
- [x] 7.3 真机长 turn 冒烟：跑一个必然 >50 条消息的 turn（如逐个 cat `docs/adr`），确认正常收口、`settled_by` 非 `anchor`、卡片终态正确（2026-11-20 驱动层真机：55 次工具调用 → `settledBy=baseline_idle`、`anchorSeen=true`、锚点丢失 WARN 恰一条、172s 收口；卡片终态由 `integration-turn-card` + 单测终态重试用例覆盖）
- [x] 7.4 `tests/docs-links.test.ts` 双语 parity 与链接全绿；`openspec validate stuck-turn-settlement --strict` 通过
