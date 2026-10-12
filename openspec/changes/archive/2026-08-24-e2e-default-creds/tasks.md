# Tasks

## 1. E2E 凭据默认值模块（TDD：red → green）

- [x] 1.1 写失败测试 `tests/helpers/e2e-creds.test.ts`：`resolveE2ECreds({})` 返回 6 个非空默认值（= `E2E_DEFAULTS`）；`resolveE2ECreds({ FEISHU_E2E_APP_ID: "override" })` 该字段被覆盖、其余仍为默认。跑 `npm test -- tests/helpers/e2e-creds.test.ts` 红（模块不存在）。
- [x] 1.2 实现 `tests/helpers/e2e-creds.ts`：导出 `E2E_DEFAULTS`（6 个 known-issues.md 字面量）与 `resolveE2ECreds(env)`（`env.X ?? E2E_DEFAULTS.X`）；跑 1.1 测试转绿。

## 2. integration-real 接线

- [x] 2.1 改 `tests/integration-real.test.ts`：移除 6 个 `process.env.FEISHU_E2E_*`/`process.env.JIRA_E2E_*` 直读，改 `import { resolveE2ECreds } from "./helpers/e2e-creds.js"` + `const CREDS = resolveE2ECreds(process.env)`；`enabled` 由 `INTEGRATION===1 && 六个全设` 收窄为 `process.env.INTEGRATION === "1"`；`makeConfig` 与各 `getXxxOrFail` 改用 `CREDS.*`。跑 `npm test`（`INTEGRATION` 未设）确认该文件干净跳过不失败。

## 3. 文档同步

- [x] 3.1 `docs/known-issues.md`：删去 6 个凭据字面量（AppID/App Secret/Chat ID/endpoint/api_key/project_key），改为"凭据默认值见 `tests/helpers/e2e-creds.ts`"。
- [x] 3.2 `docs/development.md`：凭据行更正为 `FEISHU_E2E_*`/`JIRA_E2E_*` 变量名 + `INTEGRATION=1 npm test` 运行方式（默认值已内置，无需另设环境变量）。
- [x] 3.3 `docs/adr/0010-real-api-e2e-is-the-goal.md`：增补一句 TAS-12 立场——凭据默认值烤入 `tests/helpers/e2e-creds.ts`、`INTEGRATION=1` 门控不变、CI 不跑；known-issues.md 不再重复字面量改为指向该模块。
- [x] 3.4 `CONTEXT.md`："E2E 凭据"术语（grill 阶段起草）确认就位、无重复。

## 4. 验证

- [x] 4.1 `npm run lint && npm run typecheck && npm test`（`INTEGRATION` 未设）全绿，`integration-real.test.ts` 干净跳过。
- [x] 4.2 （手动/可选）`INTEGRATION=1 npm test` 零环境变量跑 `tests/integration-real.test.ts` 通过（真实链路、有副作用、CI 不跑）。
