## Why

真实 API e2e（`tests/integration-real.test.ts`）现需手动设 6 个环境变量才能跑，门槛高、易忘、易 typo（TAS-11 已踩过 known-issues.md 里 api_key 差一字符致 401）。用户要求：把 known-issues.md 提供的凭据作为**默认值**烤进代码（env 仍可覆盖），并"集成到 npm test"——使 `INTEGRATION=1 npm test` 零环境变量即可跑真实链路。grill 已确认（用户"都按推荐的来"）：保留 `INTEGRATION=1` 门控、CI 不跑的立场不变（ADR-0010），仅补默认值与单一真源。

## What Changes

- **新增凭据默认值模块**：新建 `tests/helpers/e2e-creds.ts`，导出 6 个 e2e 凭据（`FEISHU_E2E_APP_ID`/`FEISHU_E2E_APP_SECRET`/`FEISHU_E2E_INTAKE_CHAT_ID`/`JIRA_E2E_ENDPOINT`/`JIRA_E2E_API_KEY`/`JIRA_E2E_PROJECT_KEY`），每个取 `process.env.X ?? DEFAULT`，默认值取 known-issues.md 提供的内部测试环境值。`tests/integration-real.test.ts` 改为引用该模块。
- **门控行为微调**：`enabled` 由 `INTEGRATION===1 && 六个 env 全设` 改为 `INTEGRATION===1`（凭据恒有默认值，env 缺失不再触发跳过；env 仍可覆盖默认值用于指向不同环境）。
- **单一真源 / 防漂移**：`tests/helpers/e2e-creds.ts` 为凭据字面量的唯一真源；`docs/known-issues.md` 删去重复字面量，改为指向该模块，避免 TAS-11 式 typo 漂移。
- **ADR-0010 增补**：在 `docs/adr/0010-real-api-e2e-is-the-goal.md` 增补一句记录 TAS-12 立场——凭据默认值烤入测试源码、`INTEGRATION=1` 门控不变、CI 不跑。
- **CONTEXT.md 术语**：新增"E2E 凭据"术语（区分专用测试集 vs 生产复用集）并更新"真实 API 集成测试"术语以反映默认值 + INTEGRATION 门控（grill 阶段起草）。
- **文档同步**：`docs/development.md` 凭据行更正为实际的 `FEISHU_E2E_*`/`JIRA_E2E_*` 变量名与 `INTEGRATION=1 npm test` 运行方式（现行 `JIRA_API_TOKEN`/`FEISHU_APP_ID` 为陈旧错误）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `bridge-e2e-flow`: 真实 API 集成测试的凭据注入与门控要求变更——凭据 SHALL 有代码内默认值（env 仍可覆盖），"缺凭据即跳过"场景收窄为"`INTEGRATION != 1` 即跳过"（env 缺失不再触发跳过，因默认值补全）。

## Impact

- 新增 `tests/helpers/e2e-creds.ts`（纯测试辅助，无生产代码改动、无新依赖、无配置变更）。
- 改写 `tests/integration-real.test.ts` 顶部凭据读取与 `enabled` 判定。
- 改 `docs/known-issues.md`（删重复字面量、指向 e2e-creds.ts）、`docs/development.md`（凭据行更正）、`docs/adr/0010-...md`（增补一句）、`CONTEXT.md`（E2E 凭据术语 + 真实 API 集成测试术语更新）。
- 安全姿态：Jira e2e api_key 与生产 tracker PAT 同值，该 PAT 已提交在 WORKFLOW.md + known-issues.md（内部测试环境，ADR-0010 已背书凭据入仓），烤入测试源码不构成新泄露；`INTEGRATION=1` 门控保证 CI 不打真实服务。
