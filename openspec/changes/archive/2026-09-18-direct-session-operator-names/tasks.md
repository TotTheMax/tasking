## 1. Adapter

- [x] 1.1 先写失败测试（`tests/feishu-source.test.ts`）断言 `listChatMembers` 的请求形状（`/im/v1/chats/:chat_id/members`、`member_id_type=open_id`、翻页）与解析结果（`{open_id, name}`），失败抛 `TaskingError`；再实现

## 2. Manager

- [x] 2.1 先写失败测试断言操作人解析优先级（`operator.name` → 缓存 → 查询 → open_id）与解析失败回落；再实现按 chat 的缓存（TTL 1h）
- [x] 2.2 先写失败测试断言缓存命中时不再请求成员表、且回调响应不等待查询；再实现"解析只发生在延后路径 + 会话创建时预取"

## 3. Docs & gates

- [x] 3.1 更新 `docs/{zh,en}/usage.md`：生命周期消息的操作人显示名（解析失败回落 open_id）
- [ ] 3.2 跑门禁：`npm run lint`、`npm run typecheck`、`npm test`、`npm run test:e2e`；真实环境点一次按钮确认显示姓名
