# Tasks

## 1. e2e-creds 加载器与校验器（TDD：red → green）

- [x] 1.1 写失败测试 `tests/helpers/e2e-creds.test.ts` 增补：`loadE2ECredsEnvFile(不存在路径)` 返回 false 且不改 env；`loadE2ECredsEnvFile(临时 .env 文件路径)` 返回 true 且把键写入传入 env（或 process.env）；`missingE2ECreds(resolveE2ECreds({ FEISHU_E2E_APP_ID: "" }))` 返回缺失键。跑 `npm test -- tests/helpers/e2e-creds.test.ts` 红（函数不存在）。
- [x] 1.2 实现 `tests/helpers/e2e-creds.ts`：新增 `loadE2ECredsEnvFile(path = ".env"): boolean`（`existsSync` 守卫 + `process.loadEnvFile`）与 `missingE2ECreds(creds): string[]`（返回空值键）；保留 `E2E_DEFAULTS`/`resolveE2ECreds` 原样。跑 1.1 测试转绿。

## 2. integration-real 接线（.env 加载 + 快速失败）

- [x] 2.1 写失败测试：在 `tests/integration-real.test.ts`（或新单测）验证 `INTEGRATION=1` 且凭据为空时抛错。若集成测试不便单测，改为验证 `missingE2ECreds` 的触发路径（`enabled` 时非空列表抛 Error）。跑测试红。
- [x] 2.2 改 `tests/integration-real.test.ts`：`CREDS` 解析前调 `loadE2ECredsEnvFile()`；`enabled` 分支校验 `missingE2ECreds(CREDS)` 为空，否则抛 Error（列出缺失键 + `cp .env.example .env`）。跑 `npm test`（`INTEGRATION` 未设）确认干净跳过且 2.1 测试转绿。

## 3. .env.example 模板

- [x] 3.1 新建仓库根 `.env.example`：6 个键（`FEISHU_E2E_APP_ID`/`FEISHU_E2E_APP_SECRET`/`FEISHU_E2E_INTAKE_CHAT_ID`/`JIRA_E2E_ENDPOINT`/`JIRA_E2E_API_KEY`/`JIRA_E2E_PROJECT_KEY`）带注释与占位值；确认 `.env` 仍在 `.gitignore`。

## 4. 文档与 ADR 同步

- [x] 4.1 `docs/known-issues.md`（en/zh）：真实集成测试说明增补 `.env` 文件来源与 `cp .env.example .env` 提示；仍不重复字面量、指向 `tests/helpers/e2e-creds.ts`。
- [x] 4.2 `docs/development.md`（en/zh）：凭据行说明三来源优先级（env > `.env` > 默认）与 `.env.example` 复制步骤。
- [x] 4.3 `docs/adr/0017-e2e-creds-per-developer-config.md`：Status 改 accepted，记录确认决策（Q1-A/Q2-B/Q3-A/Q4-A）。
- [x] 4.4 `AGENTS.md` e2e 表真实集成行：增补 `.env` 文件层说明。
- [x] 4.5 `CONTEXT.md`「E2E 凭据」术语确认与当前实现一致（grill 阶段已起草）。

## 5. 验证

- [x] 5.1 `npm run lint && npm run typecheck && npm test`（`INTEGRATION` 未设）全绿，`integration-real.test.ts` 干净跳过。
- [x] 5.2 手动冒烟：设一个 `FEISHU_E2E_APP_ID=""` 临时跑 `INTEGRATION=1 npx vitest run tests/integration-real.test.ts`，断言快速失败信息含缺失键与 `cp .env.example .env`（随后恢复）。若真实链路不可达，说明原因。