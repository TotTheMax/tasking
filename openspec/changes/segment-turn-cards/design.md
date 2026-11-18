## Context

直连会话的轮次卡片（Turn card）承担一轮的**过程面**：运行中原地更新，轮末封存为历史记录。当前实现有两个结构性限制：

1. `TurnCardState` 把过程拆成 `texts: string[]` 与 `tools: TurnCardToolEvent[]` 两个数组（`src/direct/card.ts`），渲染时先铺完所有文本、再铺所有工具面板——驱动层本来按源顺序发出 `text` / `tool_use`（`src/driver/turn-driver.ts` 的 `diffMessagesToEvents`），顺序在聚合时被丢掉。
2. 卡片接近 24KB 工作预算时，`buildTurnCard` 只对工具面板做三级降级（输出 15 行 → 3 行 → 去输出 → 压成「还有 N 个工具调用未展示」）。文本越长，工具越早被压掉；而工具明细正是解释 agent 行为的关键信息。

平台约束（官方文档已核对）：卡片消息请求体 ≤30KB（样式标签会额外膨胀）、JSON 2.0 单卡 ≤200 元素/组件、单卡 ≤5 表格、单条消息更新 5 QPS、已发消息 14 天内可更新、卡片交互回调 3 秒内响应。当前预算是 `JSON.stringify(card).length`（字符数），而实际请求体是 `{"content":"<translate + 转义后的 JSON>"}` 的 UTF-8 字节，可能低估数倍。

本 change 的完整取舍已由用户逐项确认（见 proposal）。设计目标是**用更少的状态、而不是更多的机制**解决上述问题。

## Goals / Non-Goals

**Goals:**

- 过程面按事件**源顺序**渲染：文本与工具交错，读起来是「思考 → 执行 → 再思考」。
- 溢出时**优先分段**（信息完整），降级只作为「单条事件自己就装不下」的兜底。
- 计量口径与真实发送一致（translate + 转义 + UTF-8 字节）。
- 不新增配置键、数据库列或 feature flag；不改变 `verbosity: summary|quiet` 路径。
- 控制复杂度：一个 `events` 数组、一个段数组、一条切分规则。

**Non-Goals:**

- 段列表持久化（`direct_sessions.card_message_id` 继续只存最新段）。
- daemon 级全局限流 / 令牌桶。
- 卡片内容统一脱敏。
- 单卡 ≤5 表格的识别与改写。
- `reasoning` 上卡（仍只进 ActivityStore/TUI）。
- 事件排序键（按到达顺序渲染即可）。
- 新配置项、数据库迁移、feature flag。
- 段数上限（完全由体积/元素数决定）。
- 改变结果面（Turn completion message）的语义与投递方式。

## Decisions

### 1. 一个有序 `events` 数组，替代 `texts + tools`

```ts
type TurnCardEvent =
  | { kind: "text"; text: string }
  | { kind: "tool"; tool: TurnCardToolEvent };

interface TurnCardState {
  events: TurnCardEvent[];
  // 其余字段不变
}
```

- 渲染：顺序遍历 `events`，text → markdown 元素，tool → 折叠面板。
- 游标：段只需要 `start: number`，不再需要 `flushedTools`。
- `toolCalls` 计数保留（来自 `stats`），不依赖数组长度。

被否决：保留两个数组 + 每段两个起始下标（实现更小，但顺序依旧分组，且要维护两个游标，净复杂度更高）；给事件加排序键（需要 messageId + entryIndex，驱动层要透传，收益仅覆盖极端的「消息内容重排」场景）。

### 2. 切分触发：payload 字节 + 近似元素数

每次 flush 渲染后判断：

```ts
bytes = Buffer.byteLength(JSON.stringify({ content: JSON.stringify(translateCard(card)) }), "utf8")
elements ≈ 12 + Σ(event.kind === "text" ? 1 : 3)
```

