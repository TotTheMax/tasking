简体中文 | [English](./CONTRIBUTING.md)

# 贡献 tasking

感谢你有兴趣贡献！

## 环境搭建

- Node.js 22+
- npm

```bash
git clone https://github.com/TotTheMax/tasking.git
cd tasking
npm install
```

## 开发门禁

提交 PR 前依次运行以下命令，并保持全部通过：

```bash
npm run lint        # biome check
npm run typecheck   # tsc --noEmit
npm test            # vitest run（单测 + mock 驱动的 E2E）
npm run build       # tsc -> dist/
```

改动某个子系统时，请加跑该子系统的测试文件——文件与测试的对应关系见 [AGENTS.md](./AGENTS.md) 的路由映射表。

## 测试说明

- 单测与 mock 驱动的 E2E 用 `npm test` 即可在任何环境运行——不依赖外部服务。
- 真实 API 集成套件（`INTEGRATION=1`，`npm run test:integration` / `npm run test:event-flow`）需要维护者的内部飞书/Jira 测试环境。缺少凭据时会快速失败并列出缺失项，否则跳过——外部贡献者无需运行。如果你的改动涉及飞书适配器、Jira 适配器、调度器或桥接层，请在 PR 中说明，由维护者运行。

## 文档双语制

`docs/zh/` 下的每一页都必须在 `docs/en/` 有对应同名页（反之亦然）。`tests/docs-links.test.ts` 强制校验双语成对与链接完整性——两个语言版本要一起改。架构决策记录在 `docs/adr/`（编号递增，记录取舍而非仅结论）。

## 变更流程

实质性变更走 [OpenSpec](./openspec/)：先撰写提案（`openspec/changes/<change>/proposal.md|design.md|tasks.md`），实现后归档。工作流与仓库自带的 opsx skills/commands 见 AGENTS.md。小修（错别字、文档澄清、带测试的 bugfix）可以直接提 PR。

## 代码风格

- Biome 强制风格（双引号、分号、尾逗号、100 列）；`npm run lint:fix` 自动修复。
- ESM + NodeNext：相对导入即使源文件是 `.ts` 也必须带 `.js` 扩展名。
- 严格 TypeScript（`noUncheckedIndexedAccess`、`noImplicitOverride`）。
- 除非明确要求，不写代码注释。

## Pull Request

使用 PR 模板（`.github/pull_request_template.md`）：背景、TL;DR、摘要、备选方案、以及确认上述门禁通过的测试计划。
