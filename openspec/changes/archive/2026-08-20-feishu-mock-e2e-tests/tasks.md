# Tasks

## 1. 真实感飞书 mock helper（TDD）

- [x] 1.1 新增 `tests/helpers/feishu-mock.ts`：按真实飞书 API 形状构造响应——token 端点、`postMessage`（chat）、`replyInThread`（响应含 `thread_id` 且消息进入 thread 容器）、`listMessages`（`container_id_type=chat`）、`listThreadReplies`（`container_id_type=thread`）、消息对象含 `sender_id.open_id`/`sender_name`/`sender_type`、`create_time` 用 13 位毫秒。
- [x] 1.2 写失败测试：`feishu-source.test.ts` 断言 `listThreadReplies` mock 用 `container_id_type=thread`、`listMessages` 用 `container_id_type=chat`，运行确认红。
- [x] 1.3 修正 `feishu-source.test.ts` mock 为真实形状（13 位毫秒 `create_time`、`thread_id` 返回），运行确认绿。

## 2. Jira mock 补真实字段

- [x] 2.1 写失败测试：`jira-tracker.test.ts` 补 Server/DC assignee 场景——mock assignee 含 `name`（无 accountId），`normalizeAssignee` 返回 `name`，运行确认红。
- [x] 2.2 修正 `jira-tracker.test.ts` mock 形状并补 `normalizeAssignee` 对 `name` 的断言，运行确认绿。

## 3. 端到端全流程测试（TDD）

- [x] 3.1 写失败测试：飞书入口全流程——intake `/issue` 建 issue → 回执 → 话题建立（thread_id）→ 人回复桥成 Jira comment（sentinel）→ `/state` 转状态 → 完结 binding terminal，运行确认红。
- [x] 3.2 用 `tests/helpers/feishu-mock.ts` 驱动 `CommentBridge` 实现 3.1 流程，运行确认绿。
- [x] 3.3 写失败测试：Jira 入口全流程——tracker 派发 → `onDispatch` 建话题与 binding → agent Jira comment 桥到飞书话题 → 完结 `onTerminate` 回执 → binding terminal，运行确认红。
- [x] 3.4 用 mock 驱动实现 3.3 流程，运行确认绿。
- [x] 3.5 补断言：cursor 单调推进（`last_jira_comment_id`/`last_feishu_msg_id`）、sentinel comment 不被回投、跨 tick 幂等（不重复桥接）。
- [x] 3.6 评审反馈强化：E2E 改为接线真实 `Scheduler` + `CommentBridge`（与生产 `src/cli/index.ts` 同构），worker stub 即 agent——经真实 `JiraTracker` 发 comment、转状态，断言 `agentRuns` 记录 agent 参与、`onDispatch`/`onTerminate` 由 scheduler 事件驱动，验证 agent 真实参与固定流程。

## 4. 文档

- [x] 4.1 更新 `docs/known-issues.md`：待做项勾除（方案 1、2 已实现，方案 3 记录为未做）。
- [x] 4.2 方案 3 未做（无 INTEGRATION 开关），`docs/usage.md` 无新增需同步内容，无变更。

## 5. 真实 API 集成测试（评审反馈）

- [x] 5.1 新增 `tests/integration-real.test.ts`：`INTEGRATION=1` + `FEISHU_E2E_*`/`JIRA_E2E_*` 环境变量门控（缺失干净跳过），跑真实飞书 bot/群 + 真实 Jira TEST 项目 Jira 入口全流程。
- [x] 5.2 修复 mock 掩盖的真实 bug：飞书 REST 拉取 sender 形状为 `{id, id_type, sender_type}`（无 `sender_id.open_id`/`sender_name`），`parsePolledMessage` 补 REST 形状解析（webhook 形状兼容保留）。
- [x] 5.3 `tests/helpers/feishu-mock.ts` 支持 `restSender` 选项输出真实 REST sender 形状。
- [x] 5.4 `docs/known-issues.md` 补充真实 API 集成测试说明与运行方式。

## 6. 验证

- [x] 6.1 `npm run lint && npm run typecheck && npm test` 全绿。
- [x] 6.2 `INTEGRATION=1` + 真实凭据跑 `tests/integration-real.test.ts` 通过。
