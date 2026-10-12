# 真实 API 端到端测试是目标（覆盖 TAS-10 的"不接入真实 API"Non-Goal）

TAS-10（feishu-mock-e2e-tests）归档 design.md 的 Non-Goal 写"不接入真实飞书群/真实 Jira TEST 项目做自动化（真实凭据仅保留在 issue 描述供手动验证，不写入仓库）"，但同一份 design 的评审反馈 Decision D5 已新增 `tests/integration-real.test.ts` 直接打真实飞书 bot/群 + 真实 Jira TEST 项目。TAS-11 明确：用户提供的凭据就是为真实 API 端到端测试而准备——虽不做录制式契约测试（方案 3），但基于已掌握的 API 与文档查到的 API 跑真实链路是必要的。决定：真实 API 集成测试（`INTEGRATION=1` 门控、CI 不跑）是受支持的目标，TAS-10 Non-Goal 中"不接入真实 API"一节作废；凭据可记录于 `docs/known-issues.md`（内部测试环境），由环境变量 `FEISHU_E2E_*`/`JIRA_E2E_*` 注入、缺失即干净跳过。

理由：mock 永远基于对 API 的理解构造，理解错则 mock 错、测试全绿但生产挂（TAS-10 已被 17 个手动 bug 证明）；只有直接打真实服务才能拦截 REST sender 形状 `{id, id_type, sender_type}` 这类 mock 掩盖的偏差（D5.2 已修）。归档 design 是不可变历史记录，不在原文件上改；本 ADR 为其更正依据。

## TAS-12 更新：凭据默认值烤入测试源码

TAS-12（端到端真实测试优化）把 6 个 e2e 凭据（`FEISHU_E2E_*`/`JIRA_E2E_*`）的默认值烤入 `tests/helpers/e2e-creds.ts`（`process.env.X ?? DEFAULT`，env 仍可覆盖），该模块为凭据字面量的唯一真源；`docs/known-issues.md` 不再重复字面量、改为指向该模块（防 TAS-11 式 typo 漂移）。立场不变：`INTEGRATION=1` 门控保留、`INTEGRATION != 1` 即干净跳过、CI 不跑真实链路（CI 在 `ubuntu-latest` 无内网 Jira 路由）。`INTEGRATION=1 npm test` 零环境变量即跑真实链路。Jira e2e api_key 默认值即生产 tracker PAT（同值，已在 WORKFLOW.md + known-issues.md 入仓，内部测试环境，不构成新泄露）。
