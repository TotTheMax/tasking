## Context

用户在多行/富文本格式下发送 `/issue`（intake 群）或话题内自由文本，tasking 未加进 Jira。飞书把含换行或格式化内容的消息投递为 `msg_type: "post"`（富文本，content 是 JSON），桥的 `discoverIntake` 与 `bridgeMessages` 只认 `"text"`，`post` 消息被整体跳过——不解析、不回执、不桥接。

同链路第二个 bug：`bridgeMessages` 在 commit 78b2740 修复"话题根消息误回 /issue 引导"时误删了持久化游标过滤（`since`），`listThreadReplies` 也从不带游标，永远拉最近 24h；去重只靠进程内 `processed` Set。daemon 重启后旧消息被重扫：已桥消息重复 POST 成 Jira comment（TAS-4 评论 11400/11402 重复实锤）、`/state` 等命令重复执行。

## Goals / Non-Goals

**Goals:**
- `post`（富文本）消息被拍平成纯文本，纳入可读/可桥接范围：intake 群 `post` 型 `/issue` 正常建 issue + 首条 comment + 回执；话题内 `post` 型自由文本正常桥成 sentinel comment、命令正常处理。
- 恢复 `bridgeMessages` 的持久化游标增量语义：重启后不再重发已桥消息、不重复执行命令。
- 最小侵入：只改飞书适配器的消息归一化与桥的消息类型判断/游标，不动 scheduler/worker/mcp/binding schema。

**Non-Goals:**
- 图片/文件/卡片/`interactive` 等无文本内容的类型仍不桥接（维持 v1 范围，见 `openspec/specs/feishu-source`）。
- 不修 `BindingStore.upsertBinding` 的 INSERT OR IGNORE 问题。
- 不给 Feishu adapter 加业务 `code` 校验。
- 不重构 `forwardComments`（Jira→飞书方向已是文本）。

## Decisions

### D1: post 消息在适配器归一化层拍平，而非各使用点各自处理
`parsePolledMessage` 对 `msg_type === "post"` 的 content JSON 用 `flattenPostContent` 拍平成纯文本填进 `text` 字段。所有下游（discoverIntake、bridgeMessages、日志）拿到的是真实文本。
- 备选：在 discoverIntake/bridgeMessages 各自调 flatten 辅助。否决：适配器本就负责"消息归一化"（`parsePolledMessage`），在该层拍平 DRY 且天然覆盖所有消费方。

### D2: 桥用"可读消息类型"谓词，而非把 post 冒充 text
`msg_type` 保持原始值（`"post"`），桥新增 `isReadableText(type)`（`"text"` 或 `"post"`）用于两处判断：
- `discoverIntake`：`if (!isReadableText(m.msg_type) || m.sender_type === "app") continue;`
- `bridgeMessages`：`if (!isReadableText(m.msg_type) || m.sender_type === "app" || isCommand(m.text)) ...`

### D3: flattenPostContent 规则
content JSON 结构 `{ title?, content: [[block]] }`。逐行拼块：`text`/`a`/`plain_text`/`md`/`emoji` 取 `text`；`at` 取 `@{user_name}`（真实飞书元素字段为 `user_name`）；`img` 取 `[图片]`；其它块忽略。行间以 `\n` 连接；`title` 非空时作为首行。拍平失败或结果为空 → 返回空字符串，桥按空文本跳过（不桥接、不回执、不把原始 JSON 泄漏进 Jira）。纯函数、可单测，放 `src/adapters/feishu/source.ts`。

### D4: 恢复游标增量：listThreadReplies 加 since
`listThreadReplies(threadId, since?)`：`since` 经 `toSecondsStr` 归一化后作为 `start_time` 传给飞书 API（服务端增量）；`bridgeMessages` 恢复 `if (since !== "" && Number(m.create_time) <= Number(since)) continue;` 兜底（防止秒级边界重复，与 `discoverIntake` 一致）。`processed` Set 保留作进程内 tick 级去重；跨重启正确性由持久化游标保证。

## Risks / Trade-offs

- [post 块结构因客户端/版本而异（图片、at、链接、样式段）] → flatten 防御式：未知块跳过、空结果回退原串，绝不抛错；图片块落 `[图片]` 占位使文本仍可桥。
- [游标为秒级，`start_time` 会重复返回与游标同秒的消息] → 保留客户端 `<= since` 过滤；与 discoverIntake 既有语义一致，接受秒级边界。
- [把 post 纳入桥接可能引入含图片占位的"噪音"文本] → `[图片]` 占位 + 空文本跳过，可读性可接受；v1 明确把纯视觉消息排除。
- [拍平后 `/issue` 描述含富文本标记（如 `*bold*`、`{}`）] → 保持原文透传（不剥离样式标记），Jira comment 内容保真；这是用户所见即所得，不做格式化猜测。

## Migration Plan

- 无 schema/数据迁移。升级 daemon 后新逻辑即时生效；存量 binding 游标不变。
- 回滚：还原 `source.ts`/`comment-bridge.ts` 两文件即可（无持久化副作用）。
