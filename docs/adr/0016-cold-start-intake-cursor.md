# Feishu 冷启动用探测游标代替 24h 回看（换机零重复）

> **部分被 ADR 0018 修正（2026-09-01）**：实测发现飞书 `listMessages` 不带时间参数返回的是**最旧页**而非最新页（本文假设不成立，mock 曾模拟为 newest-first 掩盖了这一点）。冷启动探测已改为带窗查询（`start_time = now-120s`，取窗口内 `max(create_time)`，空窗取窗口起点），防重放语义保持不变。


换机器/新部署时 `bindings.db` 不存在，intake 游标为空；原 `resolveStartTime` 回退"现在-24h"导致新机器重放过去 24h 的 intake 群消息：`/issue` 重复建 Jira issue、普通消息重发 ack 刷屏。决定：空游标不再回看，改为**冷启动探测**——`discoverIntake` 发一次不带时间参数的请求（Feishu 默认返回最新一页），取返回项 `max(create_time)` 作为初始游标（只记不处理），下一轮起从该游标正常增量消费。同时修复 `listMessages`/`listThreadReplies` 的分页（`page_token`/`has_more`）。

理由：初始点直接来自飞书自己的时钟，零时钟偏差、零重复、不重放；代价仅是冷启动多一次 API 调用（Grill Q1 确认，不用 60s overlap、不加配置项）。**取舍**：换机停机窗口内（旧机器最后轮询 → 新机器探测之间）的消息不被消费，且旧话题绑定随 db 丢失而"停摆"（Grill Q3=3a 确认接受，不把 root_id/thread_id 外置到 Jira）。被否：① 保留 24h 回看 + 消息幂等写 Jira（方案 C，改动大）；② bindings 外置到 Jira（3b，本次不做）。
