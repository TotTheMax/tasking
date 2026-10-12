## Why

换机器（或首次在新机器部署）时，`bindings.db` 不存在 → `intake_cursor` / `last_feishu_msg_id` 为空 → `resolveStartTime` 回退 `now - 86400`（24h 回看）→ 重放过去 24h 的 intake 群消息：`/issue` 重复建 Jira issue、普通消息重发 ack 刷屏。需要：换机零重复消费、不产生其他问题、不需要迁移 db 文件。

## What Changes

- **移除 24h 回看兜底**：`resolveStartTime` 在游标为空时不再回退 `now - 86400`，改为返回空（不传 `start_time`）。
- **冷启动探测建立初始游标**：`discoverIntake` 在 `intake_cursor` 为空时先发一次**不带时间参数**的探测请求（API 默认返回最新一页），取返回结果的 `max(create_time)` 作为初始游标（只记录、不处理），之后正常轮询从该游标续上。初始点直接来自飞书自己的时钟 → 零时钟偏差、零重复、无重放刷屏；代价仅为冷启动多一次 API 调用。不做 60s overlap、不新增配置项。
- **修复分页**：`listMessages` / `listThreadReplies` 处理 `page_token` / `has_more`，窗口内 >50 条不再只取前 50。
- **不做 bindings 外置**（已确认 3a）：换机后旧话题的绑定关系随 `bindings.db` 丢失而"停摆"（不重复、不重建线程），该取舍被接受。

## Capabilities

### New Capabilities

- `feishu-cold-start-resume`: 冷启动 intake 游标探测（无时间参数请求 + `max(create_time)` 初始游标 + 只记不处理），保证换机后零重复消费、无 24h 重放。

### Modified Capabilities

- `feishu-source`: 轮询游标语义变化——空游标不再回退 24h（不传 `start_time`）；`listMessages` / `listThreadReplies` 支持分页（`page_token` / `has_more`）；新增无时间参数的最新页请求（探测用）。
- `comment-bridge`: `discoverIntake` 冷启动行为变化——游标为空时先探测记录初始游标（只记不处理），下一轮再正常消费。

## Impact

- 改：`src/adapters/feishu/source.ts`（`resolveStartTime`、`listMessages`、`listThreadReplies`、新增探测方法）、`src/bridge/comment-bridge.ts`（`discoverIntake` 冷启动分支）。
- 改测试：`tests/feishu-source.test.ts`（分页、空游标行为）、`tests/comment-bridge.test.ts`（冷启动探测、既有 discoverIntake 用例预置游标）、`tests/bridge-flow.test.ts`（预置游标）、`tests/helpers/feishu-mock.ts`（支持分页与无 start_time）。
- 文档：`CONTEXT.md` 术语、`docs/adr/0016-*.md`（新 ADR 记录本次取舍）、`docs/{en,zh}/configuration.md` feishu 块说明游标语义。
- 不动：scheduler、worker、Jira 适配器、bindings 表结构、配置 schema（无新配置项）。
