# Design: feishu-event-ingress

## Context

现行架构（ADR 0003）：`CommentBridge` 单 tick 循环以 `feishu.poll_interval_ms` 节奏跑三件事——`forwardComments`（Jira→飞书评论镜像）、`bridgeMessages`（话题消息拉取）、`discoverIntake`（intake 群拉取），全部 REST 计入租户共享月度额度。2026-08-27 实际发生配额耗尽（`99991403`），daemon 全盲。Spike（/tmp/opencode/feishu-ws-spike）已验证：官方 SDK `WSClient` 在配额耗尽状态下照常建连收事件；群消息无需 @；话题回复事件携带 `root_id`/`parent_id`/`thread_id`（`omt_*` 与 bindings 表一致）；SDK 事件 payload 与内部 `FeishuPolledMessage` 形状不一致（如 `msg_type` 字段名差异、`create_time` 毫秒）。

词汇表（CONTEXT.md）：Sweep（兜底清扫）、Event channel（事件通道）、Ingest queue（入站队列）已固化；决策依据见 ADR 0018（取代 ADR 0003）。

## Goals / Non-Goals

**Goals:**
- 收侧（飞书→Jira）成本归零：事件推送不计额度，sweep 降到 ~万级/月
- 飞书→Jira 实时性从 2s 轮询升级为推送级
- 消息完整性承诺不变：断线/停机窗口由 Sweep + 游标续拉兜底，不丢消息
- 桥本体保持 SDK-free，现有测试形状不变，E2E 主流程对齐生产形态

**Non-Goals:**
- Jira webhook 触发即时镜像（future work，forward 快循环已保障 2s 级镜像）
- TUI/dashboard 展示 WS 连接状态（future work）
- 多群 intake / DM 入口（路由边界与现状完全对齐）
- 多实例部署支持（单实例假设，见 Risks）
- Jira 侧任何改动（scheduler、worker、MCP 均不触碰）

## Decisions

### D1: 官方 SDK，只取 `WSClient`（Q1）

`@larksuiteoapi/node-sdk` 锁版本；仅收事件，发送/backfill 仍走现有 `FeishuSource` REST（不引入 SDK HTTP Client，避免双份栈）。**否决手搓 WS**：握手协议私有（spike debug 日志证实走 `msg-frontier` 私有服务），维护成本不合理。依赖代价一次性：lockfile 变更必须跑 `bash scripts/pack-deps.sh`。

### D2: 事件为主 + Sweep 兜底，两路一条流水线（Q2/Q5）

Sweep（原轮询逻辑）触发点：daemon 启动时、WS 重连成功时、12h 安全定时器。事件与 sweep 均只做"取消息 → 归一化 → 入队"，处理逻辑共享同一消费者。**否决纯事件**：断线窗口永久丢消息，且无处安放冷启动探测（ADR 0016）。**否决高频 sweep 即重试**：复查代码发现桥接失败时游标照推（现状即"失败可见、不自动重试"），sweep 从来不是处理失败的重试路径——它只补"取不到"（游标真 held 的 fetch 失败与静默丢事件）。

### D3: 队列契约（Q5）

无界内存 FIFO；单一消费者串行处理（保留同话题消息按序进 Jira）；入队时 msg_id claim（查+加 `processed` set，Node 单线程下原子）；事件 handler 归一化入队即返回（<3s 平台 ack 约束）；消费者内联干活（查 binding → postComment / 命令处理 → 推游标）。进程崩溃丢队列项由启动 sweep 按游标补回——闭环。

### D4: 失败重试 ×3，方向对称（Q5）

桥接失败（如 Jira postComment 网络错）→ 进程内退避重试 30s/2m/10m；重试打 Jira，零飞书额度成本；终态失败维持现状语义（可见失败 ack + 游标推进，用户可手动重发）。补齐方向不对称：`forwardComments` 侧本就"游标 hold 自动重试"。JiraNotFound 仍立即 markTerminal 不重试。

### D5: 组件归属——薄适配层 + 公开入口（Q4）

新建 `src/adapters/feishu/events.ts`：包 SDK `WSClient`、订阅 `im.message.receive_v1`、归一化（纯函数 `normalizeEventPayload`，可独立单测）、暴露 `onMessage`/`onReconnect` 回调。`CommentBridge` 增加 `ingestMessage(msg)` 公开入口，内部持队列。组合根 `runStart()` 接线：`onMessage → bridge.ingestMessage`、`onReconnect → bridge.sweepNow()`。**否决塞进 FeishuSource**（生命周期混乱）与**写进 CommentBridge**（桥背 SDK 依赖，6 个测试文件连坐）。

