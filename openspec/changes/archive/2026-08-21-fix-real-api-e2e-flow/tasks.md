# Tasks

## 1. 文档与 ADR

- [x] 1.1 确认 `docs/adr/0010-real-api-e2e-is-the-goal.md`（grill 已起草）与 `CONTEXT.md` "真实 API 集成测试"术语就位；在 `docs/known-issues.md` 真实 API 测试说明处补一句飞书→Jira 用户回复方向由 mock E2E 覆盖的限制记录。
- [x] 1.2 校对 `openspec/changes/fix-real-api-e2e-flow/` proposal/design/specs/tasks 一致。

## 2. 扩展真实 API e2e 全流程（TDD：red → green）

- [x] 2.1 扩展 `tests/integration-real.test.ts` Jira 入口全流程：真实 `createIssue` → 直调 `onDispatch` 建真实飞书话题 + binding（断言真实话题消息含"已开始"、`thread_id` 非空）→ agent stub 真实 `postComment` + `transitionIssue`（状态流转到处理中）→ `forwardComments` 桥到真实飞书话题（断言真实话题出现 agent comment）→ `onTerminate` 完结（断言 binding terminal + 真实话题"已完结"）。`INTEGRATION=1` + 正确 key 跑绿；缺凭据跳过不失败。
- [x] 2.2 飞书 `/issue` 入口全流程（red → green）：bot 向 intake 群发真实消息取 `message_id` → 直调 `bridge.executeIssue(...)` 走真实 `createIssue` + 真实 `replyInThread` 建话题与 binding → agent stub 真实 `postComment` → `forwardComments` 桥到真实飞书话题 → `onTerminate` 完结。断言两入口各建的 binding `issue_key`/`thread_id` 真实有效。
- [x] 2.3 自清理（red → green）：`finally` 中 `DELETE` 两入口创建的真实 Jira TEST issue，验证无残留；飞书消息残留于专用测试群可接受。

## 3. 验证

- [x] 3.1 `npm run lint && npm run typecheck && npm test`（`INTEGRATION` 未设）全绿。
- [x] 3.2 `INTEGRATION=1` + 真实凭据（`JIRA_E2E_API_KEY` = WORKFLOW.md `tracker.api_key`）跑 `tests/integration-real.test.ts` 通过。
