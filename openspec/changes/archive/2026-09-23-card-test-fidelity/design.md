## Context

卡片化复盘（2026-09-22）定位出四类结构性盲区：测试绕过真实入口（接缝盲区）、断言"做了什么"而非"用户看到什么"（同源盲区）、mock 按想象构造（平台现实盲区）、缺重复交互场景（时序盲区）。本 change 把对策固化为可执行的基建与规约。关键约束：生产代码零改动；需人介入的环节（真机冒烟）不得成为硬门禁；规范要有确定性的被读位置（AGENTS.md + 生成源头技能），而非散落在众多 spec 文件里靠概率命中。

## Goals / Non-Goals

**Goals:**
- 卡片交互的接缝（渲染字段→事件通道路由→去重→handler）有一条每次 CI 必跑的守卫链路。
- mock 输入对齐真实载荷形态（至少回调事件），且建立"fixture 先行 + provenance"的增量规则。
- 面向作者的规则（三场景模板、回访路径、冒烟节奏）落在确定性被读的位置。

**Non-Goals:**
- 不改造存量直调测试；不追溯旧 spec；不为已在工作的交互补 fixture；不设人工硬门禁。

## Decisions

### 1. 回路测试走全保真路径（真实 startEventChannel）
从渲染卡抽取按钮 value，组装原始 `card.action.trigger` 事件，经真实 `startEventChannel`（假 WS client、`handleCardActionData` 入口）分发。**替代方案（否决）**：中保真（直调 handler）——`/agent` 按钮静默失效恰好住在路由接缝上，中保真照样漏；轻护栏（断言卡带 kind）——依赖人记得写，非机制。

### 2. 独立守卫套件，存量测试不动
每卡×每按钮一遍全链作为接缝契约；直调测试继续负责 handler 逻辑细粒度。**替代方案（否决）**：全量改写——churn 大、变慢、丢粒度，接缝守卫只需每卡一遍。

### 3. fixture 首批只收回调事件两形态，增量收取
`card.action.trigger` 带/不带 `operator.name` 各一（无 name 形态直接对应"操作人 ou_xxx"事故）。头部 provenance 字段区分 `captured`/`documented`；实现时经一次真实点击校验升级。其余载荷（merge_forward、post 带图）下次触碰时按规则收取——避免为凑数反复打断用户。

### 4. 作者规则进 AGENTS.md（单一事实源），propose 技能引用不复制（2026-09-23 修订：技能注入部分被 `55b9357` 推翻——所有者决定通用技能保持平台中立，执行点收敛为 AGENTS.md 单处）
三场景模板、fixture 先行、回访路径为强制（agent 单方可执行）；真机冒烟为 opt-in（开工时三选一：每 slice/批量/仅收尾，默认仅收尾）。`.opencode/skills/opsx-propose-with-tdd/SKILL.md` 注入检查清单但引用 AGENTS.md 原文，避免双份漂移。**替代方案（否决）**：规则写入 `openspec/specs/test-guidance/spec.md`——横向元规范在做具体 change 时不必然被打开，约束链是虚的。

### 5. spec 只陈述套件的覆盖不变量
test-guidance 的 delta 仅要求"按钮行为由回路测试守卫、新按钮必进套件"——这是可验证的测试覆盖事实；写作模板本身不入 spec。归档时正常合并（变更非 `--skip-specs`）。

### 6. 取舍记录为 ADR 0025
"卡片交互以回路测试与真实载荷为准"满足难逆转/无上下文会困惑/真实取舍三条件，立 ADR；冒烟节奏与回访路径为易逆转流程约定，AGENTS.md 足矣，不立。

## Risks / Trade-offs

- [回路套件运行成本] wiring 较重 → 每文件共享一个 wiring 实例，纯假件、无外部依赖，进默认 `npm test`。
- [技能与 AGENTS.md 漂移] → 技能只引用不复制，AGENTS.md 为唯一事实源。
- [fixture 长期停留在 documented] → provenance 可见 + 首次真机接触时升级的规则兜底。

## Migration Plan

纯增量，无迁移；回滚即 revert。守卫套件上线后，新按钮未进套件会在 code review 而非 CI 暴露（spec 与 AGENTS.md 双处约束）。

## Open Questions

None（访谈已决）。