触发条件：`bytes > 24 * 1024 || elements > 180`。

- 24KB 保留 6KB 余量给飞书的样式标签膨胀（与 ADR 0024 一致）。
- 元素估算按「面板 ≈ 2–3 个元素」保守取值；阈值 180 留 20 余量，避免纯工具长轮次先撞 200 元素墙、而体积还很小。
- 不做卡片 JSON 递归计数：估算足够保守，且不随组件结构调整而失准。

被否决：只看体积（会漏「工具很多但输出很短」的元素墙）；精确遍历卡片 JSON 数组件（多 15–20 行且仍需估算嵌套元素的真实计数口径）。

### 3. 切分算法：渲染后从尾部回退

```
render(view = events.slice(active.start))
if (overBudget && view.length > 1):
    while (render(view) over && view.length > 1) view.pop()
    seal(active, footer=续见)
    createSegment(start = active.start + view.length)
    render(newSegment)
else if (overBudget && view.length === 1):
    degrade(that single event)
```

一次 flush 可能产生多张分段卡片：把当前活跃段的事件按「最长可装下前缀」贪心装箱，第一段用于封存当前卡片，其余每个前缀各建一张卡，最后一张保持活跃。因此中间段在**创建时**就是 `sealed + continued`（无按钮、显示「本段结束，续见下一条卡片」），而不是等到下一轮才封存。单条自身超预算的事件独占一个前缀，并由渲染器就地降级，不会被并入后续事件。这样一次突发（1.5s 合并后的事件）也不会留下超预算的卡片。

- 「去掉事件一定变小」是单调的，循环必然终止。
- 不产生空段：至少保留一条事件在旧段；新段从被弹出的事件开始。
- 单条事件自己超预算时，才对该事件走原有的截断阶梯（15 行 → 3 行 → 去输出）。
- 旧段只渲染一次最终（装得下的）视图，不会先写超限版本再改回。

被否决：先测量再添加（需要把 render 拆成 measure + render，且每次添加都要重复测量）；每次 flush 重新贪心装箱（会改变历史分段，已发卡片需重排）。

### 4. 不设段数上限

完全由字节/元素决定。理由：正常轮次 2–4 段；用户选择「简单直白」，不引入「到顶后改文本」的第二套策略。极端轮次的话题噪音作为已知取舍记录。

被否决：上限 5 + 剩余走文本（多一条分支与计数器）；上限 5 + 最后一段降级（重新引入「工具被挤掉」）。

### 5. 旧段与轮末的 footer 区分

- 中途封存（切段）：`— 本段结束，续见下一条卡片 —`
- 轮末封存（最后一段）：沿用 `— 该轮已结束 · {duration}s · ≈{tokens} —`

实现：`TurnCardState.continued?: boolean`（或等价标记），只影响 footer 文案。

### 6. 头部片段标记

新段头部在 `N > 1` 时追加 `· 片段 N`；其余字段（会话名、状态、累计 turns/token、ctx、队列、权限姿态）不变。段号是**本轮内**的序号，跨轮重置。

### 7. 只有活跃段带控制按钮

运行中：`⏹ / 🔐 / 🛑`；完成后（最后一段）：`🔁 / 📄 / 🔐 / 🛑`。旧段无按钮，只有 footer。`📄 完整输出` 语义不变：只导出工具明细（1MB 累积器），只在最后一段出现。

### 8. 取消按条 400 字截断

文本事件整体渲染；只有「单条文本自己就让整段超预算」时才截到预算内。理由：事件完整性优先，卡片完整性靠分段保证；同时减少一条特例。

### 9. 完成时仍省略最后一个 text 事件

最终答案只出现在完成消息/结果卡（既有「过程面 / 结果面」分工）。实现为「跳过最后一个 `kind === "text"` 的事件」。

### 10. 错误分类：按业务 code 补充可重试

