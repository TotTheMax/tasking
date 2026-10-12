## 1. Feishu adapter: card and file sends (seam: `FeishuSource` public methods vs mock HTTP)

- [x] 1.1 先写失败的适配器测试（`tests/feishu-source.test.ts`，mock-http-server），断言话题内发卡与更新卡的请求形状（`POST .../reply` `msg_type: interactive` `reply_in_thread: true` 返回 message_id/thread_id；`PATCH /im/v1/messages/:id` body 为 `content` 字符串），再实现 `replyCardInThread` 与 `updateCard`（非 0 code → `TaskingError`）
- [x] 1.2 先写失败测试断言 multipart 上传取 `file_key`、再以 `msg_type: file` 回复到话题，以及缺权限（99991672）抛 `TaskingError`；再实现 `uploadFile` 与 `sendFileMessage`
- [x] 1.3 扩展 `DirectFeishuPort`（`src/direct/manager.ts`）为卡片/文件方法，并让真实 `FeishuSource` 与测试假实现同时满足；卡片/文件方法在 port 上设为可选（缺失即等于卡片能力不可用，落进文本降级路径），故既有假 port 无需改动

## 2. Event channel: `card.action.trigger` (seam: `FeishuEventListener` with injected `clientFactory`)

- [x] 2.1 先写失败测试（注入 `clientFactory`）断言 `card.action.trigger` 被注册、归一化后的 `{message_id, chat_id, operator_open_id, value}` 送达转交处理器；再在 `src/adapters/feishu/events.ts` 增加归一化与注册（保留 `im.message.receive_v1` 行为不变）
- [x] 2.2 先写失败测试断言缺 message_id / 缺 value 的回调被忽略且记 debug、不影响消息事件；再实现忽略分支

## 3. Card renderer (seam: `buildTurnCard(state)` pure function)

- [x] 3.1 先写失败测试断言卡片 2.0 结构（`schema`、`config.update_multi`、头部含会话名/状态/累计/队列、Turn 分隔行、assistant 文本、按钮行为最后一个元素），再实现 `src/direct/card.ts` 的 `buildTurnCard`
- [x] 3.2 先写失败测试断言面板内容（状态+退出码+耗时、工具名、命令或参数、输出**末尾 15 行**与 `… (N more lines)`、`… (opencode truncated)`），再实现面板渲染
- [x] 3.3 先写失败测试断言失败面板默认展开且带失败标识、成功面板默认折叠、最新面板不自动展开，再实现折叠默认值
- [x] 3.4 先写失败测试断言四种按钮行形态（运行中 / 已完成 / 已封存 / 确认中）与对象型 `value`，再实现按钮行
- [x] 3.5 先写失败测试断言 24KB 预算的三级最旧优先降级（输出 3 行 → 去输出 → 压成"还有 N 个未展示"），再实现预算与降级

## 4. Turn lifecycle: create / update / seal (seam: `DirectSessionManager` with fake port + scripted spawn)

- [x] 4.1 先写失败测试断言 detailed 轮次在占用目录/并发额度**之前**建卡、detailed 不再发"会话已创建/已排队"文本与逐工具文本；再改造 `runTurnLoop`/`executeTurn` 的交付路径（summary/quiet 行为不变）
- [x] 4.2 先写失败（假时钟）测试断言 1.5 秒合并与终态/失败事件立即刷新、更新失败退避重试一次后自愈；再实现累积器与刷新策略
- [x] 4.3 先写失败测试断言下一轮开始时上一轮卡片按钮行被替换为统计行且面板/文本/展开态不变；再实现封存
- [x] 4.4 先写失败测试断言建卡失败与中途连续更新失败都切换为合并文本（每次 flush 一条，绝不退回逐工具）且记 WARN、turn 不中断；再实现降级
- [x] 4.5 先写失败测试断言完成文本在 quiet/summary/detailed 三档下的差异与失败/超时说明；再实现收尾文本

