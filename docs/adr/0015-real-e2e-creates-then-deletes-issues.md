# 真实 E2E 测试：先真实建单、再主动删单（覆盖 TAS-25 的"飞书见 TEST-22、Jira 不见"疑问）

TAS-25 报告：跑真实集成测试（`tests/integration-real.test.ts`）时，飞书上能看到"✅ 已创建 TEST-22"之类的确认消息，但随后在 Jira 里找不到对应的 TEST-22 issue，问是否为"agent 内部逻辑、无需真实建单"。

结论：**不是**。TEST-22 是**真实创建**在 Jira TEST 项目里的，飞书上的"✅ 已创建 TEST-22"确认（`src/bridge/comment-bridge.ts:458`）只在真实 `JiraTracker.createIssue`（`comment-bridge.ts:453`）成功之后才发送；issue 由调度链路实际接管（binding、状态流转、评论转发全部打到真实 Jira）。之所以事后在 Jira 里看不到，是因为测试在 `finally` 块里**主动清理**了它：`tests/integration-real.test.ts:221` 与 `:286` 调用 `deleteJiraIssue(createdKey)`，对真实 Jira 发起 `DELETE /issue/<key>`。这是**有意设计**，避免把一次性 e2e 探针 issue 污染真实 TEST 项目（Jira Server 的 REST DELETE 为永久删除，故搜索亦不可见）。

决定：真实 API E2E（`INTEGRATION=1` 门控、CI 不跑）保持"建单 → 跑链路 → 删单"的自清理语义（延续 ADR 0010/0014 立场）；测试内部全程通过 binding/tracker 断言真实 issue 存在与状态，外部不留残留。

理由：飞书确认消息在先、Jira 不可见在后，是"先建后删"顺序造成的观感问题，而非 mock/内模拟。将"自清理"意图固化为文档，避免后人误判为 bug 或误以为未真实建单。