`isRetryableCardError` 在 HTTP status 判断之外，解析 `details.body` 的 `code`：`230020`（群维度限流）与 `200810`（卡片交互中无法更新）视为可重试，走现有的一次退避重试。其余 4xx 仍快速降级。

### 11. 活跃段动作守卫（窄）

`stop` / `retry` / `full` 要求 `action.messageId === 活跃段.cardId`，否则回 toast「该片段已结束」。`done` / `perm` / `auto` / `collect` 不受限（会话级操作，旧段触发也不至于误导）。

### 12. 持久化不变

`direct_sessions.card_message_id` 继续只存最新段；段边界只在内存。重启/`/done`/过期只封存最新段；旧段在切段时已封存。接受「建段成功 → 写库前崩溃」留下一个带按钮的孤儿段（点击时走现有 `!turnInFlight` / 守卫路径）。

### 13. 不做全局限流

1.5s 合并把常态压到 ≤0.67 QPS/会话；默认并发 5 时峰值是毫秒级突发，`230020` 已被归为可重试。引入跨会话令牌桶的复杂度与收益不成正比。

## Risks / Trade-offs

- **[话题噪音：无上限分段可能刷出多张卡]** → 触发条件 24KB/180 元素较高，正常轮次 2–4 张；极端情况由用户切 `verbosity: summary` 兜底。
- **[崩溃孤儿段：建段后未写库]** → 概率极低；点击后走现有守卫/toast，`done` 仍有二次确认；写入 known-issues。
- **[单卡 >5 表格导致整卡失败]** → 走现有 Card fallback（本轮剩余改文本），下一轮自愈；写入 known-issues，不在本 change 处理。
- **[预算仍可能低估样式标签膨胀]** → 24KB 相对 30KB 留 6KB 余量；若真实命中 230025，仍会降级文本，不丢内容。
- **[单条巨大文本独占一段]** → 可接受；只有它自己超预算时才截断。
- **[到达顺序与源顺序在消息重排时可能不一致]** → 驱动按 message 排序 + entry diff，正常路径一致；极端重排不处理。
- **[旧客户端（<7.20）显示升级占位符]** → 文档已写明；`summary` 是显式回退。
- **[失败工具触发的即时 PATCH 可能撞单消息 5 QPS]** → 该路径本来就存在；`429` 已可重试，`230020` 本次归为可重试。
- **[每段重复会话头与整轮计数]** → 接收；段号 `片段 N` 明确归属。

## Test Seams

按 TDD 约定，测试只落在以下公共边界：

1. **`buildTurnCard(state)`**：纯渲染函数。断言 HTML/JSON 中元素的**顺序与内容**（text 与 tool 交错、片段标记、footer 文案、无按钮的旧段），不测内部降级循环。
2. **`DirectSessionManager` + 注入的 Feishu mock**：通过 `replyCardInThread` / `updateCard` 观察「发出了哪些卡、卡上有什么」，不断言调用次数或私有方法；分段/封存/守卫都在此层验证。
3. **`tests/card-roundtrip.test.ts`**：从渲染出的卡片 JSON 抽取按钮 value，经真实 `startEventChannel` 路由分发，断言用户可见结果（旧段按钮只回 toast）。
4. **错误分类**：通过注入的 `updateCard` 抛 `feishu_api_status`（400 + body code `230020`）验证「重试一次后成功、不降级」，而不是直接测私有函数。

## Migration Plan

1. 无数据库迁移、无配置变更：直接部署；已存在的旧卡片不受影响（其按钮走现有 turn/守卫路径）。
2. 回滚：revert 代码即可；运行中可用 `feishu.direct.verbosity: summary` 立即退回文本交付。
3. 归档：实现通过门禁与真机冒烟后，按 OpenSpec 流程归档并 sync 主 spec。

## Open Questions

- 无阻塞项。观察项两项：真实使用中若表格密集轮次频繁触发整卡失败，再评估「表格转代码围栏」；若话题噪音明显，再评估段数上限。
