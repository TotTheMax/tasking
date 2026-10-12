## Why

用户反馈：在飞书里发送含多行描述/格式化文本的 `/issue` 命令（或话题内多行自由文本），tasking 不会把它加进 Jira。根因：飞书客户端把多行/富文本消息投递为 `msg_type: "post"`（富文本）而非 `"text"`，而桥（`discoverIntake`、`bridgeMessages`）对非 `text` 消息一律跳过，导致 `/issue` 建不了 issue、话题内自由文本也桥不成 Jira comment。

顺带确认的同链路 bug：`bridgeMessages` 的持久化游标过滤在 commit 78b2740 被误删，daemon 重启后会把最近 24h 话题窗口内已桥过的消息重复 POST 到 Jira（生产实锤：TAS-4 评论 11400/11402 重复），`/state` 等命令也会被重复执行。这与 `docs/feishu-quickstart.md` 明示的"重启重发：不会"保证矛盾。

## What Changes

- 消息归一化：`parsePolledMessage` 对 `post`（富文本）消息把 content JSON 拍平成纯文本，得到真实 `text`（标题+段落+行内文本段拼接），非文本块（图片等）以占位符或忽略处理。
- 桥接范围：`discoverIntake` 与 `bridgeMessages` 把 `text` 与 `post` 两种消息类型都视为可读文本——intake 群的 `post` 型 `/issue` 正常建 issue + 首条 comment + 回执；话题内 `post` 型自由文本正常桥成带 sentinel 的 Jira comment、命令正常处理。
- 游标增量：`listThreadReplies` 新增 `since` 参数（服务端 `start_time` 增量拉取），`bridgeMessages` 恢复按持久化游标过滤，杜绝重启后重复发/重复桥接。
- 文档与测试同步更新。

## Capabilities

### New Capabilities

### Modified Capabilities

- `feishu-source`: `post`（富文本）消息被拍平为纯文本并纳入可桥接范围（不再无差别忽略）；话题消息按游标增量拉取、重启不重复发送。

## Impact

- 改：`src/adapters/feishu/source.ts`（`flattenPostContent`、`parsePolledMessage` 对 post 归一化、`listThreadReplies(threadId, since?)`）、`src/bridge/comment-bridge.ts`（可读消息类型判断、恢复 `bridgeMessages` 游标过滤）。
- 测试：`tests/feishu-source.test.ts`（post 拍平、游标参数）、`tests/comment-bridge.test.ts`（post 型 `/issue` 建 issue、话题 post 桥接、跨重启不重复发）、`tests/commands.test.ts`（如有纯函数辅助）。
- 文档：`docs/feishu-quickstart.md`（可选，验证清单注明富文本/多行也支持）、`docs/known-issues.md`（若适用）。
- 不动：scheduler、worker、mcp 注入、binding-store schema、`src/adapters/jira/*`。
