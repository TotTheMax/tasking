## Why

本轮卡片化交付的复盘结论：多起仅真机可暴露的缺陷（按钮漏路由判别字段而静默失效、去重误伤重复点击、回调缺 `operator.name` 导致显示裸 open_id）都住在「卡片渲染 → 事件通道路由 → handler」的**接缝**上，而现有测试直调 `handleCardAction` 并手造 value，**结构性绕过这条接缝**；同时 mock 按对平台的想象构造（`operatorName: "张三"`），与真实 payload（name 常缺）存在保真度差距。"测试全绿"只证明代码符合想象。

## What Changes

- **回路测试（round-trip）**：新增 `tests/helpers/card-roundtrip.ts`——从**渲染出的卡 JSON** 抽取按钮 value（`extractButtons`）、组装原始 `card.action.trigger` 事件（`cardActionEvent`，`operator.name` 默认 null）并提供经**真实 `startEventChannel`**（假 WS client）分发的 wiring 构建器。
- **守卫套件**：新增 `tests/card-roundtrip.test.ts`，对每张卡×每个按钮走一遍"渲染→抽取→真实路由分发→断言用户可见结果"（桥：状态卡全流程/刷新连点/取消零写入、评论卡召唤、截断 `📄` 发文件、`/agent` 切换；直连：`/auto`、`/collect`、轮次卡按钮；同一原始事件重投的去重断言）。现有直调测试**保持不动**（直调测逻辑、回路测链路）。
- **真实载荷 fixture**：新增 `tests/fixtures/feishu/card-action-trigger.json`（带/不带 `operator.name` 两形态，头部标 provenance：`documented`，实现时经一次真实点击校验后升级 `captured`）。
- **流程规约**：AGENTS.md 新增「Card interaction rules」小节——三场景模板（强制）、fixture 先行（强制）、回访路径必写（强制）、真机冒烟（**opt-in**：开工时三选一约定节奏，默认仅收尾，永不作为门禁）；`.opencode/skills/opsx-propose-with-tdd/SKILL.md` 注入三场景检查（引用 AGENTS.md，不复制）。
- **术语与决策**：`CONTEXT.md` 增补「回路测试」「回访路径」（访谈中已写入，随本 change 提交）；`docs/adr/0025` 记录"卡片交互以回路测试与真实载荷为准"的取舍。

Explicit non-goals: 不改造存量直调测试为回路形态；不追溯补写已归档 change 的三场景；不为 `merge_forward`/post 带图等已在工作的交互补 fixture（下次触碰时按 fixture-先行规则收取）；真机冒烟不设为硬门禁。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `test-guidance`: 卡片交互的覆盖方式升级——按钮行为除 mock 单测与人工验收外，SHALL 由回路测试守卫（从渲染产物经真实事件通道路由分发），且每个新按钮 SHALL 进守卫套件。（仅陈述套件的覆盖不变量；面向作者的写作规则归 AGENTS.md，不入 spec。）

## Impact

- 新增：`tests/helpers/card-roundtrip.ts`、`tests/card-roundtrip.test.ts`、`tests/fixtures/feishu/card-action-trigger.json`、`docs/adr/0025-card-interactions-verified-by-round-trip.md`。
- 修改：`AGENTS.md`（新小节）、`CONTEXT.md`（术语）、`openspec/specs/test-guidance/spec.md`（归档时合并）；曾修改 `.opencode/skills/opsx-propose-with-tdd/SKILL.md`，归档后被 `55b9357` 回退（技能保持平台中立，规则仅由 AGENTS.md 承担）。
- 除守卫套件首跑抓到的一处真实缺陷修复（`/collect` 卡按钮未携带 `root_id`，生产中点击会静默无效——恰为本 change 针对的缺陷类别，见 tasks 3.7）外，生产代码零改动。
