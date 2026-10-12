## Context

`docs/known-issues.md` 待做项记录：飞书↔Jira comment bridge 上线后单测全绿但手动测试持续暴露 bug（约 17 个），根因是 mock HTTP 响应结构基于对飞书/Jira API 的假设，假设错则测试验证"与错误假设一致"。典型假阳性：`thread_id` 未捕获、`create_time` 毫秒→秒、`normalizeAssignee` 跳过 `name`、`onDispatch` 无话题、`container_id_type=thread`。

改进方案分三层：1）修 mock 响应结构（低成本立即收益）；2）端到端流程测试（中成本）；3）录制真实 API 响应做契约测试（高成本，本次不做）。任务要求采用方案 1、2。

## Goals / Non-Goals

**Goals:**
- mock 响应结构与真实飞书/Jira API 一致，消除假阳性。
- 用修正后的 mock 覆盖完整端到端流程（两个入口：飞书 `/issue` 与 Jira 派发），验证 cursor 推进、sentinel 去重、binding 生命周期。
- 全部为测试层改动，生产代码零改动、零新依赖。

**Non-Goals:**
- 不做方案 3：录制真实 API 响应做契约测试 / `INTEGRATION=1` 真实 API 冒烟（issue 明确"3 先暂时不做"）。
- 不接入真实飞书群/真实 Jira TEST 项目做自动化（真实凭据仅保留在 issue 描述供手动验证，不写入仓库）。

## Decisions

- **D1 真实感飞书 mock 独立成 helper**：新增 `tests/helpers/feishu-mock.ts`，按真实飞书 API 形状构造响应（token、postMessage、replyInThread 含 thread_id、listMessages chat、listThreadReplies thread、消息 sender 字段）。理由：现有 `feishu-source.test.ts` 与 `comment-bridge.test.ts` 各自内联 mock，形状不完整、无容器类型区分；集中一处便于复用与维护。
- **D2 E2E 流程测试用 mock 而非真实凭据**：用修正后的 mock 驱动完整链路，验证最终 binding terminal。理由：真实凭据不能进 CI、不确定性高；issue 描述强调"端到端测试最好可以模拟整个流程""重点在固定的流程上"。
- **D2.1 E2E 接线真实 Scheduler（评审反馈）**：E2E 不再只直调 `CommentBridge` 方法，而是与生产 `src/cli/index.ts` 同构地接线真实 `Scheduler` + `CommentBridge`（scheduler 事件驱动 `onDispatch`/`onTerminate`），worker stub 即 agent——经真实 `JiraTracker` 发 comment、转状态，`agentRuns` 断言 agent 真实参与。理由：评审关注"agent 是否参与、流程是否逼真"，直调 bridge 无法回答。
- **D5 真实 API 集成测试（评审反馈）**：用户搭建了真实飞书测试群/bot 与 Jira TEST 项目，反馈"为什么不用 api 模拟"。新增 `tests/integration-real.test.ts`（`INTEGRATION=1` + `FEISHU_E2E_*`/`JIRA_E2E_*` 门控，缺失干净跳过，CI 不跑），直接打真实服务跑 Jira 入口全流程。落地即发现 mock 掩盖的真实 bug：飞书 REST 拉取的 sender 是 `{id, id_type, sender_type}`（无 webhook 形状的 `sender_id.open_id`/`sender_name`），`parsePolledMessage` 已补 REST 形状解析（webhook 形状兼容保留），mock 增 `restSender` 选项输出真实形状。
- **D3 复用现有 `createMockJiraServer`**：Jira 侧沿用 `tests/helpers/mock-http-server.ts`，仅补 `name` 字段等真实形状（assignee 含 `name`，Server/DC 场景）。
- **D4 断言落在用户可见行为**：cursor（`last_jira_comment_id`/`last_feishu_msg_id`）、sentinel 去重、binding 状态迁移，而非内部调用细节。

## Risks / Trade-offs

- [mock 仍非真实 API，存在残余偏差] → 按 issue 约定本次不做方案 3 录制；E2E 覆盖已识别的 5 类假阳性，残余风险记录回 `docs/known-issues.md`。
- [E2E 流程测试时序脆弱] → 用显式 `await` 驱动各步骤（非定时器），断言幂等性（跨 tick 不重复）。