## 5. Buttons and card actions (seam: `DirectSessionManager` card-action handling)

- [x] 5.1 先写失败测试断言处理函数在 3 秒内返回 `{toast, card}` 且慢操作（删 session、发文本）在返回之后才发生；再实现快路径处理函数
- [x] 5.2 先写失败测试断言 `🛑 结束` 两步确认（首次仅返回确认态、确认后才结束并发带操作人的文本）与 `⏹ 中断` 一步即时；再实现两者
- [x] 5.3 先写失败测试断言对已封存/非当前轮的 `⏹ 中断`、`📄 完整输出` 只回 toast、状态不变；再实现 `turn` 守卫
- [x] 5.4 先写失败测试断言重复投递的同一动作只执行一次（LRU 键含 message_id/操作人/动作）；再实现去重
- [x] 5.5 先写失败测试断言 `🔁 重试` 用 `last_prompt` 发起新一轮且新卡片标注重试来源；再实现重试

## 6. `📄` full output on demand (seam: manager accumulator + adapter file send)

- [x] 6.1 先写失败测试断言累积器保留完整明细、1MB 上限下丢最旧并注明、`📄` 产出 `.md` 并调用文件发送；再实现累积与投递
- [x] 6.2 先写失败测试断言上传失败降级为 ≤140KB 长文本并说明原因、超限只回 TUI 指针、均记 WARN；再实现降级链
- [x] 6.3 先写失败测试断言该按钮只出现在最近一轮卡片、历史卡不出现；再实现按钮可见性规则

## 7. Persistence, recovery and finalization (seam: `BindingStore` + manager)

- [x] 7.1 先写失败测试断言 `direct_sessions` 新增 `card_message_id`/`last_prompt` 的 `ALTER TABLE` 迁移与读写；再实现列与访问器
- [x] 7.2 先写失败测试断言 `recover()` 把 running 会话的卡片收尾为"已中断（daemon 重启）"（面板不保留，见 spec 修订）、按钮收缩为 `🔁 重试`/`🛑 结束`，并发送中断文本；再实现
- [x] 7.3 先写失败测试断言打字版 `/done`、`/stop` 会收尾对应卡片，TTL 过期把最近卡片标为已过期并清按钮；再实现
- [x] 7.4 先写失败测试断言收尾 PATCH 失败（消息撤回/超 14 天）只记 WARN、不影响状态机；再实现容错

## 8. Wiring

- [x] 8.1 先写失败测试断言卡片动作经事件通道直达直连管理器**不进入**消息入站队列、消息事件路径行为不变；再在 `src/cli/index.ts` 完成接线
- [x] 8.2 先写失败测试断言 `summary`（默认）下不创建卡片、不产生任何卡片 API 调用（配置面零新增）；再把 verbosity 语义固化进实现

## 9. End-to-end, gates and docs

- [x] 9.1 扩展 `tests/helpers/feishu-mock.ts` 记录卡片发送/更新并能回放按钮点击；先写失败的 mock 驱动 E2E（turn → 卡片演进 → 封存 → 点按钮 → 状态变化），再让流程通过
- [x] 9.2 扩展真实 API 集成测试（`INTEGRATION=1`）：真实发卡、更新卡、上传并发送文件成功（按钮点击不在自动化范围）
- [x] 9.3 更新 `docs/{zh,en}/configuration.md`（verbosity 三档新语义）、`docs/{zh,en}/architecture.md`（卡片过程面、卡片动作快路径、卡片 vs TUI activity 两条数据面）、`docs/{zh,en}/usage.md`（按钮用法 + 人工验收步骤 + 两项控制台前置），保持双语 parity
- [x] 9.4 跑门禁：`npm run lint`、`npm run typecheck`、`npm test`、`npm run test:e2e`；`npm run test:event-flow` 已在 E2E 测试群通过（/issue + 话题回复均到达）；四个按钮经生产环境真机验收通过（中断封存后仍显示已中断、重试、完整输出文件、结束两步确认）
