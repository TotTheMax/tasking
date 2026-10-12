## 1. BindingStore 持久 seen-id 方法

- [x] 1.1 实现 `intake_seen_ids` 读写（先写失败测试：`tests/binding-store.test.ts` 断言 `markIntakeSeen` 追加消息 id 且 `isIntakeSeen` 对已标记 id 返回 true、未标记返回 false，跑红后实现 `src/bridge/binding-store.ts` 中基于 `bridge_meta` 键 `intake_seen_ids` 的 JSON 数组读写，转绿）
- [x] 1.2 实现有界上限（先写失败测试：连续标记 51 个不同 id 后最旧的第 1 个 `isIntakeSeen` 返回 false、最近 50 个返回 true，跑红后实现数组截断到 50，转绿）

## 2. CommentBridge 入口检查与出口标记

- [x] 2.1 重启重投拦截（先写失败测试：`tests/comment-bridge.test.ts` 用真实临时 `BindingStore` + mock 飞书端口构造 bridge A，`ingestMessage` 一条 `/help` 根消息断言回复一次；同一 store 构造全新 bridge B（模拟重启，内存 claim 清空）重投同一消息，断言无第二次回复、仅 debug 日志，跑红后在 `ingestMessage` 对 `root_id === null` 的消息叠加入口持久检查，转绿）
- [x] 2.2 处理完成后才标记（先写失败测试：①用可放行的延迟回复 mock——回复挂起期间断言 `isIntakeSeen` 为 false（未见）、放行并 await 完成后为 true，验证标记位于队列处理完成之后；②回复发送持续失败（500）路径断言处理结束后 `isIntakeSeen` 为 true——对齐 Sweep"游标无论结果都推进"语义。跑红后实现出口标记，转绿）
- [x] 2.3 话题回复不写入（先写失败测试：构造带 active binding 的话题消息（`root_id !== null`）经 `ingestMessage` 桥接成功，断言持久 seen-id 无该消息记录，跑红后在出口标记处限定仅根消息写入，转绿）

## 3. 文档

- [x] 3.1 撰写 `docs/adr/0030-intake-seen-id-mark-after-processing.md`：决策（仅根消息、处理完成后标记、bridge_meta 有界 50）、与 direct-sessions 先标记时机的偏离及理由（话题重试挂起窗口 + intake 无失败可见兜底）、被否方案（全量先标记/仅命令分类/事件通道推游标）、与 `--fresh` 正交
- [x] 3.2 更新 `CONTEXT.md`：修正 Ingest queue 词条（claim 对 intake 根消息另有持久半边），在 Intake cursor 旁新增 Intake seen-id 词条（含 _Avoid_: processed set）

## 4. 验证门禁

- [x] 4.1 跑 `npm run lint`、`npm run typecheck`、`npm test -- tests/binding-store.test.ts`、`npm test -- tests/comment-bridge.test.ts` 全绿
- [x] 4.2 跑 `npm run test:e2e`（bridge 改动硬门禁：scheduler 流程 + Feishu↔Jira 桥流程）确认无回归；若内网可达跑 `npm run test:integration`，不可达则在收尾说明原因
