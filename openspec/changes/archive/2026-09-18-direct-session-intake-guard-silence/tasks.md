## 1. Silent guard

- [x] 1.1 先写失败测试断言：重投同一 `/chat` 根消息（活跃会话）→ 不产生任何回执、会话与 session_id 不变；done 会话重投同样静默；再实现（删两处文案 + 记 debug）
- [x] 1.2 跑门禁：`npm run lint`、`npm run typecheck`、`npm test`、`npm run test:e2e`；重启 daemon 后确认不再出现随机"已存在/已结束"回执
