# Feishu 入站用 REST 轮询，不用 webhook/长连接

> **状态：已被 ADR 0018 取代（2026-08-27）**——配额约束反转，飞书入站改为事件驱动（WS 长连接），REST 轮询降级为兜底清扫。本文保留作历史依据。

Feishu 事件入站用 REST 轮询：tasking 周期性 `GET /im/v1/messages` 拉绑定会话新消息；出站（Jira→飞书）同样轮询 Jira comment。整个桥 outbound-only、无入站 HTTP server、无公网端口、零新依赖（复用 `FeishuSource.fetchImpl`），与 scheduler 的 tick 轮询模型对称。绑定会话定向快轮询（`feishu.poll_interval_ms` 默认 5s）；`/issue` 在指定 intake 群内发现，无多群扫描。`HttpDashboard` 不动（可选 dashboard-only）。

理由：用户要求飞书入口不暴露公网。webhook 推送需公网/隧道入口（否）；飞书长连接（WS）免公网但要官方 SDK 依赖或自搓协议，且引入持久连接生命周期（心跳/重连/断线兜底），破了 tasking"全是无状态轮询 tick"的极简，并使桥不对称（飞书侧推送 + Jara 侧仍轮询）。REST 轮询让两方向统一出站轮询、一个 tick，最简。

代价：延迟 ≤`feishu.poll_interval_ms`（与 Jira 30s 轮询同类、人体验一致）；中小规模下 API 调用量 = 绑定线程数 × 节奏，大规模才咬限流——届时再上长连接。被否：① webhook（需公网）；② 长连接 WS（新依赖 + 持久连接模型）；③ 扫所有 bot 群发现 intake（改为指定 intake 群消除扫描）。
