## 1. npm 脚本（test:e2e / test:integration）

- [x] 1.1 在 package.json 增加 `test:e2e` 脚本（`vitest run tests/e2e.test.ts tests/bridge-flow.test.ts`），先跑 `npm run test:e2e` 确认 mock E2E 通过（红→绿：脚本即实现，运行即验证）
- [x] 1.2 在 package.json 增加 `test:integration` 脚本（`INTEGRATION=1 vitest run tests/integration-real.test.ts`），先跑 `npm run test:integration` 确认真实集成在 live 环境可达时通过（凭据默认值内置，无需 env）

## 2. AGENTS.md 测试策略引导

- [x] 2.1 在 AGENTS.md Commands 段新增"E2E 集成测试"小节：修改飞书/Jira/调度/bridge 逻辑后必跑 `npm run test:e2e`（硬门禁，CI 已强制）与 live 环境可达时必跑 `npm run test:integration`，不可达时注明原因；其他变更按需测试
- [x] 2.2 在 routing map 相关行（scheduler/feishu/jira/bridge）的 "Keep green" 列补充对应 E2E 测试文件

## 3. docs 双语同步

- [x] 3.1 更新 docs/zh/development.md 本地验证闭环段：补充测试策略与 `npm run test:e2e` / `npm run test:integration` 说明
- [x] 3.2 更新 docs/en/development.md 对应内容（与 zh 保持文件名 parity，`tests/docs-links.test.ts` 需通过）

## 4. 决策与词汇记录

- [x] 4.1 新增 docs/adr/0014-test-policy-e2e-gate.md 记录测试策略决策（mock E2E 硬门禁 + live 可达时真实集成；新增脚本为真源）
- [x] 4.2 在 CONTEXT.md Testing 段补充"Mock 驱动 E2E"与"测试策略"术语（与 真实 API 集成测试 / E2E 凭据 术语一致）

## 5. 验证与提交

- [x] 5.1 全量门禁：`npm run lint`、`npm run typecheck`、`npm test`、`npm run docs:build` 全部通过
- [x] 5.2 提交代码与 openspec 变更到 feature 分支（`feature/TAS-23-add-test-guidance`），推送到 origin 并创建 GitLab MR
