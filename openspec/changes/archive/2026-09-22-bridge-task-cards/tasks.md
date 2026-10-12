## 1. Adapter & event routing

- [x] 1.1 群聊平铺发卡：先写失败测试断言 `replyCardFlat` 以 `POST /im/v1/messages/:rootId/reply`（不设 `reply_in_thread`）、`msg_type: interactive` 发送并返回 message_id、失败抛 `TaskingError`；再实现（复用 `replyPayload`）
- [x] 1.2 卡片动作按来源路由：先写失败测试断言带 `kind: bridge` 的动作转交桥、缺省仍走直连、重投（相同 message id+操作人+动作值+序号）被去重且不重复执行；再实现 event-channel 分流 + 桥侧去重表
- [x] 1.3 桥的卡片回落：先写失败测试断言适配器无发卡能力或发卡抛错时，桥的信息类回执回落为纯文本且命令语义不变；再实现桥侧 `replyFlatCard`/`replyThreadCard`（含回落；测试：thread `/help` 发卡失败 → 纯文本）

## 2. Command reply cards

- [x] 2.1 `/help` 卡片：先写失败测试断言群聊与话题内 `/help` 均回卡片（含 `/issue`/`/state`/`/agent`/`/help` 语法），无发卡能力时回落文本；再实现（`HELP_LINES` + `helpCard`）
- [x] 2.2 `/agent` 列表卡：先写失败测试断言无参 `/agent` 回卡片（可用 agent + 当前值）；再实现（`renderAgentList` 改为返回行数组）
- [x] 2.3 一次性回执保持文本：写测试断言 intake `已收到 ✓`、话题 `✅ 已同步到 <key>`、参数错误/失败提示仍是纯文本消息（既有 ack 断言覆盖）

## 3. Comment mirror cards

- [x] 3.1 评论镜像改卡：先写失败测试断言 Jira 新评论在话题内呈现为一张卡片（含作者与正文）、不产生纯文本镜像、评论数量与顺序不变；再实现（`buildCommentCard` + `sendCommentCard`，发卡失败回落 `renderForwardedComment` 文本）
- [x] 3.2 长评论截断与按需展开：先写失败测试断言超预算时正文被截断、点 `📄 完整输出` 后装得进预算则 PATCH 就地展开、超预算则上传 `.md` 并在话题内发出；再实现（`deliverFullComment`）
- [x] 3.3 `打开 Jira` 按钮：先写失败测试断言按钮为 `open_url` 且 URL 为 `${baseUrl}/browse/${issueKey}`（baseUrl 由 endpoint 推出）；再实现（导出 `jiraBrowseUrl`，`normalizeIssue` 复用）
- [x] 3.4 镜像卡不被回灌：写回归测试断言桥读话题回复时跳过 `sender_type === "app"` 的卡片，不产生新的 Jira 评论（既有 app 跳过回归测试覆盖）

## 4. Task state card

- [x] 4.1 绑定记录存状态卡 message id：先写失败测试断言新列可空、读写与老记录兼容；再实现（`bindings.card_message_id` + `setBindingCardId`；含 `binding-store` 测试）
- [x] 4.2 绑定发出状态卡并在状态变化时 PATCH：先写失败测试断言 `/issue` 绑定后出现一张含 key/状态/负责人的状态卡、Jira 状态变化时原地 PATCH（不新增消息）；再实现（`publishStateCard`/`patchStateCard`；绑定后发卡、issue 消失时 PATCH「已完结」）
- [x] 4.3 状态卡自愈：先写失败测试断言 PATCH 失败后重发新卡并更新 id、记 WARN；再实现

## 5. Transition flow

- [x] 5.1 `/state` 与状态卡合一：先写失败测试断言 `/state`（无参）发/刷新任务状态卡、`/state <N|name>` 仍可转状态；再实现（`/state` 无参 = `publishStateCard`，文本转换与卡片共用 `fetchTransitions`/`transitionIssue`）
- [x] 5.2 `🔀 转状态` 实时拉取：先写失败测试断言点击后按当前 `GET /issue/{key}/transitions` 渲染按钮（不是渲染时预置的列表）；再实现（`state_open` → `transitionConfirmCard` 前一步）
- [x] 5.3 确认后应用：先写失败测试断言"选转换 → 确认"才写 Jira、成功后 PATCH 状态卡 + 即时 nudge + 话题广播；"取消"不产生写操作；再实现（`tr_confirm` → `applyTransition`，异步执行、立即回 toast）

## 6. Docs & gates

- [x] 6.1 更新 `docs/{zh,en}/usage.md`（桥命令卡片行为、任务状态卡与转状态流程、评论镜像改为卡片的 **BREAKING** 说明）
- [x] 6.2 跑门禁：`npm run lint`、`npm run typecheck`、`npm test`、`npm run test:e2e`；可连内网时跑 `npm run test:integration`；真机验收（短/长评论镜像、点 `📄`、点 `🔀` 完成一次状态转换、手机端确认可读到全文）——2026-09-22 依据 daemon 日志验收：state_open/tr/tr_confirm/tr_cancel/refresh/summon/agent_set/full 全部有真实点击，卡片相关失败告警为 0

## 7. Acceptance follow-ups (manual test feedback)

- [x] 7.1 `📄 完整输出` 仅在正文被截断时出现，点击一律发 `.md` 文件，失败在话题内可见（问题：短评论点击后无反应）
- [x] 7.2 状态卡新增 `🔄 刷新` 按钮：实时拉取并就地换卡（优化建议）
- [x] 7.3 桥/直连卡片动作去重只作用于写操作，`🔄 刷新`/打开列表/取消可重复点击（问题：再点提示"该操作已处理"；直连信息卡同类修复）
- [x] 7.4 状态卡召回式重发：`/state` 无参与召唤先删旧卡再在底部发新卡（适配器新增 `deleteMessage`；问题：卡片随消息堆深沉底、旧卡残留；Pin 方案实测后放弃）
- [x] 7.5 评论镜像卡新增 `📋 状态` 召唤按钮：异步在底部发实时状态卡
- [x] 7.6 `/issue` 无参列表改为卡片呈现（补齐 spec 明确列出的信息类回执）
- [x] 7.7 修复 `/issues` 等粘连误触发建单：`parseIssue` 加词边界（`/^\/issue(?:\s|$)/`），`/chat`/`/state`/`/agent` 核查无此问题
