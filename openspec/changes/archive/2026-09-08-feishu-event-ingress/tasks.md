# Tasks: feishu-event-ingress

## 1. 依赖与准备

- [x] 1.1 添加 `@larksuiteoapi/node-sdk`（锁定版本）到 dependencies；确认 Node 22 下 import 无警告（spike 已验证）；**不要**在本任务提交 lockfile（最终任务统一 pack-deps）

## 2. 事件归一化（纯函数，红→绿）

- [x] 2.1 写失败测试：`normalizeEventPayload` 把 SDK `im.message.receive_v1` payload 映射为 `FeishuPolledMessage`——覆盖 `message_type`→`msg_type`、`create_time` 毫秒→秒、`root_id`/`parent_id`/`thread_id` 透传、post 文本拍平、缺失字段容错（新建 `tests/feishu-events.test.ts`），然后实现（放 `src/adapters/feishu/events.ts`，复用 `parseTextContent`/`flattenPostContent`/`toSecondsStr`）

## 3. FeishuEventListener 薄适配层

- [x] 3.1 写失败测试：`FeishuEventListener` 接受注入的 wsClient 工厂（便于 mock）；事件到达 → 归一化 → `onMessage` 回调；然后实现订阅注册与回调分发
- [x] 3.2 写失败测试：建连失败 → 输出一条 WARN（含三类误配提示文案）→ 60s 后重试且重试日志为 debug 级；连接成功 → `onReconnect` 触发一次且仅一次；然后实现重试/重连回调逻辑

## 4. CommentBridge 入站队列（红→绿）

- [x] 4.1 写失败测试：`ingestMessage(msg)` 入队即 claim（同 msg_id 第二次入队被丢弃）→ 单消费者串行处理（两条消息按入队序完成）；然后实现队列与公开入口
- [x] 4.2 写失败测试：路由矩阵逐行——非 intake 群丢弃、私聊丢弃、`sender_type=app` 丢弃、非 text/post 与空文本丢弃、intake root 走 intake 路径、root_id 命中 active binding 走话题桥接、野话题/terminal binding 丢弃（均断言"丢弃=无 Jira 写入无回复"+debug 日志）；然后实现路由
- [x] 4.3 写失败测试（fake timers）：postComment 失败 → 30s/2m/10m 三次退避重试 → 成功则桥接完成；全败则失败 ack + 游标推进；Jira 404 立即 markTerminal 不重试；然后实现（`forwardComments`/intake 侧失败语义与今日一致，不回退游标）
- [x] 4.4 写失败测试：Sweep 触发点——`sweepNow()` 立即执行；启动时执行一次；`sweep_interval_ms` 定时器触发；Sweep 拉到的消息走同一入队口（与事件竞态不双投）；然后实现 Sweep 方法与触发点接线

## 5. 循环拆分与配置键（红→绿）

- [x] 5.1 写失败测试（`tests/config.test.ts`）：`feishu.poll_interval_ms` 被 validator 拒绝并提示改名 `feishu.forward_interval_ms`；`feishu.sweep_interval_ms` 缺省默认 43200000、可覆盖；resolver 输出两个新键；然后改 `config-types.ts`（DEFAULTS）/`resolver.ts`/`validator.ts`
- [x] 5.2 写失败测试：forward 快循环以 `forward_interval_ms` 节奏只跑 `forwardComments`（不再拉飞书消息）；Sweep 以独立定时器跑 `bridgeMessages`+`discoverIntake`；然后拆分现有 tick 循环，更新 `tests/comment-bridge.test.ts` 中受影响的用例

## 6. 429 冷却（红→绿）

- [x] 6.1 写失败测试：mock `FeishuSource` 抛 429 → 冷却 60s 起翻倍封顶 10 分钟 → 任一 REST 成功复位；冷却期 forward 跳发且 Jira 游标 hold（恢复后补发）、Sweep 跳轮、ack 跳过；事件入队不受影响；然后实现冷却状态机（桥层，包裹所有飞书 REST 调用点）

## 7. 组合根接线

- [x] 7.1 写失败测试（`tests/regression.test.ts` 或新建）：`runStart` 装配 `FeishuEventListener`——`onMessage → bridge.ingestMessage`、`onReconnect → bridge.sweepNow()`、`feishu.enabled=false` 或构造失败时 daemon 照常启动；然后接线 `src/cli/index.ts`

## 8. E2E 与 mock 基建（硬门）

- [x] 8.1 `tests/helpers/feishu-mock.ts` 增加 `emitMessage(msg)`；`tests/bridge-flow.test.ts` 主流程改为事件驱动（`/issue` 建 issue、话题回复桥成 Jira 评论、命令处理均经 `ingestMessage`），保持既有断言全绿
- [x] 8.2 `tests/bridge-flow.test.ts` 新增专项用例：消息绕过事件通道直接写入 mock 会话 → Sweep 触发后按游标补回并桥接，游标推进与去重正确

## 9. 真实集成与半自动验证

- [x] 9.1 `tests/integration-real.test.ts` 增加建连冒烟：真实凭证启动 `FeishuEventListener`，N 秒内断言 connected（INTEGRATION=1 门内，不可达则 skip）
- [x] 9.2 新增 `tests/integration-event-flow.test.ts` + `package.json` script `test:event-flow`：提示人工在测试群发一条消息（分钟级等待窗，文件级放宽 vitest timeout），随后全自动断言——事件归一化 → binding 命中 → Jira 真实出现评论 → thread ack；Jira 侧沿用 create-then-delete 清理（ADR 0015）；不进任何 CI 门禁

## 10. 文档与收尾

- [x] 10.1 `docs/{zh,en}/feishu-quickstart.md`：控制台一次性配置全步骤（订阅方式=长连接 → 添加 `im.message.receive_v1` → 创建版本并发布）+ 1 分钟自检法（发条消息看 `event received` 日志）+ 单实例约束说明
- [x] 10.2 `docs/{zh,en}/configuration.md`：`forward_interval_ms`/`sweep_interval_ms` 键、默认值与双节奏职责表；`docs/{zh,en}/architecture.md`：事件通道/入站队列/Sweep 架构段；跑 `tests/docs-links.test.ts` 确认双语 parity
- [x] 10.3 全量门禁：`npm run lint` → `npm run typecheck` → `npm test`（含 test:e2e）；可达时 `INTEGRATION=1 npm run test:integration`
- [x] 10.4 `bash scripts/pack-deps.sh` 重建离线依赖包（lockfile 已变更，CI 前置必需）
