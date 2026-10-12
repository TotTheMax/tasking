## Context

换机器（首次在新机器部署）时 `bindings.db` 不存在，两个游标 `intake_cursor`（bridge_meta 表）与 `last_feishu_msg_id`（bindings 表）全空。`discoverIntake` 用空 `since` 调 `FeishuSource.listMessages`，后者经 `resolveStartTime` 回退 `now - 86400`（24h 回看），于是新机器回放过去 24h 的 intake 群根消息：`/issue` 走 `executeIssue` 重复建 Jira issue（`hasRootId` 查空表不拦截），普通消息重发 ack 刷屏。内存 `processed` Set 同时清零。分页未处理：`page_token`/`has_more` 被忽略，窗口内 >50 条只取前 50。

Grill 已确认的决策：
- **Q1**：采用 1a 的"进程启动时刻"兜底思路，但**不用 60s overlap**；改为冷启动探测——游标为空时先发一次不带时间参数的请求（API 默认返回最新一页），取 `max(create_time)` 作为初始游标，**只记不处理**。
- **Q2**：不加配置项（2a）。
- **Q3**：不外置 bindings（3a），旧话题换机后停摆可接受。
- **Q4**：修分页。

## Goals / Non-Goals

**Goals:**
- 换机器/新部署后 intake 群消息零重复消费：不重复建 Jira issue、不重发 ack。
- 冷启动初始游标来自飞书自己的时钟，消除本地/服务端时钟偏差导致的重复或丢失。
- `listMessages` / `listThreadReplies` 正确处理分页，窗口内超过 50 条不丢失。
- 不改配置 schema、不迁移/外置 bindings 数据库。

**Non-Goals:**
- 旧话题（已绑定 issue↔飞书线程）在换机后继续双向桥接（Q3=3a，接受停摆）。
- 消息级幂等写 Jira（Q1 选 1a 未选 C 方案）。
- 引入新依赖或改动 scheduler / worker / Jira 适配器。

## Decisions

### D1: 冷启动探测建立初始游标（而非 24h 回看）

`discoverIntake` 读到 `intake_cursor` 为空时，不再以 24h 窗口轮询，而是：
1. 调 `FeishuSource` 新方法发一次**不带时间参数**的 `GET /im/v1/messages`（容器=intake 群），服务端按默认返回最新一页；
2. 取返回项 `create_time` 的 `max` 作为初始游标写入 `bridge_meta.intake_cursor`；
3. **只记不处理**，本轮返回，下一轮从该游标正常增量轮询。

理由：
- 换机后旧机器的消息本来已消费完，新机器只应消费"探测点之后"的新消息；用飞书自己的最新消息时间作起点，零时钟偏差。
- 相比"进程启动时刻"兜底：探测点来自飞书时钟而非本地时钟，避免本地时钟偏快把游标推到未来（丢消息）或偏慢导致重放。
- 相比 24h 回看：不重放 → 不重复建单、不刷 ack。

替代方案被否：
- **保留 24h 回看 + 消息幂等（方案 C）**：改动大（要动 Jira 写入链路），且 ack 刷屏仍需额外去重；Q1 已确认不用。
- **60s overlap 兜底**：人类明确不要，用探测消除偏差。

### D2: 探测与正常轮询用同一底层分页请求

`resolveStartTime` 空游标时返回 `null`（不再回退 24h），`listMessages`/`listThreadReplies` 在 start_time 为 null 时不传该参数。新增 `listLatestMessages(chatId)`：发**一次**不带时间参数与分页的请求，返回服务端默认的**最新一页**（供冷启动探测用）。`listMessages`/`listThreadReplies` 则走完整分页循环。

替代方案被否：
- 让探测直接复用 `listMessages(chatId, "")`（空游标 → 不传 start_time）。可行但会走完整分页循环、拉取整个群历史，违背"冷启动多一次 API 调用"的约定；单页探测方法语义更精确。
- 60s overlap 兜底：人类明确不要，用探测消除偏差。

### D3: 分页修复

`listMessages` / `listThreadReplies` 循环读取 `has_more` / `page_token`，`page_token` 为空时停止；翻页用 `page_token` 作为下页参数，累积所有页 items 后返回。保留超时与错误传播语义。

### D4: 不做 bindings 外置（3a）

换机后 bindings 表为空 → `tick` 里 `listActive()` 为空 → `syncBinding` 不跑，旧话题不重复也不重建线程，只是停摆。接受该取舍，不改表结构、不动 Jira 标签。

## Risks / Trade-offs

- **换机停机窗口内（旧机器最后轮询 → 新机器探测之间）的消息不会被消费** → 这是 1a 的固有取舍，Grill 已确认接受（停机缺口）。
- **探测请求依赖飞书"默认返回最新一页"语义** → 若服务端语义变化，初始游标可能偏旧。缓解：只记不处理 + 后续正常轮询，最多多处理几条、不产生重复建单（`hasRootId` 仍兜底同一机器内的重复根消息）。
- **冷启动多一次 API 调用** → 人类接受（Q1 明示"代价只是冷启动多一次 API 调用"）。
- **旧话题停摆** → 3a 明确接受；不重复、不重建，行为可预期。

## Migration Plan

无数据迁移。升级后首次冷启动即走探测建游标；运行中的机器已有游标，不受影响。回滚：还原 `resolveStartTime` 与 `discoverIntake` 即可，无副作用。

## Open Questions

无（Grill 4 问均已确认）。
