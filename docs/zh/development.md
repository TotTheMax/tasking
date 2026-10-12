# 开发编译指南

本文档面向项目贡献者,介绍环境搭建、目录结构、构建/测试/发布流程与代码风格约定。

## 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | 22+ | 运行时与构建工具链;`package.json` 的 `engines` 字段声明 `>=22` |
| npm | 10+ | 随 Node 安装 |
| opencode CLI | 与本机 opencode 版本一致 | worker 子进程依赖;本地开发需在 `PATH` 上可执行 `opencode run` |
| Jira 凭据 | 可选 | 真实集成测试从真实 `JIRA_E2E_*` 环境变量或仓库根 `.env` 文件解析（`cp .env.example .env` 填写个人环境；无代码默认值——`INTEGRATION=1` 且缺失时快速失败并列出缺失键）；未设 `INTEGRATION=1` 时该测试干净跳过 |
| 飞书凭据 | 可选 | 真实集成测试从真实 `FEISHU_E2E_*` 环境变量或仓库根 `.env` 文件解析（同上）；未设 `INTEGRATION=1` 时干净跳过 |

## 依赖安装

在仓库根目录执行:

```bash
npm install
```

主要依赖说明:

- `@opencode-ai/plugin`:opencode plugin SDK（规划用于 route agent 的 inbox 工具，当前未使用）。
- `better-sqlite3`:inbox 持久化的原生 SQLite 绑定。安装时会编译原生模块,需具备 C++ 编译工具链(`python3`、`make`、`g++`)。

开发依赖:

- `typescript` 5.7+:类型检查与构建。
- `tsx`:开发运行,直接执行 TypeScript 源码无需预编译。
- `vitest`:测试运行器。
- `biome`:代码检查与格式化(单工具替代 eslint+prettier)。

## 目录结构

源码位于 `src/`,镜像能力划分:

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
├── worker/           # opencode run 子进程 worker
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

测试位于 `tests/`,按能力分文件。

## 构建与检查命令

所有命令定义在 `package.json` 的 `scripts` 中:

| 命令 | 作用 | 产物/说明 |
|------|------|-----------|
| `npm run build` | TypeScript 编译 | 输出到 `dist/`(ESM + declaration + sourcemap) |
| `npm run typecheck` | 类型检查(不输出文件) | `tsc --noEmit`,CI 必须通过 |
| `npm run lint` | 代码检查 | `biome check .`,CI 必须通过 |
| `npm run lint:fix` | 自动修复可修问题 | `biome check --write .`,含 import 排序 |
| `npm run format` | 格式化 | `biome format --write .` |
| `npm test` | 运行全部测试 | `vitest run`,CI 必须通过 |
| `npm run test:watch` | 测试监听模式 | `vitest`,开发时自动重跑 |
| `npm run test:e2e` | 运行 mock 驱动的端到端测试 | `vitest run tests/e2e.test.ts tests/bridge-flow.test.ts`（调度链路 + 飞书↔Jira bridge 全流程） |
| `npm run test:integration` | 运行真实 API 集成测试 | `INTEGRATION=1 vitest run tests/integration-real.test.ts`（真实飞书测试 bot/群 + 真实 Jira TEST 项目） |

### 构建产物

`npm run build` 后,`dist/` 下生成与 `src/` 同构的 `.js`(ESM)、`.d.ts`(类型声明)、`.js.map`(sourcemap)文件。`bin` 入口指向 `dist/cli/index.js`。

### 本地验证闭环

修改后,务必依次运行并确保通过:

```bash
npm run lint
npm run typecheck
npm test
```

### 端到端测试策略（必跑门禁）

仓库有两套单测/组件测试覆盖不到的端到端套件，按以下策略在提交前运行（与 `AGENTS.md` 的 E2E 引导一致）：

- **Mock 驱动 E2E（硬门禁）**：修改**飞书适配器**、**Jira 适配器**、**调度器**或**飞书↔Jira comment bridge** 逻辑后，必须运行 `npm run test:e2e`（`tests/e2e.test.ts` + `tests/bridge-flow.test.ts`）。该测试无外部依赖，CI 的 `npm test` 已强制。
- **真实 API 集成（live 环境可达时必跑）**：同样的子系统变更，在 live 测试环境可达时（本地开发含内网路由）还必须运行 `npm run test:integration`（`INTEGRATION=1`，真实飞书测试 bot/群 + 真实 Jira TEST 项目）。凭据从真实环境变量或仓库根 `.env` 文件解析（`cp .env.example .env` 填写个人测试环境）；无代码默认值——`INTEGRATION=1` 且缺失时快速失败并列出缺失键。环境不可达时（如 CI 的 ubuntu-latest）该测试被跳过，但须在 commit message 或 MR 描述中注明原因。真实集成能拦截 mock 假阳性（见 `docs/known-issues.md` 与 ADR 0010）。
- **其他变更**：按需测试——运行路由映射表（`AGENTS.md`）中对应子系统的单测文件；若变更影响端到端行为，再加跑相关 E2E 套件。
- 新增端到端测试文件时，请同步加入 `package.json` 的 `test:e2e` 脚本文件列表。

## 开发运行

无需预编译,用 `tsx` 直接运行 TypeScript 源码:

```bash
# 运行 CLI(等价于 tasking start)
npm run dev -- start

# 带参数
npm run dev -- init
npm run dev -- start path/to/WORKFLOW.md --port 8080
```

`npm run dev` 实际执行 `tsx src/cli/index.ts`,后续参数透传给 CLI。

## 发布流程

### 发布前检查

`package.json` 的 `prepublishOnly` 脚本会在 `npm publish` 前自动执行 `npm run build`,确保发布的是最新构建产物。

### 发布产物范围

`files` 字段限定 npm 包仅包含:

- `dist/`:编译产物。
- `README.md`:英文快速上手。

`docs/`、`src/`、`tests/`、`openspec/` 等**不纳入发布包**。

### 发布步骤

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

`bin` 字段使安装后 `tasking` 命令全局可用:`"bin": { "tasking": "dist/cli/index.js" }`。`dist/cli/index.js` 含 `#!/usr/bin/env node` shebang,需有可执行权限(构建后 `chmod +x`)。

## 代码风格约定

- **模块系统**:ESM(`"type": "module"`),NodeNext 模块解析。相对导入**必须**带 `.js` 扩展名(TS 会将其映射到 `.ts` 源文件)。
- **TypeScript strict 模式**:启用 `strict`、`noUncheckedIndexedAccess`、`noImplicitOverride`。
- **代码风格**:由 biome 强制:
  - 双引号(`"`)
  - 分号(`;`)
  - 尾逗号(`"all"`)
  - 缩进 2 空格
  - 行宽 100
- **import 顺序**:由 biome `organizeImports` 自动维护,运行 `npm run lint:fix` 修复。
- **测试**:vitest,测试文件位于 `tests/` 或与源码同目录的 `*.test.ts`。每个测试应独立、可并行。
- **无注释**:除非明确要求,不添加代码注释。
- **CI**:`.github/workflows/ci.yml` 在 push/PR 时运行 `lint`、`typecheck`、`test`,三者必须全部通过。

## AGENTS.md 约定

`AGENTS.md` 记录了 coding agent 工作指南,包括命令清单与架构概览。修改配置 schema 或命令行为时,必须同步更新 `AGENTS.md`、`docs/configuration.md` 与 `docs/usage.md`。
