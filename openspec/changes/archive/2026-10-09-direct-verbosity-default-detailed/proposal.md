# Direct verbosity 默认值改为 detailed（轮次卡片开箱即用）

## Why

`feishu.direct.verbosity` 默认 `summary` 是 ADR 0024 的决定，理由是折叠面板有客户端版本下限（飞书/Lark 客户端 ≥ V7.9，更低版本把面板渲染成「请升级」占位符，服务端无法探测）。实际运行中卡片体验（逐工具折叠面板、失败展开、中断/重试/完整输出/结束按钮、markdown 结果卡）远好于一行统计，团队内客户端版本可控；「老客户端看到降级占位符」应作为**文档写明的版本要求**处理，而不是阻止默认值放开的理由。用户决策（2026-10-09）：默认改为 `detailed`。

## What Changes

- `feishu.direct.verbosity` 默认值 `summary` → `detailed`（`DEFAULTS` 与 resolver 回退同步）；取值集合与校验不变（`quiet`|`summary`|`detailed`），显式 `summary` 仍可回到纯文本交付。
- 全部 8 个 WORKFLOW 模板示例的 `verbosity: summary` 行改为 `verbosity: detailed`，注释同步更新（detailed 描述从过时的「逐条工具调用」改为「每 turn 一张过程卡片」，并注明客户端版本要求）。
- 双语文档（configuration/usage/architecture）同步默认值并写明版本要求：飞书/Lark 客户端 ≥ V7.9 才能渲染折叠面板；更低版本看到「请升级」占位符（不崩溃、结果文本不受影响）。
- 新增 ADR 0032 记录默认值翻转的取舍（修订 ADR 0024「卡片 opt-in」结论），ADR 0024 加一行指针。
- detailed 依赖的一次性控制台配置（`im:resource` scope、`card.action.trigger` 回调订阅，两 bot 各一份）从「启用 detailed 的前置」升级为「启用直连的前置」；未配置时行为不变（降级为合并文本，ADR 0024 兜底路径）。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflow-config`: `feishu.direct.verbosity` 默认值从 `summary` 改为 `detailed`。
- `direct-sessions`: 缺省 verbosity 的交付形状变为「轮次卡片 + 结果卡片」；`feishu.direct 零配置默认可用` 的默认值清单同步。

## Impact

- **代码**：`src/config/config-types.ts`（DEFAULTS）、`src/config/resolver.ts`（回退）。
- **模板**：`assets/workflows/WORKFLOW.*.md.example` × 8。
- **测试**：`tests/config.test.ts`（默认值断言 ×2）、`tests/en-templates.test.ts`（模板解析断言）、`tests/direct-sessions.test.ts`（`directConfig()` helper 显式钉住 `summary` 保持既有用例语义；「default verbosity 不发卡」用例改名并显式 `summary`）。
- **文档**：`docs/{zh,en}/configuration.md`、`docs/{zh,en}/usage.md`、`docs/{zh,en}/architecture.md`、`docs/adr/0032-*`（新增）、`docs/adr/0024-*`（指针）。
- **门禁**：触及直连/飞书面 → `npm run test:e2e` 必跑；内网可达时 `npm run test:integration`（本变更不改协议，默认值变化使 integration-direct 走卡片路径，顺带验证真机卡片）。
