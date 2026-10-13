## Context

`flushTurnCard`（`src/direct/manager.ts`）当前失败处理：`updateCard` 失败计数 +1，计数 <2 时**立即**重试一次；连败两次后 `rt.cardsAvailable=false`、`rt.cardId=null`，本 daemon 生命周期内该会话永久走文本（仅 `/done`、空闲过期、`/new`、重启可恢复）。实战（Lark 国际版 504，单次耗时约 5s）证明立即重试会撞进同一波拥塞连败，永久弃卡惩罚过重。状态码已由 `source.ts` 以 `TaskingError("feishu_api_status", msg, { status })` 结构化抛出；网络层错误为 category `feishu_api_request`（无 status）。游标（`rt.flushedTools`）推进语义已在上一修复中实现（await 前快照 + 同 turn 守卫 + seal 推进），有 stash 验证过的竞态回归测试。

## Goals / Non-Goals

**Goals:**

- 可重试错误（5xx / 429 / 网络层错误）延迟 2000ms+0-1000ms 抖动后重试一次；成功则卡片继续
- 重试仍败：仅本 turn 剩余更新降级为**单条合并**文本，只含未上卡工具（增量）
- 下一 turn 自动恢复卡片模式
- 4xx（429 除外）立即降级，不等待不重试
- 重试延迟经 deps 注入（默认 2000ms）作为测试缝——不暴露 WORKFLOW.md 配置

**Non-Goals:**

- 不改 `source.ts` HTTP 层（其他调用各自已有兜底；统一重试层是后续独立 change 的选项）
- 不做多级退避/熔断器（1.5s 的 flush 节流已提供天然间隔）
- 不处理回复卡（`replyCardInThread`）与文件投递的重试（已有 `replySafe`/`deliverLongContent` 兜底）

## Decisions

1. **分类依据 `TaskingError`**：`details.status >= 500 || status === 429 || category === "feishu_api_request"` 判为可重试；其余（含 400/403 等永久性 4xx）快速失败。非 `TaskingError` 的未知错误（生产端口不会产生，测试桩中代表瞬时故障）按可重试处理——沿用既有 self-heal 语义。备选：解析 message 文本——放弃，结构化字段现成且不脆。
2. **延迟 2000ms + 0-1000ms 抖动，重试 1 次**。依据：实测 504 返回耗时 ~5s（拥塞窗口量级），10-09 案例中重试成功间隔也在秒级；抖动防多会话同步重试。
3. **每 turn 恢复而非熔断**：`startTurnCard` 重置 `cardsAvailable=true`。真不支持卡片的平台最多每 turn 一次廉价的建卡失败 + WARN 日志，复杂度比熔断器低一个量级。移除现有的"连败 2 次 → 永久 false"路径（`cardUpdateFailures` 阈值逻辑随之简化为单 flush 内的一次重试计数）。
4. **降级文本语义（补录已上线行为）**：降级期间 pending = `turn.tools.slice(flushedTools)`，合并为**一条**消息（≤2000 字符截断）；游标推进沿用现有快照 + 同 turn 守卫。
5. **延迟注入而非配置**：`DirectSessionManagerDeps` 增加 `cardRetryDelayMs?: number`（默认 2000，测试传 0 或小值）。这是测试缝不是用户配置面，不进 WORKFLOW.md/schema/双语文档。
7. **turn 切换时的增量兜底**：fire-and-forget 的 flush 可能在重试睡眠中跨越 turn 切换（turn 守卫使其醒来后不再投递）。`startTurnCard` 先 join 在飞 flush（`rt.flushPromise`），再对旧 turn 补发 `tools.length > flushedTools` 的剩余增量（恰好一次，游标即投递凭证，与 `cardsAvailable` 无关），然后才重置游标。文本行构造提取 `toolTextLines` 共用。
6. **并发 flush 防重入**：延迟 sleep 使 flush 重叠窗口变大（sleep 期间 finalize/seal 可再入 `flushTurnCard`）。以 `rt.flushInFlight` 标志串行化：进行中的 flush 返回后，后续 flush 自然拿到最新状态；被跳过的 flush 由 1.5s 节流/终态立即刷新补上。

## Risks / Trade-offs

- [重试期间 turn 已结束/下一 turn 已开始] → 同 turn 守卫已存在（游标推进）；重试成功后仍需检查 `rt.turn === turn` 才推进，现行为保持
- [sleep 拉长终态刷新延迟（最坏 2s+5s）] → 仅在失败路径发生；正常路径零变化
- [测试真实等待 2s+] → deps 注入 `cardRetryDelayMs: 0` 消除等待；抖动用 `Math.random()` 直接取值（不可测性可接受，断言只看延迟函数被调用）

## Migration Plan

纯行为改进，无迁移；回滚 = revert 单提交。与已上线的游标修复（`88f41dc`）正交叠加。
