## Context

TAS-10 归档的 `feishu-mock-e2e-tests` 在评审反馈 Decision D5 已新增 `tests/integration-real.test.ts` 打真实飞书 bot/群 + 真实 Jira TEST 项目，但：1）归档 design Non-Goal 仍写"不接入真实 API"，与 D5 自相矛盾；2）现有 `integration-real.test.ts` 只直调 `onDispatch`/`forwardComments`/`onTerminate` 跑 Jira 入口片段，agent stub 不做真实操作，未达用户要求的"两个入口 + agent 真实行为 + 状态流转 + 直到完结"全流程。

凭据已验证可用（known-issues.md 的 Jira api_key 与 WORKFLOW.md `tracker.api_key` 同值，用户 506757138730，可访问 TEST 项目；`createIssue`/`postComment`/`transitionIssue` 均成功）。TEST 项目存在（id 10300，issuetype "任务" id 10002）；飞书凭据有效（`tenant_access_token` 获取成功）。用正确凭据重跑现有 `integration-real.test.ts` 已通过（3.4s）。

关键约束：`CommentBridge` 在 `discoverIntake` 与 `bridgeMessages` 中跳过所有 `sender_type === "app"` 的消息（comment-bridge.ts:229,313），且 `/issue`、`/state` 命令需非 app 发送者——bot 经 `postMessage`/`replyInThread` 发出的消息 sender 恒为 app，故**飞书用户侧动作（话题内人回复、`/state` 命令）无法由 bot 自动冒充**，该方向由现有 mock E2E（`bridge-flow.test.ts`）覆盖。

## Goals / Non-Goals

**Goals:**
- 扩展 `tests/integration-real.test.ts` 为全流程：覆盖两个入口（Jira 派发 + 飞书 `/issue` 经 `executeIssue`）、agent stub 做真实 Jira 操作（`postComment` + `transitionIssue`）、Jira→飞书真实桥接（`forwardComments`）、状态流转、完结 `onTerminate`、自清理。
- `INTEGRATION=1` + `FEISHU_E2E_*`/`JIRA_E2E_*` 门控（缺失即跳过、CI 不跑），功能开发后手动 `INTEGRATION=1 npm test` 跑真实链路。
- 更正归档 design 矛盾（`docs/adr/0010` 已起草，CONTEXT.md 补术语）。

**Non-Goals:**
- 不做录制式契约测试（方案 3，用户明确"不是录制"）。
- 不改生产代码（纯测试层 + 文档）。
- 不全自动飞书→Jira 用户回复方向与 `/state` 命令：bot 无法冒充非 app 发送者，由 mock E2E 覆盖，known-issues 记录。
- 不接线真实 `Scheduler` 轮询：在共享 TEST 项目中轮询会派发他人 issue，改为直调 `onDispatch`/`onTerminate`（与 Scheduler 事件驱动同一代码路径）以隔离，详见 D2。
- 不在 CI 跑（`INTEGRATION=1` 门控）。

## Decisions

- **D1 复用 WORKFLOW.md tracker api_key 作 `JIRA_E2E_API_KEY`**：known-issues.md 的 key 与 WORKFLOW.md 同值（已确认 committed 无 typo），该用户可访问 TEST 项目。无需专用 E2E PAT。
- **D2 直调 `onDispatch`/`onTerminate` 而非真实 Scheduler 轮询**：真实 `Scheduler.tick()` 会 JQL 轮询 TEST 项目所有 `待办` issue 并派发，在共享测试项目会干扰他人 issue、引入竞态。改为直调 `bridge.onDispatch`/`onTerminate`——与 Scheduler 事件驱动的同一方法，覆盖相同 bridge 代码路径，仅触发方式不同（测试隔离）。理由：bridge 行为（建话题、forwardComments、完结）不因触发方式而异，直调可隔离、确定性更高。
- **D3 agent stub 做真实 Jira 操作**：测试中"agent"角色直接经真实 `tracker` 调 `postComment(issueKey, …)` + `transitionIssue(issueKey, …)`，随后 `forwardComments` 将真实 comment 桥到真实飞书话题。理由：用户明确"mock 中应有真实行为（添加 comments/修改 issue 状态）"。
- **D4 飞书 `/issue` 入口用真实 app 消息作话题根**：bot 先向 intake 群发一条真实消息取其 `message_id`，作为 `executeIssue` 的 `msgId`（话题根）。`executeIssue` 走真实 `createIssue` + 真实 `replyInThread` 建话题与 binding——与生产 `/issue` 同代码路径，仅"命令来源"是 app 消息而非用户消息（bot 无法冒充用户）。理由：覆盖飞书入口 issue 创建的真实 API 调用。
- **D5 测试清理真实 Jira issue**：`finally` 中 `DELETE /issue/<key>` 删除创建的 TEST issue；飞书消息无法删（API 限制），残留于专用测试群可接受。

## Risks / Trade-offs

- [真实服务时序脆弱/慢] → `waitFor` 轮询 500ms、超时 20s；断言幂等，失败带上下文。
- [飞书消息无法清理] → 残留于专用测试群（`FEISHU_E2E_INTAKE_CHAT_ID`），可接受；Jira issue 必删。
- [飞书→Jira 方向非全自动真实] → 由 mock E2E（`bridge-flow.test.ts`，已绿）覆盖双向；known-issues 记录此限制。
- [凭据在仓库] → 内部测试环境、用户明确要求；`INTEGRATION=1` 门控保证 CI 不跑。ADR-0010 记录此立场。
