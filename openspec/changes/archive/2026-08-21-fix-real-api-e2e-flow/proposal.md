## Why

TAS-10 归档的 `feishu-mock-e2e-tests` design 的 Non-Goal 写"不接入真实飞书群/真实 Jira TEST 项目做自动化"，但用户在 TAS-11 明确：提供的凭据就是为真实 API 端到端测试而准备（虽不做录制式契约测试，但基于已掌握的 API 跑真实链路是必要的）。现 `tests/integration-real.test.ts` 已存在但**实跑失败**——`docs/known-issues.md` 记录的 Jira api_key 是一个 typo（差一字符，已失效 401），且该测试只覆盖 Jira 入口、agent stub 不做真实操作，未达用户要求的"两个入口 + 双向桥接 + 状态流转 + 直到完结"全流程。

## What Changes

- **修正失效凭据**：`docs/known-issues.md` 的 Jira api_key 更正为 WORKFLOW.md 的 tracker api_key 值（用户确认二者应相同，known-issues 为 typo），使其能访问 TEST 项目。
- **补全真实 API e2e 全流程**：重写 `tests/integration-real.test.ts`，镜像 `tests/bridge-flow.test.ts`（真实 `Scheduler` + `CommentBridge` + agent stub）但指向真实飞书 bot/群 + 真实 Jira TEST 项目，覆盖 Jira 入口全流程（建 issue → 派发建真实话题 → agent stub 做真实 Jira 操作 `postComment`/`transitionIssue` → Jira→飞书桥接 → 完结 binding terminal）。
- **agent stub 做真实行为**：runAttemptFn 不再只返回 succeeded，而是经真实 `JiraTracker` 发真实 comment + 转真实状态，逼近 agent 真实场景（用户明确要求）。
- **更正归档 design 矛盾**：归档 design 不可改，已用 `docs/adr/0010-real-api-e2e-is-the-goal.md` 记录"真实 API e2e 是目标、TAS-10 该 Non-Goal 作废"；本 change 的 design 进一步落实。
- **纳入整体测试**：`INTEGRATION=1` 门控（缺失干净跳过、CI 不跑），功能开发后手动 `INTEGRATION=1 npm test` 跑真实链路。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `bridge-e2e-flow`: 新增要求——真实 API 集成测试 SHALL 镜像 mock E2E 的全流程（真实 Scheduler + agent stub 做真实 Jira 操作），指向真实飞书 bot/群 + 真实 Jira TEST 项目，`INTEGRATION=1` 门控、缺失即跳过、CI 不跑。

## Impact

- 重写 `tests/integration-real.test.ts`（真实 Scheduler 接线 + agent stub 真实 Jira 操作 + Jira 入口全流程）。
- 修正 `docs/known-issues.md`（失效 Jira api_key typo + 真实 API 测试说明对齐实际）。
- 新增 `docs/adr/0010-real-api-e2e-is-the-goal.md`、更新 `CONTEXT.md`（术语"真实 API 集成测试"，已在 grill 阶段起草）。
- 无生产代码改动（纯测试层 + 文档）、无新依赖、无配置变更。飞书 `/issue` 入口与飞书→Jira 用户回复方向因 bot 无法冒充非 app 发送者（bridge 跳过 `sender_type=app`），以直接调 `executeIssue`/`bridgeMessages` 模拟用户侧、真实 Jira 侧桥接的方式覆盖（详见 design）。
