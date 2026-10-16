# Development & Build Guide

This document targets project contributors, covering environment setup, directory structure, build/test/release flow, and code style conventions.

## Environment Requirements

| Dependency | Version | Notes |
|------|------|------|
| Node.js | 22+ | Runtime and build toolchain; the `engines` field in `package.json` declares `>=22` |
| npm | 10+ | Installed with Node |
| opencode CLI | **v2** (`>=2.0 <3`) | the worker drives turns through `opencode api`; local development requires `opencode` to be executable on `PATH` (on v1 run `opencode upgrade --major`) |
| Jira credentials | optional | real integration tests resolve from real `JIRA_E2E_*` env vars or the repo-root `.env` file (`cp .env.example .env` with your own env; no committed defaults — `INTEGRATION=1` fails fast listing missing keys); the test cleanly skips when `INTEGRATION=1` is not set |
| Feishu credentials | optional | real integration tests resolve from real `FEISHU_E2E_*` env vars or the repo-root `.env` file (same as above); it cleanly skips when `INTEGRATION=1` is not set |

## Dependency Installation

Run in the repository root:

```bash
npm install
```

Main dependencies:

- `@opencode-ai/plugin`: opencode plugin SDK (planned for the route agent's inbox tools; unused today).
- `better-sqlite3`: native SQLite binding for inbox persistence. The native module is compiled at install time, requiring a C++ toolchain (`python3`, `make`, `g++`).

Dev dependencies:

- `typescript` 5.7+: type checking and build.
- `tsx`: dev runner, executes TypeScript source directly without precompilation.
- `vitest`: test runner.
- `biome`: linting and formatting (a single tool replacing eslint+prettier).

## Directory Structure

Source lives under `src/`, mirroring capability divisions:

```
src/
├── cli/              # CLI 入口与子命令路由、daemon 生命周期
│   ├── index.ts      # main() 入口,子命令路由(init/start/status/logs/stop/tui)
│   ├── init.ts       # tasking init 脚手架
│   └── daemon.ts     # daemon 进程:加载配置、启动调度器、信号处理
├── config/           # WORKFLOW.md 加载、解析、校验、动态重载
│   ├── loader.ts     # front matter + prompt body 切分
│   ├── resolver.ts   # 默认值、$VAR、~、相对路径解析
│   ├── validator.ts  # 启动与每 tick 派发预校验
│   └── manager.ts    # 动态 watch + 重载(保留上一良好配置)
├── scheduler/        # 结构化调度器(Symphony 式确定性调度)
│   └── scheduler.ts  # 轮询 tick、状态机、并发、退避 retry、reconcile
├── worker/           # turn loop (driven through the opencode v2 api)
│   ├── runner.ts     # 子进程启动、续轮循环、失败分类、token 提取
│   └── prompt.ts     # 严格 Liquid 模板渲染、续轮指引构建
├── workspace/        # per-task 工作区管理与安全不变式
│   └── manager.ts    # key 清洗、root 包含性检查、hooks 执行
├── adapters/
│   ├── jira/         # Jira tracker 适配器(JQL、归一化、Basic auth)
│   │   └── tracker.ts
│   └── feishu/       # 飞书 v1 IM 源适配器(@mention 过滤、reply)
│       └── source.ts
├── observability/    # 结构化日志、运行时快照、HTTP dashboard
│   ├── logger.ts
│   ├── snapshot.ts
│   └── http-dashboard.ts
├── plugin/           # opencode plugin 工具(inbox.pop/mark、feishu.reply)
│   └── tools.ts
└── shared/           # 跨能力共享类型与错误
    ├── types.ts      # Task、OrchestratorRuntimeState、RunAttempt 等
    └── errors.ts     # TaskingError 与错误类别联合
```

Tests live under `tests/`, split by capability into files.

## Build and Check Commands

All commands are defined in `package.json`'s `scripts`:

| Command | Purpose | Output/Notes |
|------|------|-----------|
| `npm run build` | TypeScript compilation | outputs to `dist/` (ESM + declaration + sourcemap) |
| `npm run typecheck` | type checking (no file output) | `tsc --noEmit`, must pass in CI |
| `npm run lint` | linting | `biome check .`, must pass in CI |
| `npm run lint:fix` | auto-fix fixable issues | `biome check --write .`, includes import sorting |
| `npm run format` | formatting | `biome format --write .` |
| `npm test` | run all tests | `vitest run`, must pass in CI |
| `npm run test:watch` | watch mode | `vitest`, auto-reruns during development |
| `npm run test:e2e` | run mock-driven end-to-end tests | `vitest run tests/e2e.test.ts tests/bridge-flow.test.ts` (scheduler flow + full Feishu↔Jira bridge flow) |
| `npm run test:integration` | run real API integration tests | `INTEGRATION=1 vitest run tests/integration-real.test.ts` (real Feishu test bot/group + real Jira TEST project) |

### Build Artifacts

After `npm run build`, `dist/` contains `.js` (ESM), `.d.ts` (type declarations), and `.js.map` (sourcemap) files isomorphic to `src/`. The `bin` entry points to `dist/cli/index.js`.

### Local Verification Loop

After changes, run these in order and ensure they pass:

```bash
npm run lint
npm run typecheck
npm test
```

### End-to-End Testing Policy (mandatory gates)

Two end-to-end suites cover flows that unit/component tests cannot. Run them per the policy below before submitting (consistent with the E2E guidance in `AGENTS.md`):

- **Mock-driven E2E (hard gate)**: after changing the **Feishu adapter**, **Jira adapter**, **scheduler**, or the **Feishu↔Jira comment bridge**, you must run `npm run test:e2e` (`tests/e2e.test.ts` + `tests/bridge-flow.test.ts`). It has no external dependencies and is already enforced in CI via `npm test`.
- **Real API integration (must run when the live env is reachable)**: for the same subsystem changes, run `npm run test:integration` (`INTEGRATION=1`, real Feishu test bot/group + real Jira TEST project) whenever the live test environment is reachable (local dev with an intranet route). Credentials resolve from real env vars or the repo-root `.env` file (`cp .env.example .env` for your own test env); there are no committed defaults — `INTEGRATION=1` fails fast listing missing keys. When the environment is unreachable (e.g. CI's ubuntu-latest) the suite is skipped, but state the reason in the commit message or MR description. Real integration catches mock false positives (see `docs/known-issues.md` and ADR 0010).
- **Other changes**: test as needed — run the routing-map unit test files (`AGENTS.md`) for the touched subsystem, plus the relevant E2E suite if the change affects end-to-end behavior.
- **Real opencode v2 smoke**: `tests/integration-opencode-v2.test.ts` (`INTEGRATION=1`) spawns a private v2 `serve` (temp config/db, provider key from the local auth.json) and drives create/prompt/pending/reply/outcome plus interrupt; the provider comes from `OPENCODE_SMOKE_MODEL` (default `siliconflow-cn/Qwen/Qwen3.5-4B`), and `OPENCODE_SMOKE_SHARED=1` drives the machine's shared service instead (for models that depend on the console workspace); it skips with an explicit reason when no v2 binary/credentials exist or the provider quota is exhausted.
- **Real Feishu approval-card smoke (semi-automated)**: `npm run test:card-smoke` (`INTEGRATION=1 CARD_SMOKE=1`) posts a real approval card into the intake group; a human clicks "Allow once" twice to verify the real WS event channel -> router -> coordinator replies exactly once and stamps the card in place. Requires the test app to subscribe `card.action.trigger`.
- When adding a new end-to-end test file, add it to the `test:e2e` script file list in `package.json`.

## Dev Run

No precompilation needed; run TypeScript source directly with `tsx`:

```bash
# 运行 CLI(等价于 tasking start)
npm run dev -- start

# 带参数
npm run dev -- init
npm run dev -- start path/to/WORKFLOW.md --port 8080
```

`npm run dev` actually runs `tsx src/cli/index.ts`, passing subsequent args through to the CLI.

## Release Process

### Pre-release Check

The `prepublishOnly` script in `package.json` runs `npm run build` automatically before `npm publish`, ensuring the latest build is published.

### Release Artifact Scope

The `files` field restricts the npm package to:

- `dist/`: build artifacts.
- `README.md`: English quick start.

`docs/`, `src/`, `tests/`, `openspec/`, etc. are **not included in the published package**.

### Release Steps

```bash
# 1. 确认版本号(在 package.json 中修改 version)
# 2. 本地构建验证
npm run build
node dist/cli/index.js --help

# 3. dry-run 检查包内容
npm publish --dry-run

# 4. 正式发布
npm publish
```

The `bin` field makes the `tasking` command globally available after install: `"bin": { "tasking": "dist/cli/index.js" }`. `dist/cli/index.js` contains the `#!/usr/bin/env node` shebang and needs executable permission (`chmod +x` after build).

## Code Style Conventions

- **Module system**: ESM (`"type": "module"`), NodeNext module resolution. Relative imports **must** carry the `.js` extension (TS maps it to the `.ts` source file).
- **TypeScript strict mode**: enables `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`.
- **Code style**: enforced by biome:
  - double quotes (`"`)
  - semicolons (`;`)
  - trailing commas (`"all"`)
  - 2-space indent
  - 100-column width
- **import order**: maintained automatically by biome's `organizeImports`; run `npm run lint:fix` to fix.
- **Tests**: vitest, test files under `tests/` or co-located `*.test.ts` next to source. Each test should be independent and parallelizable.
- **No comments**: do not add code comments unless explicitly requested.
- **CI**: `.github/workflows/ci.yml` runs `lint`, `typecheck`, `test` on push/PR; all three must pass.

## AGENTS.md Conventions

`AGENTS.md` records the coding agent working guide, including the command list and architecture overview. When modifying the config schema or command behavior, you must keep `AGENTS.md`, `docs/configuration.md`, and `docs/usage.md` in sync.
