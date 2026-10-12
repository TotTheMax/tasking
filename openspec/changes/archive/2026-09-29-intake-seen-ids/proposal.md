## Why

事件通道处理的 intake 命令（`/help`、`/state` 群内误用、`/agent` 提示、未知命令回复、"已收到" ack、`/chat` 列表）只受进程内存 `processed` 集合与秒级 `intake_cursor` 保护，而游标仅由 Sweep 推进、事件路径不推进。停机早于下一次 Sweep 时重启，启动 Sweep 会把已处理过的命令消息当新消息重放，机器人"复活"几分钟前的旧回复刷屏。副作用型操作（`/issue`、`/chat` 建会话）因各自持有 root_id 持久幂等守卫而免疫——同一套 at-least-once 投递下，只读命令回复成为唯一无持久防护的入口，与 spec"重投由各 handler 幂等消化"的隐含假设相悖。

## What Changes

- `CommentBridge.ingestMessage` 对 **intake 根消息**（`root_id === null`）增加持久重投去重：入口检查持久 seen-id，处理完成后写入。
- 标记采用"处理成功后写入"顺序（await 队列完成即标记，无论处理成败），保持 at-least-once：崩溃夹缝最多重放一条回复（退化为现状），绝不静默丢弃用户输入。
- 话题回复（`root_id !== null`）完全不涉入，继续依赖既有三层持久守卫（binding 游标、direct session 游标 + seen_ids）。
- 持久 seen-id 存于 `bridge_meta` 表新键 `intake_seen_ids`（有界 JSON 数组，上限 50，照抄 `direct_sessions.seen_ids` 模式），零表结构迁移。
- 重放拦截静默（仅 debug 日志），与 `/chat` 根消息重投先例一致，避免制造新的随机回执。
- 新增 ADR 0030 记录与 direct-sessions 先例的写入时机偏离及理由；更新 CONTEXT.md 词汇表（Ingest queue 词条修正 + 新增 Intake seen-id 词条）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `comment-bridge`: 新增需求"intake 根消息重投持久去重"——重启后 Sweep 重投的已处理根消息 SHALL 被持久 seen-id 拦截、不重发命令回复/ack；seen-id SHALL 仅在处理完成后写入；话题回复 SHALL 不受影响。
- `feishu-event-ingress`: "入站队列单一入队口与 claim 去重"需求的 claim 定义补全——intake 根消息的 claim 另有持久 seen-id 半边（跨重启），新增重启重投被持久去重场景。

## Impact

- **代码**：`src/bridge/binding-store.ts`（`intake_seen_ids` 读写方法对）、`src/bridge/comment-bridge.ts`（`ingestMessage` 入口检查 + 出口标记，约 25 行）。
- **测试**：`tests/comment-bridge.test.ts`（重启模拟 3 例）、`tests/binding-store.test.ts`（store 方法 2 例）；`tests/bridge-flow.test.ts` / `tests/e2e.test.ts` 作为既有门禁回归。
- **文档**：`docs/adr/0030-*.md`（新）、`CONTEXT.md`（两处词条）、无用户手册变更（内部行为，对外仅表现为"重启不再重放旧回复"）。
- **不受影响**：`--fresh` / 冷启动探测（跨机场景正交，残留旧 seen-id 无害——message_id 全局唯一不重用）、调度器、worker、直连会话管理器。