### D6: 路由边界与现状完全对齐（Q6）

`chat_id !== intake_chat_id` 丢弃（debug 日志）；私聊丢弃；`sender_type === "app"` 丢弃（防环）；非 text/post、空文本丢弃；intake 群 root 消息 → intake 路径；`root_id` 命中 active binding → thread 路径；命中不了（野话题/terminal binding）丢弃。原则：事件化只改"怎么知道有消息"，不改"哪些消息算数"。

### D7: 配置键拆分（Q3）

`feishu.poll_interval_ms` → 改名 `feishu.forward_interval_ms`（默认 5000，快循环只跑 forwardComments，Jira 侧无配额压力）；新增 `feishu.sweep_interval_ms`（默认 43200000=12h）。**旧键硬删除**（validator 报错即迁移指引，`init --update` 提示新字段），不做别名兼容——单人工具，别名只掩盖误配。镜像延迟取舍：Jira→飞书 = forward 间隔（2s 级），与收侧解耦。

### D8: 降级稳态，无开关（Q7）

建连失败：WARN 一条（含控制台自检提示）+ 60s 静默重试（debug 日志防刷屏），daemon 照常启动。断线：SDK 自动重连，成功即触发 sweep。连上但收不到（订阅误配/版本未发布）：不检测（启发式易误报），12h sweep 兜底 + quickstart 1 分钟自检法（发条消息看 `event received` 日志）。稳态等效慢轮询：功能不残缺只是慢。

### D9: 429 冷却（Q8）

任何飞书 REST 调用 429 → 冷却 60s 起翻倍封顶 10 分钟，任一成功复位。冷却期：forward 跳发（**游标 hold，恢复自动补发**——复用现有语义）、sweep 跳轮、ack 跳过（best-effort）。事件接收不受影响（豁免通道）。防的真实场景：租户内其它应用烧光共享额度时，forward 快循环每 2s 白打一次（429 调用不计额度但锤接口+刷日志）。

### D10: 测试策略（Q9）

单元：路由矩阵/claim/串行/重试直接喂 `ingestMessage()`，绕开 SDK；归一化纯函数单测（覆盖 `msg_type` 命名差异、毫秒→秒）；cooldown 单测（mock FeishuSource 429）。E2E（硬门）：`feishu-mock` 加 `emitMessage()`，主流程切事件通道 + 一条"sweep 补回绕过事件的消息"专项。真实集成：仅建连冒烟；完整事件流**不可全自动**（事件须 `sender_type=user` 触发，bot 自发会被路由过滤），做半自动 `npm run test:event-flow`（INTEGRATION=1、人发一条消息、断言全自动、超时单独放宽、Jira 侧沿用 create-then-delete 清理语义/ADR 0015）。

## Risks / Trade-offs

- **[单实例假设被打破]** → 多实例时集群模式随机路由 + 各自 sweep = 重复消费。缓解：文档 + ADR 明示；daemon.json 已有 pid 记录，未来可加启动锁（本期不做）
- **[队列项进程崩溃丢失]** → 启动 sweep 按游标补回；窗口 = 崩溃到重启之间无实时性，无丢失
- **[12h sweep 期间静默丢事件]** → 僵尸连接类罕见态，最长 12h 补回；心跳机制使此概率极低
- **[WS 误配不可检测]** → 降级稳态不报错不响；缓解：quickstart 自检法 + WARN 提示文案覆盖三大误配点（订阅方式/事件未加/版本未发布）
- **[SDK 传递依赖膨胀/Node22 兼容]** → 锁定版本；spike 已在 Node 22 验证；离线包重建流程已有（pack-deps.sh）
- **[Jira→飞书镜像延迟被误解为本次回归]** → forward 快循环保留，延迟与现状一致；文档明示两个节奏的职责
- **[旧键残留 WORKFLOW.md]** → validator 报错给出改名指引；`init --update` 漂移报告提示新键

## Migration Plan

1. 实施期（单 PR）：事件通道 + 队列 + sweep 拆分 + cooldown + 配置键 + 测试，一次合入
2. 部署期（运维者）：升级二进制 → `WORKFLOW.md` 改键名 → 飞书控制台一次性配置（订阅方式=长连接、加事件、发版本）→ `bash scripts/pack-deps.sh`（CI 前置）→ 快速自检
3. 回滚：git revert 即回纯轮询架构；游标语义未变，bindings.db 无迁移，双向兼容

## Open Questions

无——拷问会话（2026-08-27）已逐项定案 Q1-Q10，全部决议落入上文 D1-D10 与 ADR 0018。
