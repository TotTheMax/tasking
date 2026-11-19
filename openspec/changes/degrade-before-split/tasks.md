## 1. 渲染层：降级封顶、输入截断、移除 level 3

- [x] 1.1 降级阶梯封顶 level 2（先写失败测试：`tests/direct-card.test.ts` 断言大量面板时从最旧开始 15→3→无 Output、Args/Command 仍在、卡片里没有「未展示」标记、面板数量不减少；再在 `src/direct/card.ts` 把降级目标从 `[1,2,3]` 改为 `[1,2]`，删除 level 3 分支与「还有 N 个工具调用未展示」元素）
- [x] 1.2 输入截断（先写失败测试：Command/Args 超过约 2KB 时截断并带 `…`；整卡仍超时继续截断到刚好装下，面板保留；再在 `renderPanelBody` 实现固定上限 + 动态截断）
- [x] 1.3 文本保持完整（先写失败测试：长文本不被固定字符数截断；单条文本自身超预算时才截断到预算内；再确认/调整 `renderCard` 与 `truncateSingleTextToFit`）

## 2. 装箱层：先降级、后分段、保最新完整

- [x] 2.1 单卡「前缀降级 + 完整尾部」尝试（先写失败测试：约 20 个工具、完整明细超预算但降旧面板后能装下 → 仍是一张卡，最旧无 Output、最新保持 15 行；再在 `src/direct/manager.ts` 实现「找最大完整尾部 S + 前缀降到 ≤2 后一张卡」）
- [x] 2.2 密集历史前缀 + 完整尾部切段（先写失败测试：61 个工具 → 一张或多张密集历史卡 + 一张完整尾部卡，所有工具都出现、无「未展示」标记、历史卡无按钮；再实现前缀按 level ≤2 贪心装箱、可一次 flush 创建多张历史卡）
- [x] 2.3 元素数上限触发切段（先写失败测试：约 56–60 个工具、字节未超但估算元素 >180 → 在装满前切段；再接回 `cardFits` 的元素估算）
- [x] 2.4 实时降级（先写失败测试：连续产生事件时，旧面板先失去 Output、最新面板保持完整；只有降到无输出仍装不下才出现新卡；再实现 flush 中的降级优先路径）
- [x] 2.5 本段/本轮计数（先写失败测试：多段轮次每张卡正文第一行显示 `🔧 本段 X · 本轮 Y`；单卡轮次仍为 `🔧 Y`；再在 `TurnCardState`/`renderCard` 增加本段工具数并渲染）
- [x] 2.6 边界回归（先写失败测试：单条超大工具独占一个分段并只保留截断后的输入；单条超大文本截断；切段封存失败/建段失败仍按既有路径降级文本且不丢事件；再确认实现）

## 3. 文档与决策

- [x] 3.1 新增 `docs/adr/0042-degrade-before-split.md`（降级优先、分段兜底、永不丢面板；记录与 ADR 0041 的关系与被否决方案），并在 ADR 0041 顶部加 `amended by ADR 0042` 指针
- [x] 3.2 `CONTEXT.md` 新增 **Panel degradation（面板降级）** 术语（_Avoid_: 卡片降级、截断、压缩、隐藏），并与 **Card fallback（整卡文本降级）** 区分
- [x] 3.3 更新 `docs/{zh,en}/architecture.md`、`docs/{zh,en}/usage.md`、`docs/{zh,en}/configuration.md`：改为「旧面板降级优先、仍装不下才分段；最新卡完整；本段/本轮计数」；确认 `tests/docs-links.test.ts` 双语门禁绿
- [x] 3.4 翻译字典（先写失败测试：`tests/translate-coverage.test.ts` 覆盖新文案；再改 `src/translate/dict.ts`：新增 `本段 X · 本轮 Y` 的 pattern 与对应英文，移除「还有 N 个工具调用未展示」条目及 `tests/translate.test.ts` 中对应断言）

## 4. 真机 smoke

- [x] 4.1 扩展 `tests/integration-turn-card.test.ts`：在交错卡、近 24KB 更新、续段卡之外，再发一张 **50 个面板的密集卡**（输入保留、无输出），验证元素上限下真实飞书仍接受；用 `INTEGRATION=1 TURN_CARD_SMOKE=1 npm run test:e2e` 实跑

## 5. 门禁与验收

- [x] 5.1 定向测试：`npx vitest run tests/direct-card.test.ts tests/direct-sessions.test.ts tests/card-roundtrip.test.ts tests/translate-coverage.test.ts tests/docs-links.test.ts tests/feishu-source.test.ts`
- [x] 5.2 `npm run lint` + `npm run typecheck`
- [x] 5.3 `npm test` + `npm run build`
- [x] 5.4 `npm run test:e2e`（mock 部分）+ 真机 smoke（带门禁）
- [ ] 5.5 人工冒烟（final-only，非阻塞）：真实长轮次确认单卡密度、旧面板降级、最新完整、`本段/本轮` 计数
- [x] 5.6 `openspec validate degrade-before-split`；确认归档顺序：先 `segment-turn-cards`，再本 change
