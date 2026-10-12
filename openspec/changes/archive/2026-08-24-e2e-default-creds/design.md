## Context

`tests/integration-real.test.ts`（TAS-10/TAS-11 落地）现读 6 个环境变量，`enabled = process.env.INTEGRATION === "1" && 六个全设`，缺一即干净跳过。该文件已被 `npm test` 的 vitest glob（`tests/**/*.test.ts`）收录，只是自跳过。ADR-0010 + `openspec/specs/bridge-e2e-flow/spec.md` 明确立场：`INTEGRATION=1` 门控、CI 不跑、缺失即跳过、凭据记在 `docs/known-issues.md`。

用户在 TAS-12 要求：把 known-issues.md 提供的凭据作为默认值烤进代码、并"集成到 npm test"。grill 阶段（Jira comment 11719）就 4 个决策征询，用户答复"都按推荐的来"：保留 `INTEGRATION=1` 门控（不覆盖 ADR-0010 的"CI 不跑"）、新建 `tests/helpers/e2e-creds.ts` 作代码内单一真源、known-issues.md 删重复字面量指向该模块、6 个凭据全烤（含与生产 tracker 同值的 Jira PAT，已入仓不构成新泄露）。

凭据事实：飞书 e2e 集（`FEISHU_E2E_APP_ID` / `FEISHU_E2E_APP_SECRET` / `FEISHU_E2E_INTAKE_CHAT_ID` 对应的专用测试 bot/群）是专用测试 bot/群，与 WORKFLOW.md 生产 bot 不同；Jira endpoint+api_key（`JIRA_E2E_ENDPOINT` / `JIRA_E2E_API_KEY`）与生产 tracker 同值，仅 project_key（`TEST` vs `TAS`）不同。（原文档曾内联真实字面量，已按 ADR-0029 去密钥化清除；值见个人 `.env`。）

## Goals / Non-Goals

**Goals:**
- `INTEGRATION=1 npm test` 零环境变量即可跑真实链路（凭据有默认值，env 仍可覆盖以指向不同环境）。
- 代码内凭据单一真源（`tests/helpers/e2e-creds.ts`），消除 known-issues.md 与代码双写漂移（TAS-11 typo 教训）。
- `INTEGRATION=1` 门控不变，裸 `npm test` 与 CI 仍跳过（不违背 ADR-0010 / spec 的"CI 不跑"）。
- 文档同步：known-issues.md、development.md（凭据行陈旧错误）、ADR-0010 增补。

**Non-Goals:**
- 不去掉 `INTEGRATION=1` 门控、不让裸 `npm test`/CI 跑真实链路（用户选 Q1-A，非 B）。
- 不新增 `npm run test:e2e` 脚本（非 Q1-C）。
- 不改生产代码、不加新依赖、不动配置 schema。
- 不改真实 e2e 的测试用例本身（两个入口全流程逻辑不变，仅凭据来源与 `enabled` 判定变更）。

## Decisions

- **D1 保留 `INTEGRATION=1` 门控（grill Q1-A）**：烤默认值但不去门控。裸 `npm test` 与 CI（`ubuntu-latest` 无内网 Jira 路由）仍跳过。理由：每 push/PR 打真实服务会引入网络不可达/抖动/真实副作用/配额；ADR-0010 与 spec 明确"CI 不跑"。用户确认。
- **D2 凭据默认值放 `tests/helpers/e2e-creds.ts`（grill Q2-A）**：导出 6 个 `process.env.X ?? DEFAULT`，`integration-real.test.ts` 引用之。理由：代码内单一真源、可复用、env 仍可覆盖；内联（Q2-B）难扩展。
- **D3 代码为唯一真源，known-issues.md 去重指向（grill Q3-A）**：known-issues.md 删去 6 个字面量、改为"凭据默认值见 `tests/helpers/e2e-creds.ts`"。理由：双写必漂移，TAS-11 已踩 typo 致 401。
- **D4 6 个凭据全烤含 Jira PAT（grill Q4-A）**：Jira e2e api_key 与生产 tracker 同值，该 PAT 已在 WORKFLOW.md + known-issues.md 提交（内部测试环境，ADR-0010 背书），烤入测试源码不构成新泄露。ADR-0010 增补一句记录此立场。
- **D5 `enabled` 收窄为 `INTEGRATION===1`**：凭据恒有默认值后，"env 缺失"不再触发跳过；`enabled` 由 `INTEGRATION===1 && 六个全设` 改为 `INTEGRATION===1`。spec 的"缺凭据即跳过"场景相应收窄为"`INTEGRATION != 1` 即跳过"。

## Risks / Trade-offs

- [凭据入仓范围扩大（known-issues.md → 测试源码）] → 该 PAT 已在仓内、内部测试环境、ADR-0010 已背书；不构成新泄露。ADR-0010 增补记录。
- [默认值与生产凭据耦合] → Jira 默认值即生产 tracker PAT，若生产 PAT 轮换需同步 `e2e-creds.ts`；可接受（轮换低频，且 env 可临时覆盖不阻塞）。
- [env 覆盖语义] → `process.env.X ?? DEFAULT`：env 设空串会生效为空串（覆盖默认）。可接受（用户显式设空即意为不用默认）。
- [门控收窄后误以为 CI 跑真实链路] → spec/ADR/development.md 明确"`INTEGRATION=1` 门控、CI 不跑"，防误读。
