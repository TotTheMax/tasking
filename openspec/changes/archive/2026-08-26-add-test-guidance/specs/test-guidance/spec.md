## ADDED Requirements

### Requirement: 端到端关键子系统变更必跑 mock E2E
仓库的开发引导（AGENTS.md）SHALL 规定：修改飞书适配器、Jira 适配器、调度器或飞书↔Jira comment bridge 逻辑后，必须运行 mock 驱动的端到端测试（`tests/e2e.test.ts` 与 `tests/bridge-flow.test.ts`）。该测试集是硬门禁，已由 `npm test`/CI 覆盖。

#### Scenario: 修改 Jira 适配器后引导必跑 mock E2E
- **WHEN** 开发者/代理修改 `src/adapters/jira/` 或 `src/adapters/feishu/`、`src/scheduler/`、`src/bridge/` 逻辑
- **THEN** AGENTS.md 引导其运行 `tests/e2e.test.ts` + `tests/bridge-flow.test.ts`（mock E2E），且 CI 中的 `npm test` 强制其通过

### Requirement: 真实 API 集成测试在 live 环境可达时必跑
仓库的开发引导 SHALL 规定：当 live 测试环境可达时（本地开发），上述端到端关键子系统变更还必须运行真实 API 集成测试（`INTEGRATION=1` 运行 `tests/integration-real.test.ts`）；环境不可达时，须在 commit 或 MR 中注明未跑原因。该测试不纳入 CI（CI 无内网路由），不可达不阻塞。

#### Scenario: live 环境可达时运行真实集成
- **WHEN** 修改 bridge 逻辑且本地可达真实飞书测试 bot/群与真实 Jira TEST 项目
- **THEN** 开发者运行 `INTEGRATION=1` 的真实集成测试（`tests/integration-real.test.ts`）并确认通过

#### Scenario: live 环境不可达时注明原因
- **WHEN** 修改适配器逻辑但运行环境无法访问真实 Jira/飞书（如 CI 的 ubuntu-latest）
- **THEN** 该测试不被强制运行，且开发者须在 commit message 或 MR 描述中注明原因

### Requirement: 提供一键 E2E 运行脚本
`package.json` SHALL 提供两个脚本：`test:e2e`（运行 `tests/e2e.test.ts` 与 `tests/bridge-flow.test.ts`）与 `test:integration`（以 `INTEGRATION=1` 运行 `tests/integration-real.test.ts`），使开发引导可以直接引用命令。

#### Scenario: test:e2e 运行 mock E2E
- **WHEN** 运行 `npm run test:e2e`
- **THEN** vitest 执行 `tests/e2e.test.ts` 与 `tests/bridge-flow.test.ts`，且不执行真实集成测试

#### Scenario: test:integration 运行真实集成
- **WHEN** 运行 `npm run test:integration`
- **THEN** 以 `INTEGRATION=1` 执行 `tests/integration-real.test.ts`，连接真实飞书/Jira 测试资源

### Requirement: 引导与文档一致
`AGENTS.md`、`docs/zh/development.md`、`docs/en/development.md` 的测试策略 SHALL 相互一致，均引用 `npm run test:e2e` / `npm run test:integration` 命令名；docs 双语同步由 `tests/docs-links.test.ts` 维护文件名 parity。

#### Scenario: AGENTS.md 与 docs 引用同一命令
- **WHEN** 阅读 AGENTS.md 与 docs/zh/development.md、docs/en/development.md 的测试策略
- **THEN** 三者描述一致的必跑规则与命令名 `npm run test:e2e`、`npm run test:integration`
