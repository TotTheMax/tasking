## Context

仓库已有三层测试：mock 驱动的 E2E（`tests/e2e.test.ts` 调度链路 + `tests/bridge-flow.test.ts` 飞书↔Jira bridge 全流程，`npm test`/CI 默认运行）、真实 API 集成测试（`tests/integration-real.test.ts`，`INTEGRATION=1` 门控，凭据默认值内置 `tests/helpers/e2e-creds.ts`，CI 因无内网路由天然跳过，见 ADR 0010）、以及各子系统单测。`AGENTS.md` 的 routing map 已把子系统映射到"必须保持绿色"的单测文件，但未强制端到端；也没有一键跑 E2E 的 npm 脚本。

本变更目标（TAS-23）：把"修改飞书/Jira/调度/bridge 逻辑后必须运行端到端集成测试"固化为开发代理可见、可执行的引导。TAS-23 拷问已确认（Q1=A、Q2=A）：mock E2E 为硬门禁（CI 强制）+ live 环境可达时必跑真实集成；新增 `test:e2e`/`test:integration` 脚本并在 AGENTS.md 与双语 docs 引用。

## Goals / Non-Goals

**Goals:**

- 让 `AGENTS.md` 明确：飞书/Jira/调度/bridge 逻辑变更的必跑测试集（mock E2E 硬门禁 + 可达时真实集成），其他变更按需测试。
- 提供 `test:e2e`、`test:integration` 一键命令，使引导可直接执行。
- docs（zh/en 双语）与 AGENTS.md、ADR、CONTEXT.md 一致。

**Non-Goals:**

- 不修改 CI 配置：真实集成在 CI 继续跳过（无内网路由，ADR 0010 立场不变），mock E2E 已由 `npm test` 覆盖。
- 不新增/修改任何运行时代码与测试用例本身；不动 `tests/` 现有断言。
- 不把真实集成变成无条件硬门禁（环境不可达时不得阻塞）。

## Decisions

- **必跑集分两层，而非单一"端到端"**：mock E2E（`test:e2e`）是无条件硬门禁（已在 CI）；真实集成（`test:integration`）是"live 环境可达时必跑"，不可达时须在 commit/MR 注明原因。理由：真实集成打真实飞书/Jira 测试资源，CI/离线环境无法满足；mock E2E 始终可跑且覆盖相同流程。备选（仅真实集成、或无条件真实集成）均因环境依赖被否。
- **新增两个独立 npm 脚本，而非一个**：`test:e2e` 与 `test:integration` 分开，避免 `test:integration` 的 `INTEGRATION=1` 环境变量污染其他测试。`test:e2e` 固定文件列表（`e2e.test.ts` + `bridge-flow.test.ts`），不跑全量单测，保持快速。
- **引导落点**：`AGENTS.md` 的 Commands 段加 E2E 段落并在 routing map 加注；docs `development.md` 的"本地验证闭环"补测试策略；新增 ADR 0014 记录测试策略决策；CONTEXT.md Testing 段补"Mock 驱动 E2E"与"测试策略"术语。
- **不做自动化检测**：不实现"按 diff 检测是否必跑 E2E"的脚本/钩子——CI 已用 `npm test` 兜底 mock E2E，真实集成无法自动判断环境可达性。引导靠 AGENTS.md 文档约定。

## Risks / Trade-offs

- [真实集成测试会创建真实 Jira issue 与飞书消息，且依赖内网路由] → 测试自清理 Jira issue；文档明确只在 live 环境可达时运行，不可达时注明原因，不阻塞。
- [文档与脚本命令可能漂移] → 脚本即真源，AGENTS.md/docs 均引用 `npm run test:e2e`/`test:integration` 命令名而非复述命令体；docs 双语同步由 `tests/docs-links.test.ts` 守文件名 parity。
- [`test:e2e` 固定文件列表后续新增 E2E 文件时可能遗漏] → AGENTS.md 注明"新增端到端测试文件时同步加入 `test:e2e` 列表"，并在 ADR 记录。
