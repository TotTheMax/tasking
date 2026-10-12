## Why

Jira 任务这条飞书路径的交互全是**纯文本**：命令回执（`/help`、`/issue` 列表、`/agent` 列表、`/state` 结果）和 Jira 评论镜像都是一条条文字消息。这带来两个实际问题：

1. **手机端不可用**：内网 Jira 链接在手机飞书里打不开，而长评论只能看到截断后的文字，读不到全文。
2. **无法就地操作**：转状态只能靠记 `/state` 的文本用法；直连会话已有卡片体验（`direct-session-turn-cards`），两条路径体验割裂。

基础设施已经就位：适配器有发卡/改卡/上传文件能力（`replyCardInThread`/`updateCard`/`uploadFile`/`sendFileMessage`），事件通道能收 `card.action.trigger`，直连的卡片渲染、两步确认、长内容投递都已有可复用的模式。

## What Changes

- **桥的命令回执卡片化**：`/help`、`/issue` 列表、`/agent` 列表 → 卡片（`/agent` 列表带按钮）；`/state` 与新的状态卡合一（`/state` = 发/刷新状态卡）。一次性 ack（`已收到 ✓`、`✅ 已同步到 TAS-x`、参数错误提示）保持纯文本。
- **Jira 评论镜像卡片化**：每条镜像评论一张卡，含作者/时间头、正文（按卡片预算截断）、`📄 完整输出`、`打开 Jira`（`open_url`，桌面端有效）。
- **新增独立任务状态卡**：每个 issue↔话题绑定一张，创建绑定时发出，状态变化时 PATCH 更新；带 `🔀 转状态` 按钮。点击后**实时**拉取当前可转换状态 → 每个转换一个按钮 → 确认/取消两步 → 应用并 PATCH 状态卡，同时在话题内广播结果。
- **长评论按需展开**：`📄 完整输出` 复用直连的投递策略——装得进卡片预算就 PATCH 就地展开，超预算则上传 `.md` 附件并在话题内发出（手机飞书可直接打开）。**不默认**为每条长评论发附件。
- **适配器与事件接线**：新增群聊平铺发卡 `replyCardFlat`；事件通道的 card action 按来源路由（当前只转发给直连），桥侧新增点击去重。
- **BREAKING**: 评论镜像从 `text` 消息变为 `interactive` 卡片消息；任何按"评论正文是一条纯文本消息"来消费话题的外部集成会受影响（本仓库内仅测试与桥自身）。

Explicit non-goals: 不改 sentinel 去重与游标语义；不在每条评论卡上挂"转状态"（避免历史卡变成过期控制面板）；不引入公网回调（仍走 WS 事件通道）；不做评论正文的表格/标题渲染（卡片 markdown 是子集，正文超限只截断或按需展开）。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `comment-bridge`: 命令回执以卡片呈现；Jira 评论镜像为卡片；新增每 issue 一张的任务状态卡与"点击→选状态→确认"的转状态流程；`/state` 与状态卡合一。
- `feishu-source`: 新增群聊平铺发送交互卡片的能力。
- `feishu-event-ingress`: 卡片动作按来源路由到直连或桥，并在桥侧去重。

## Impact

- `src/adapters/feishu/source.ts`（`replyCardFlat`）、`src/adapters/feishu/events.ts`（卡片动作归一化，如需要则补字段）。
- `src/bridge/comment-bridge.ts`（命令回执改卡、评论镜像改卡、状态卡生命周期、`handleCardAction` + 转状态流程）、`src/bridge/commands.ts`（`/help` 文案与按钮模型、状态卡渲染）、`src/bridge/binding-store.ts`（绑定表存状态卡消息 id）。
- `src/cli/event-channel.ts`（按 `value.kind` 分流 card action）。
- `src/direct/card.ts` 的渲染器作为可复用参考（不强行抽公共模块，除非边界清晰）。
- 文档：`docs/{zh,en}/usage.md`（桥命令的卡片行为、状态卡用法）、`docs/{zh,en}/architecture.md`（如涉组件职责变化）；`CONTEXT.md` 增补"任务状态卡"术语。
- 测试：`tests/bridge-flow.test.ts`（E2E 门禁）、`tests/comment-bridge.test.ts`、`tests/feishu-source.test.ts`、`tests/event-channel.test.ts`、`tests/binding-store.test.ts`。
