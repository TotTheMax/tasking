## Why

直连会话的轮次卡片现在把一轮过程拆成两个独立数组（`texts`、`tools`）渲染：所有 assistant 文本先铺满上半部分，所有工具面板再堆在下半部分。用户看到的「思考 → 执行 → 再思考」被压成「所有思考 → 所有执行」，读起来割裂。

更糟的是单卡 24KB 预算只对工具做降级：长轮次里文本越长，工具面板越早被压成标题行甚至整段消失（「… 还有 N 个工具调用未展示」）。而工具明细正是解释 agent 在做什么的关键信息。分段（把溢出的后续事件放进下一张卡）比降级（丢信息）更符合用户预期，也让卡片的体积上限不再和「信息完整性」对立。

顺带修两个会放大该问题的小偏差：预算按原始卡片的字符数计量（实际发送的是 translate + JSON 转义 + UTF-8 字节，可能低估数倍）；`230020`（限流）与 `200810`（卡片交互中无法更新）被当成不可重试，一次限流就让整轮降级为文本。

## What Changes

- **过程面改为单一有序事件流**：`TurnCardState.texts` + `tools` 合并为 `events: Array<{kind:"text"} | {kind:"tool"}>`，按到达顺序渲染；`reasoning` 不上卡（仍进 ActivityStore/TUI）。
- **溢出优先分段，降级只兜单条**：渲染后 envelope 字节 > 24KB 或近似元素数 > 180 时，从尾部循环弹出事件直到装下 → 封存旧段 → 新段从被弹出事件开始；只有单条事件自己超预算时才对其截断（15 行 → 3 行 → 去输出）。**不设段数上限。**
- **分段卡片的呈现**：旧段 footer 改为「— 本段结束，续见下一条卡片 —」，轮末最后一段沿用「— 该轮已结束 · Ns · ≈N —」；新段头部追加 `· 片段 N`（N>1 时）；只有活跃段带控制按钮。
- **取消按条 400 字截断**：文本事件整体渲染，完整性由分段保证。
- **预算按真实请求体计量**：`Buffer.byteLength(JSON.stringify({content: JSON.stringify(translateCard(card))}), "utf8")`，导出一个 `cardPayloadBytes` 供预算判断与发送路径共用。
- **窄守卫**：`stop` / `retry` / `full` 要求动作来自活跃段（`action.messageId === activeSegment.cardId`），否则只回 toast「该片段已结束」；其余卡片动作不受限。
- **错误分类**：解析响应 body 的业务 `code`，把 `230020` / `200810` 归为可重试。
- **不做**（写进 design 的非目标）：段列表持久化、daemon 级全局限流、卡片内容脱敏、单卡 ≤5 表格处理、`reasoning` 上卡、事件排序键、任何新配置项 / 数据库列 / feature flag；`verbosity: summary|quiet` 路径不变。
- **决策与文档**：新增 ADR 0041（分段优先于降级；记录被否决方案），ADR 0024 顶部标注 superseded 指针；更新 `docs/{zh,en}/{architecture,usage,configuration}.md`、`known-issues.md`（两条已知限制），并把客户端口径写成「折叠面板 7.9+；JSON 2.0 结构 7.20+（实际下限）」；`CONTEXT.md` 已新增 **Segment card（分段卡片）**、**Turn event（轮次事件）** 并修订 **Turn card**。

## Capabilities

### New Capabilities

（无——全部为既有 capability 的需求变更）

### Modified Capabilities

- `direct-sessions`: 轮次卡片的「每 turn 一张、单卡内预算降级」改为「每 turn 一张或多张分段卡片、溢出优先分段、降级只兜单条」；过程面正文由分组渲染改为按事件源顺序渲染；新增活跃段动作守卫与「限流/交互中可重试」的交付语义。

## Impact

- 代码：`src/direct/card.ts`（事件渲染、预算计量、footer/头部标记、单条截断）、`src/direct/manager.ts`（`events` 状态、段数组、切分与封存、活跃段守卫、错误分类、`fullDetail` 与 `finalized` 适配）
- 数据：无迁移——`direct_sessions.card_message_id` 继续只存最新段；段边界仅存内存
- 配置：无新增键、无默认值变更；`feishu.direct.verbosity` 语义不变
- 文档：`CONTEXT.md`、`docs/adr/0041-segment-turn-cards.md`、`docs/adr/0024-...md`（Status）、`docs/{zh,en}/architecture.md`、`docs/{zh,en}/usage.md`、`docs/{zh,en}/configuration.md`、`docs/{zh,en}/known-issues.md`、`openspec/specs/direct-sessions/spec.md`
- 测试：`tests/direct-card.test.ts`（顺序与预算断言改写）、`tests/direct-sessions.test.ts`（分段/封存/守卫/降级/错误分类）、`tests/card-roundtrip.test.ts`（旧段按钮只回 toast）、`tests/translate-coverage.test.ts` 依赖的 `src/translate/dict.ts` 新文案、`tests/docs-links.test.ts` 的双语 parity
- 门禁：`npm run lint` / `npm run typecheck` / `npm test` / `npm run build`；真机冒烟为 final-only，不作阻塞门禁
