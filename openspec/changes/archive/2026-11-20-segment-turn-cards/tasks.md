## 1. 事件模型与顺序渲染（Slice 1）

- [x] 1.1 引入 `TurnCardEvent` 与单一 `events` 数组（先写失败测试：`tests/direct-card.test.ts` 断言文本 A、工具 T1、文本 B、工具 T2 在卡片 `body.elements` 中按 A→T1→B→T2 出现；再在 `src/direct/card.ts` 定义 `{kind:"text"|"tool"}` 联合类型、`renderCard` 顺序遍历，删除 `texts`/`tools` 字段）
- [x] 1.2 manager 聚合改为事件流（先写失败测试：`tests/direct-sessions.test.ts` 经注入的 Feishu mock 观察运行中卡片的元素顺序；再改 `accumulateTool`、`onEvent` 的 text 分支、`startTurnCard`、`finalizeStoredCard`、`permissionCard`、`handleLifecycleAction` 与 `stop` 分支的卡片回包）
- [x] 1.3 取消按条 400 字截断（先写失败测试：一条 800 字文本在预算内完整渲染；一条自身超预算的文本才被截断；再改 `renderCard` 的文本渲染）
- [x] 1.4 保持「完成时省略最后一段文本」（先写失败测试：成功完成的过程卡片不包含最后一个 text 事件、失败/中断时保留；再改 `finalizeTurnCard` 在 `dropFinalText` 时移除最后一个 text 事件）
- [x] 1.5 卡片降级文本适配事件流（先写失败测试：卡片不可用时合并文本按事件顺序、只包含尚未上卡的工具、不重复；再改 `flushTurnCardInner` 的 `pending` 计算与 `toolTextLines` 输入）

## 2. 分段（Slice 2）

- [x] 2.1 精确预算与元素估算（先写失败测试：同一中文卡片按 envelope UTF-8 字节显著大于字符数；`12 + Σ(text?1:3)` 的元素估算在已知输入上等于字面量；再在 `src/direct/card.ts` 导出 `cardPayloadBytes`/`estimateCardElements`/`cardFits`，在 `src/direct/manager.ts` 用同一表达式判断）
- [x] 2.2 切分主流程（先写失败测试：一段接近 24KB 后加入新事件 → 出现第二张卡；旧段封存且不含被弹出事件；新段从被弹出事件开始；不复用旧卡 id；再在 `flushTurnCardInner` 实现「渲染 → 逐段装箱 → 封存 → 建新段」）
- [x] 2.3 元素数触发切段（先写失败测试：事件体积未超 24KB 但估算元素数 > 180 仍产生新段；再接入第二触发条件）
- [x] 2.4 footer 与片段标记（先写失败测试：中途封存卡片 footer 为「— 本段结束，续见下一条卡片 —」、轮末为「— 该轮已结束 · Ns · ≈N —」；第二张起头部含 `· 片段 2` 且其余字段不变；再实现 `continued` 标记与头部拼接）
- [x] 2.5 按钮只属于活跃段（先写失败测试：旧段卡片无任何按钮、最后一张有 `🔁/📄/🔐/🛑`；`📄` 只出现在最后一张；再改 `renderFooter` 与分段状态传递）
- [x] 2.6 活跃段动作守卫（先写失败测试：`tests/card-roundtrip.test.ts` 从旧段卡片抽取按钮 value、经真实事件通道路由，断言只回「该片段已结束」toast 且会话状态不变；再在 `handleCardAction` 对 `stop`/`retry`/`full` 比较 `action.messageId` 与活跃段 `cardId`）
- [x] 2.7 单条超预算的兜底（先写失败测试：段内仅一条事件且自身超预算时走「15 行 → 3 行 → 去输出」或（单条文本）截断到预算内，不产生空段、不无限开卡；再实现该分支）

## 3. 稳健性与错误分类（Slice 3）

