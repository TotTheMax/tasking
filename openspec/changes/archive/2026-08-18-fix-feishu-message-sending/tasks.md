## 1. post 富文本拍平（FeishuSource 归一化层）

- [x] 1.1 实现 `flattenPostContent` 纯函数（红：`tests/feishu-source.test.ts` 先写单测——多行/行内多块/图片占位/at/标题/空回退；绿：`src/adapters/feishu/source.ts` 实现）。
- [x] 1.2 `parsePolledMessage` 对 `msg_type === "post"` 的消息用 `flattenPostContent` 拍平 `text`（红：`listMessages`/`listThreadReplies` 返回的 post 条目 `text` 为拍平文本而非原始 JSON；绿：在 `parsePolledMessage` 接入）。

## 2. 桥接可读类型含 post

- [x] 2.1 `discoverIntake` 把 `post` 视为可读：intake 群 `post` 型多行 `/issue` 正常建 issue + 首条 comment + 已创建回执（红：`tests/comment-bridge.test.ts` 加 post 条目用例断言 issue 创建与回执；绿：把 `m.msg_type !== "text"` 判断改为可读类型谓词）。
- [x] 2.2 `bridgeMessages` 把 `post` 视为可读：话题内 `post` 型人自由文本桥成带 sentinel 的 Jira comment、`post` 型 `/state` 等命令正常执行（红：comment-bridge 测试两条断言；绿：同样改谓词）。

## 3. 游标增量（重启不重复发）

- [x] 3.1 `listThreadReplies(threadId, since?)` 把 since 归一化后作为 `start_time` 传给飞书 API（红：`tests/feishu-source.test.ts` 断言 URL 含 `start_time=<since秒>`；绿：实现 since 参数）。
- [x] 3.2 `bridgeMessages` 恢复持久化游标过滤：`create_time <= 游标` 的消息跳过，模拟"重启后新 CommentBridge 实例（空 processed Set）+ 已推进游标"不再重复桥接/执行（红：comment-bridge 测试先推进游标再开新实例断言不重发；绿：加 `if (since !== "" && Number(m.create_time) <= Number(since)) continue;`）。

## 4. 全量验证与文档

- [x] 4.1 `npm run lint && npm run typecheck && npm test` 全绿（含既有 545 用例不回归）。
- [x] 4.2 文档同步：`docs/feishu-quickstart.md` 验证清单注明多行/富文本消息同样支持（如适用，`docs/known-issues.md` 一并更新）。
