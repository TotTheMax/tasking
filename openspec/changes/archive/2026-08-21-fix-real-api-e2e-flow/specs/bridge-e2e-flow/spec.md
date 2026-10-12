## ADDED Requirements

### Requirement: 真实 API 集成测试覆盖 Jira 入口全流程
真实 API 集成测试 SHALL 镜像 mock E2E 的全流程但指向真实飞书 bot/群 + 真实 Jira TEST 项目，由 `INTEGRATION=1` + `FEISHU_E2E_*`/`JIRA_E2E_*` 环境变量门控（任一缺失即干净跳过、CI 不跑）。测试 SHALL 经真实 `CommentBridge`（直调 `onDispatch`/`onTerminate`，与 Scheduler 事件驱动同一代码路径，直调以隔离共享 TEST 项目），agent stub SHALL 经真实 `JiraTracker` 发真实 comment（`postComment`）与转真实状态（`transitionIssue`），逼近 agent 真实场景而非空跑。测试 SHALL 覆盖 Jira 入口全流程：真实 Jira TEST 项目建 issue → `onDispatch` 建真实飞书话题与 binding → agent stub 真实 Jira comment 经 `forwardComments` 桥到真实飞书话题 → 完结 `onTerminate` 回执 → binding terminal。

#### Scenario: INTEGRATION=1 且凭据齐全时跑真实链路
- **WHEN** `INTEGRATION=1` 且 `FEISHU_E2E_APP_ID`/`FEISHU_E2E_APP_SECRET`/`FEISHU_E2E_INTAKE_CHAT_ID`/`JIRA_E2E_ENDPOINT`/`JIRA_E2E_API_KEY`/`JIRA_E2E_PROJECT_KEY` 齐全
- **THEN** 测试对真实飞书 bot/群与真实 Jira TEST 项目跑 Jira 入口全流程，断言真实话题建立、agent 真实 comment 出现在真实飞书话题、binding terminal

#### Scenario: 缺凭据时干净跳过
- **WHEN** `INTEGRATION != 1` 或任一 `FEISHU_E2E_*`/`JIRA_E2E_*` 缺失
- **THEN** 测试干净跳过（不失败），CI 不跑真实链路

#### Scenario: agent stub 做真实 Jira 操作
- **WHEN** `onDispatch` 建立话题与 binding 后 agent stub 执行
- **THEN** stub 经真实 `JiraTracker` 调 `postComment`（真实 Jira comment）与 `transitionIssue`（真实状态流转），随后 `forwardComments` 将该真实 comment 桥到真实飞书话题

#### Scenario: 凭据为 WORKFLOW.md tracker api_key 值
- **WHEN** `JIRA_E2E_API_KEY` 取 WORKFLOW.md 的 `tracker.api_key` 值（可访问 TEST 项目的同一用户）
- **THEN** 真实 Jira TEST 项目的 `createIssue`/`postComment`/`transitionIssue` 成功（非 400/401）

#### Scenario: 测试清理真实 Jira issue
- **WHEN** 真实集成测试结束（无论成功失败）
- **THEN** 创建的真实 Jira TEST issue 被删除，不残留测试数据