- [x] 3.1 限流/交互中按可重试处理（先写失败测试：注入 `updateCard` 抛 `feishu_api_status`（HTTP 400，body `code: 230020`）一次后成功，断言延迟重试后卡片继续、未降级为文本；`200810` 同理；再改 `isRetryableCardError` 解析 `details.body` 的业务码）
- [x] 3.2 建段失败降级不丢事件（先写失败测试：切段时第二次 `replyCardInThread` 抛错，断言剩余事件以合并文本投递、旧段保持封存、turn 正常结束；再实现该分支）
- [x] 3.3 既有内存上限不回归（先写失败测试：超过 1MB 工具明细仍从最旧开始丢弃并在 `📄` 文件头注明；再确认 `fullDetail` 累积与 `events` 共享 panel 引用、不额外复制大字符串）

## 4. 文档与决策

- [x] 4.1 新增 `docs/adr/0041-segment-turn-cards.md`（记录「事件顺序是事实来源；溢出优先分段、降级只兜单条」、被否决方案与取舍），并在 `docs/adr/0024-...md` 顶部加 superseded 指针（只加指针，不改原文）
- [x] 4.2 更新 `docs/{zh,en}/architecture.md`、`docs/{zh,en}/usage.md`、`docs/{zh,en}/configuration.md`：把「每 turn 一张卡 + 单轮预算降级」改为「一张或多张分段卡」；客户端口径写成「折叠面板 7.9+；JSON 2.0 结构 7.20+（实际下限）」
- [x] 4.3 更新 `docs/{zh,en}/known-issues.md`：新增「单卡 >5 表格会整卡失败并降级文本」「建段后崩溃可能留下带按钮的孤儿段」两条已知限制
- [x] 4.4 新文案进 `src/translate/dict.ts`（「片段 N」「本段结束，续见下一条卡片」「该片段已结束」等），跑 `tests/translate-coverage.test.ts` 与 `tests/docs-links.test.ts` 确认双语/字典门禁绿

## 5. 门禁与验收

- [x] 5.1 定向测试：`npx vitest run tests/direct-card.test.ts tests/direct-sessions.test.ts tests/card-roundtrip.test.ts tests/translate-coverage.test.ts tests/docs-links.test.ts`
- [x] 5.2 `npm run lint` + `npm run typecheck`
- [x] 5.3 `npm test` + `npm run build`
- [x] 5.4 `npm run test:e2e`（通过）；`npm run test:integration` 已执行但 2 个真实 agent 用例在 `TURN_WAIT_MS` 内未完成（均为 `verbosity: summary`，不经过本次改动的卡片路径；记录为环境/真实服务超时，非本 change 回归）
- [x] 5.5 真机冒烟（final-only，非阻塞）：真实直连会话跑一个跨 24KB 的长轮次，确认文本/工具交错、自动切段、旧段 footer 与无按钮、新段 `片段 N`、`📄` 只在最后一张（已通过：真实 89 工具/≈710k token 轮次 → 3 张分段卡，交错、footer、`片段 2/3` 均符合；旧段无按钮与 `📄` 仅最后一张由 `direct-card`/`card-roundtrip` 覆盖）
- [x] 5.6 `openspec validate segment-turn-cards` 并核对 spec delta 覆盖：交错渲染、分段触发与算法、footer/头部、活跃段按钮与守卫、可重试业务码、无段数上限、非目标清单
- [x] 5.7 真实飞书 turn-card smoke（全自动，并入 e2e）：`tests/integration-turn-card.test.ts` 由 `INTEGRATION=1 TURN_CARD_SMOKE=1 npm run test:e2e` 触发；发送交错卡、近 24KB 更新、续段卡并断言均被接受、线程内至少两张 interactive 消息，卡片保留在测试群作为视觉证据；已实跑通过
- [x] 5.8 补充确定性测试：adapter 实际 body 与预算计量一致性、重启后回退持久化 card id 的守卫、下一轮封存最后一张分段卡、`en` locale 下的分段文案（顺带修复续段 footer 未走 translate 的 i18n bug）
