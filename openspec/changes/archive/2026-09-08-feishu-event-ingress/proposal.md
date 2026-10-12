# Proposal: feishu-event-ingress

## Why

飞书免费版 API 额度是**租户级共享**（基础免费版限时 100 万次/月），当前 2s 轮询 × (1+活跃 binding 数) 单实例一天消耗 ~13 万次，数天烧光整月额度——2026-08-27 已实际发生（`99991403` 月配额耗尽，daemon 拉不到任何消息）。事件推送（WS 长连接）是平台豁免通道：不计量、实时、断线语义明确。Spike 已实证（配额耗尽状态下建连、收群消息/话题回复、事件字段可直接路由到 binding）。同时本工具面向多用户未来，租户内多个 daemon 实例共享同一份额度，轮询架构不可持续。

## What Changes

- **新增事件通道**：`FeishuEventListener`（官方 SDK `@larksuiteoapi/node-sdk` 的 `WSClient` 薄适配层）订阅 `im.message.receive_v1`，SDK payload 归一化为 `FeishuPolledMessage` 后实时入队；这是唯一 import SDK 的位置
- **新增入站队列**：`CommentBridge` 增加公开入口 `ingestMessage()`，内部单一 FIFO + 单消费者串行；事件与 sweep 共用此入口，msg_id 入队即 claim（先到先得，竞态在入队口终结）
- **轮询降级为 Sweep（兜底清扫）**：现有 `bridgeMessages`/`discoverIntake` 拉取逻辑保留，触发点改为"daemon 启动时 + WS 重连成功时 + 12h 安全定时器"，只补停机/断线窗口与静默异常
- **tick 循环拆分**：`feishu.poll_interval_ms` 改名 `feishu.forward_interval_ms`（**BREAKING**），快循环只跑 Jira→飞书评论转发；新增 `feishu.sweep_interval_ms`（默认 12h）
- **处理失败语义增强**：桥接失败（Jira postComment 等）先做进程内退避重试 ×3（30s/2m/10m，打 Jira、零飞书额度成本），终态失败维持现状（可见失败 ack + 游标推进）
- **429 冷却**：任何飞书 REST 调用收到 429 进入冷却（60s 起翻倍封顶 10 分钟，成功复位）；冷却期 forward 跳发（游标 hold 自动补发）、sweep 跳轮、ack 跳过；事件接收不受影响
- **降级稳态**：WS 建连失败/断线 → WARN + 60s 重试，daemon 照常运行（scheduler/Jira/forward 不受影响），飞书→Jira 延迟退化为 sweep 节奏；无 `receive_mode` 开关
- **一次性运维前提**：控制台需配置订阅方式=长连接、添加事件、发布版本（quickstart 文档写全步骤 + 1 分钟自检法）

## Capabilities

### New Capabilities

- `feishu-event-ingress`: WS 事件通道的接入、归一化、入站队列（claim 去重/串行消费/退避重试）、事件路由边界（与现有轮询可见性完全对齐）、429 冷却、WS 不可用降级稳态

### Modified Capabilities

- `comment-bridge`: "入站 REST 轮询、无公网端口"要求改为"事件驱动入站 + Sweep 兜底"；双向同步的飞书侧入口从轮询改为队列；转发快循环与 sweep 拆分为两个节奏；配置键变更

## Impact

- **代码**：`src/adapters/feishu/`（新增 events.ts）、`src/bridge/comment-bridge.ts`（队列化、sweep 拆分、cooldown）、`src/cli/index.ts`（组合根接线）、`src/config/config-types.ts` + `resolver.ts` + `validator.ts`（键改名/新增/删除）
- **依赖**：新增 `@larksuiteoapi/node-sdk`（锁定版本；`package-lock.json` 变更 → 必须跑 `bash scripts/pack-deps.sh` 重建离线包，否则 CI 必挂）
- **测试**：`tests/comment-bridge.test.ts`、`tests/bridge-flow.test.ts`（主流程切事件通道 + sweep 专项用例）、`tests/config.test.ts`；新增 `tests/feishu-events.test.ts`、半自动 `npm run test:event-flow`（INTEGRATION=1 + 人工发一条消息，断言全自动）
- **运维**：单实例假设（SDK 集群模式随机路由，多实例会重复消费）；一次飞书控制台配置；`WORKFLOW.md` 需手动改键名
- **文档**：`docs/{zh,en}/feishu-quickstart.md`（控制台步骤+自检）、`docs/{zh,en}/configuration.md`（键变更）、`docs/{zh,en}/architecture.md`；ADR 0018 已落盘（取代 0003）
- **不受影响**：scheduler、worker、workspace、MCP、dashboard/TUI（连接状态展示留 future）
