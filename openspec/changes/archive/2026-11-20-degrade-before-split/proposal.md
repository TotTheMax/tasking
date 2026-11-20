## Why

分段卡片上线后，长轮次的每一张卡只能放 10–20 个工具（每个面板都保留完整 15 行输出），用户需要翻几张卡才能拼出「agent 到底干了什么」。旧实现虽然把旧面板的输出降级甚至丢弃，但一张卡能扫到 40–50 个工具，更接近「过程索引」的直觉。

本次把两者结合：**先降旧面板的输出，仍然装不下才切段；永不丢面板，最新内容保持完整。** 这样一张卡能重新装下几十个工具（输入都在），最新几步仍有完整输出，超出部分在下一张卡上完整呈现。

## What Changes

- **降级优先于切段**：卡片超预算时，按最旧优先把工具面板的输出 15 行 → 3 行 → 去掉（**始终保留 Args/Command**），新事件继续以完整明细加入同一张卡。
- **密度优先**：整组降到无输出能装下就保持一张卡；最新面板尽可能保留细节，但不为它切出多张短历史卡。只有整组降级仍装不下才切段，切段时最新尾部在新卡上从完整明细开始。
- **输入截断**：level 2 下单个面板的 Command/Args 上限约 2KB，仍装不下继续截断到刚好放下；**永不丢面板**。
- **移除 level 3**：删除「丢弃整个面板」和「… 还有 N 个工具调用未展示」标记；极端情况由现有 Card fallback（整轮文本）兜底。
- **装箱规则**：先试整组完整明细；再试「旧前缀降级 + 最新完整尾部」一张卡；仍装不下时，按密集容量（level ≤2）把前缀贪心装箱成一张或多张历史卡，最新的完整尾部作为最后一张卡；不设段数上限。
- **计数文案**：多段轮次的正文第一行改为 `🔧 本段 X · 本轮 Y`（英文 `X this card · Y turn`）；单卡轮次保持 `🔧 N`。
- **文本不降级**：assistant 文本保持完整，只有单条文本自身超预算时才截断。
- **BREAKING（展示）**：长轮次的展示会从「多张完整明细卡」变为「密集历史卡 + 完整最新卡」，无需迁移配置或数据；`verbosity: summary` 仍是回退手段。
- 不新增配置键、数据库列或 feature flag。

## Capabilities

### New Capabilities

（无——全部为既有 capability 的需求变更）

### Modified Capabilities

- `direct-sessions`: 轮次卡片的溢出策略从「优先分段、降级只兜单条」改为「降级旧面板输出优先、全部降到无输出仍装不下才分段」；保证永不丢面板、最新面板尽量保留细节；多段轮次显示本段/本轮工具计数。

## Impact

- 代码：`src/direct/card.ts`（降级阶梯封顶 level 2、输入截断、移除 level 3/未展示标记、本段计数）、`src/direct/manager.ts`（实时降级与切段装箱、完整尾部保护）
- 配置：无新增键、无默认值变更；`feishu.direct.verbosity` 语义不变
- 数据：无迁移；`direct_sessions.card_message_id` 与段边界策略不变
- 文档：`CONTEXT.md` 新增 **Panel degradation（面板降级）**；`docs/adr/0042-degrade-before-split.md` + ADR 0041 amended 指针；`docs/{zh,en}/{architecture,usage,configuration}.md`；`openspec/specs/direct-sessions/spec.md`
- 测试：`tests/direct-card.test.ts`、`tests/direct-sessions.test.ts`；`tests/integration-turn-card.test.ts` 增加 50 面板密集卡的真机 smoke；`tests/translate-coverage.test.ts` / `tests/docs-links.test.ts` 门禁
- 门禁：`npm run lint` / `typecheck` / `test` / `build` / `test:e2e` / `INTEGRATION=1 npm run test:integration`（真实 API 测试的唯一入口，内含 turn-card smoke）；人工冒烟为 final-only
