## Why

修改飞书/Jira/调度等端到端关键逻辑后，开发代理只跑对应子系统的单元测试，经常漏掉跨组件链路，回归风险高（此前 mock 假阳性已造成 17 个手动 bug）。`AGENTS.md` 现有引导只要求"改子系统跑对应单测文件"，未强制端到端集成测试；同时缺少一键运行 E2E 的 npm 脚本。

## What Changes

- 在 `AGENTS.md` 增加测试策略引导：修改飞书/Jira/调度/comment bridge 逻辑后**必须**运行 mock 驱动的端到端测试（`tests/e2e.test.ts` + `tests/bridge-flow.test.ts`，作为硬门禁，CI 已强制）；当 live 测试环境可达时（本地开发）**必须**再跑 `INTEGRATION=1` 真实 API 集成测试（`tests/integration-real.test.ts`），环境不可达时在 commit/MR 注明原因。其他子系统变更按需测试（对应单测 + 影响端到端行为时跑相关 E2E）。
- `package.json` 新增两个脚本：
  - `test:e2e` → `vitest run tests/e2e.test.ts tests/bridge-flow.test.ts`（mock E2E）
  - `test:integration` → `INTEGRATION=1 vitest run tests/integration-real.test.ts`（真实集成）
- `docs/zh/development.md` 与 `docs/en/development.md`（双语同步）补充测试策略与运行命令说明。
- 记录决策到 `docs/adr/0014-test-policy-e2e-gate.md`，并在 `CONTEXT.md` 补充相关术语。

## Capabilities

### New Capabilities

- `test-guidance`: 定义项目对开发代理/贡献者的测试策略契约——端到端关键子系统的必跑测试集、一键运行命令，以及真实集成测试的运行条件（`INTEGRATION=1`、live 环境可达）。

### Modified Capabilities

<!-- 无现有 spec 的运行时行为变化 -->

## Impact

- 文档：`AGENTS.md`、`docs/{zh,en}/development.md`
- 构建脚本：`package.json`（新增 `test:e2e`、`test:integration`）
- 决策与词汇：`docs/adr/`（新增 ADR 0014）、`CONTEXT.md`
- 无运行时代码变更；CI（`.github/workflows/ci.yml`）行为不变（真实集成在 CI 天然跳过）。
