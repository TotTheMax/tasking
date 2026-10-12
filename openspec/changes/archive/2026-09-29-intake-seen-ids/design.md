## Context

现状两条 ingest 路径的持久性保证不一致：WS 事件通道实时处理但不推进 `intake_cursor`（`feishu-event-ingress/spec.md:29` 甚至把"游标无推进"写为预期稳态），Sweep 是游标唯一推进者（启动/WS 重连/12h 定时三个触发）。同机重启后，启动 Sweep 按 `create_time > cursor` 重拉事件通道已处理的命令消息并再次执行——只读命令回复重放。副作用型入口已有持久幂等：`/issue` 的 `hasRootId`（`comment-bridge.ts:900`）、`/chat` 的 `getDirectSession`（`direct/manager.ts:673`）、话题消息的游标 + seen_ids（`direct/manager.ts:724`、`binding-store.ts:388`）。

两个关键代码事实约束设计：

1. **`executeIssue` 全程被 await**（建单→回执→binding 写入顺序完成，`comment-bridge.ts:1299-1329`），`processIntakeMessage` 内部吞掉所有异常、无重新入队——根消息的处理在 `ingestMessage` 的 await 返回时**确实已终结**。
2. **话题消息走退避重试**（`comment-bridge.ts:780-794`）：重试挂起时原队列项的 `done` 已在 `drainQueue` 的 `finally` 触发，await 提前返回——若对话题消息也做出口标记，会把"桥接未完成"的消息标记为已见，崩溃窗口内丢 Jira 评论。

## Goals / Non-Goals

**Goals:**

- 同机重启后，Sweep 重投的已处理 intake 根消息被持久 seen-id 拦截，不重发命令回复/ack。
- 保持 at-least-once：崩溃在任何位置，最坏结果是重放一条回复（= 现状），绝不静默丢弃用户输入。
- 单一收口点：检查与标记都在 `ingestMessage`，事件通道/Sweep 两路天然全覆盖。

**Non-Goals:**

- 跨机器去重（`--fresh` / 冷启动探测的既有职责，正交不变）。
- 话题消息、卡片动作、直连会话的去重变更。
- 游标粒度改造（毫秒化）或事件通道推进游标。

## Decisions

### D1. 作用范围：仅 intake 根消息（`root_id === null`）

事实 2 决定：话题消息的出口标记有"重试挂起时 await 提前返回"窗口，标记它们 = at-most-once = 可能丢评论。话题消息已有三层持久守卫，无需 seen-id。实现为 `ingestMessage` 内一个 `m.root_id === null` 条件。

被否：全量消息统一标记（上述丢失风险）；仅"纯回复型命令"标记（需消息分类，误分类一条 = 静默丢一张 `/issue`，且 UX 收益与全根消息方案完全相同）。

### D2. 存储：`bridge_meta` 新键 `intake_seen_ids`，有界 JSON 数组上限 50

表已存在（`binding-store.ts:57`），`getMeta`/`setMeta` 现成，零迁移。50 条足够覆盖"游标之后、事件已处理"的近段（游标本身拦旧消息）；每条消息一次读-改-写整数组，SQLite 单写者 + 人发命令的频率下无感。与 `direct_sessions.seen_ids` 心智模型一致。

被否：专用表（建表 DDL + 清理任务 + 持久化风格分叉，此量级下零收益）。

### D3. 写入时机：处理完成后标记，无论成败

`ingestMessage` 的 await 返回即标记（含"成功回复/主动放弃/已发失败回执"一切结局），与 Sweep"游标无论 ingest 结果都推进"（`comment-bridge.ts:1156-1171`）的语义对齐——标记即游标语义的事件通道版。失败可见性由既有回执保证（建单失败回 `创建失败: ...`，`comment-bridge.ts:1303`）。

被否：只在成功时标记（`processIntakeMessage` 多分支 return + 内部吞异常，需全分支穿返回值，破坏单一收口）；照抄 direct-sessions 的入口先标记（intake 无"中断提示 + 重试按钮"产品兜底，先标记 = 静默丢单——该时机偏离记入 ADR 0030，若未来 intake 长出失败可见/重试兜底可逆转收敛）。

### D4. 拦截可见性：静默 + debug 日志

重放发生在重启后的 Sweep 里，用户此刻无动作；回"已处理"提示本身就是新刷屏。照抄 `/chat` 根消息重投先例（`direct/manager.ts:675`，spec 明文"避免与用户动作无关的随机回执"）。

### D5. `--fresh` 不清理 seen-id

`freshStartReset` 只删 `intake_cursor`（`comment-bridge.ts:1197`），探测轮"只记不处理"（ADR 0016），旧消息到不了 `ingestMessage`，残留 seen-id 无害（message_id 全局唯一不重用）。零耦合，不改 `freshStartReset`。

## Risks / Trade-offs

- [回复发送失败 + 崩溃窗口] 回执本身发送失败（飞书 API 异常）且随后崩溃 → 标记后重启不重放，用户什么都没收到。→ 接受：与今天 Sweep 模式游标照推的行为一致，属语义对齐而非新损失；窗口为个位数秒级。
- [每条根消息一次 SQLite 读-改-写] → 量级评估：人发命令频率 + 微秒级同步写，无感；不做批量化。
- [同库两套 seen-id 时机相反，未来被"统一"] → ADR 0030 显式记录偏离理由，防止后人误把 intake 改成先标记引入静默丢单。
- [50 上限误挡] 理论上单次 Sweep 重放 >50 条同批消息且游标未推进时，第 51 条之前的会被重放。→ 实际不可达：游标秒级过滤 + 单次重启窗口消息量远小于 50；且重放的代价只是重复一条回复（回到现状行为）。

## Migration Plan

无 db 迁移（复用 `bridge_meta`）。部署即生效；回滚 = git revert，残留的 `intake_seen_ids` 键对新代码只是永远读不到的旧数据，无副作用。
