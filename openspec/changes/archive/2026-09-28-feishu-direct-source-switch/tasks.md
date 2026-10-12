# Tasks: feishu-direct-source-switch

## 1. 配置层：kind: none 解析与校验矩阵

- [x] 1.1 `tracker.kind: none` 解析与残留字段 WARN（写失败测试先：resolveConfig 接受 `none`、残留 tracker 字段产生 WARN；然后实现 resolver.ts 的 kind 枚举扩展与 WARN）
- [x] 1.2 校验矩阵重构（写失败测试先：`kind: none` 跳过 Jira 必填、`create_issue_type` 仅 `jira` 必填、两条退化拒启、`opencode.command` 死检查删除；然后实现 validator.ts 按源分流）
- [x] 1.3 热重载 kind 变更 WARN（写失败测试先：reload 后 kind 与启动值不同时记 WARN；然后实现 reload 监听）

## 2. 桥：唯一谓词与能力降级

- [x] 2.1 `CommentBridgeDeps.tracker` 可空 + 唯一谓词（写失败测试先：tracker 为 null 构造桥不抛错；然后放宽类型并引入 `jiraAvailable` getter——全桥唯一 tracker 可空消费点）
- [x] 2.2 镜像循环短路（写失败测试先：tracker 缺席时 forwardTick 不发起任何 Jira 调用；然后实现 tick 首行短路）
- [x] 2.3 intake `/issue`/`/state` 兜底路由 + 兜底文案升级（写失败测试先：缺席时 `/issue` 得"未知命令。可用：…"而非建单/异常、`/state` 不再回"请在 issue 话题内发"；然后实现谓词路由与清单文案）
- [x] 2.4 `/help` 按能力裁剪（写失败测试先：缺席时帮助卡与文本不含 `/issue`/`/state`、含 `/chat`/`/agent`；在场时与现状一致；然后实现裁剪组装）
- [x] 2.5 桥卡片按钮防御短路（写失败测试先：缺席时 `state_open` 等动作返回提示 toast 且无 Jira 请求；然后实现 handler 首判）
- [x] 2.6 回归确认：`/agent`、`full`、Sweep 在缺席下不回归（写测试锚定：intake `/agent` 列表正常、Sweep 照常跑）

## 3. 装配：缺席即缺席

- [x] 3.1 `runStart` 按源分流（写失败测试先：`kind: none` 启动成功且不构造 JiraTracker/Scheduler、dashboard 空快照、直连可用；然后实现装配分流 + 独立 ActivityStore + no-op requestRefresh + 跳过 startupTerminalCleanup）
- [x] 3.2 组合级 e2e `tests/trackerless.test.ts`（tracker 强制 null ⇒ 全程零 Jira 可用：`/chat` 建会话出结果、`/issue`/`/state` 得兜底、`/agent` 正常、Sweep 无异常；已加入 `test:e2e`）

## 4. 收尾

- [x] 4.1 文档同步：`docs/{zh,en}/configuration.md` 的 `tracker.kind` 取值表加 `none`（双语）；提交工作区已备好的 `docs/adr/0026` 与 `CONTEXT.md` 词条
- [x] 4.2 门禁与真机验收：lint/typecheck/`npm test` 全绿；桥被动 → `npm run test:e2e` 必跑；环境可达时 `npm run test:integration`；`npm run test:event-flow` 作为验收冒烟（不可达则在提交说明中注明原因）
