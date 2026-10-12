# 采用 VitePress 双语文档站点 + 双平台 Pages 部署

文档系统由「纯 Markdown 在 GitLab Web 直接渲染」升级为 VitePress 双语（`docs/zh/` + `docs/en/`）静态站点，导航栏内置语言切换器，根路径默认展示 `defaultLocale`（初值 `zh`，改 `docs/.vitepress/config.ts` 顶部常量即切默认语言）。部署走仓库内跨平台 Pages：`.gitlab-ci.yml` 的 `pages` job 与 `.github/workflows/docs.yml`，两者共用同一 `npm run docs:build`。本决策取代已归档 `add-chinese-docs` 决策 1「不引入站点生成器」——当时因体量小而暂缓，TAS-16 的双语 + 快速切换 + 可配默认语言需求使站点生成器成为必需。

备选：Docusaurus（React，对纯文档过重）、mkdocs-material（把 Python 工具链引入纯 Node 仓库）、Docsify（无构建但 i18n/切换器弱且需 CDN 或 vendor JS——与「仓库内」约束冲突）。选 VitePress 因其 markdown 原生、内置 i18n + 语言切换器、单一 `defaultLocale` 满足可配默认语言、Vite/Vue 与本仓库 TS/Node 栈一致、构建产物自包含无运行时外部依赖。实现用 `rewrites` 把默认语言源文件（`docs/<locale>/`）映射到根路由，使「切默认语言 = 改一行常量、无需移动文件」；`../` 相对链接（ADR、`CONTEXT.md` 等）在 VitePress 死链检查中忽略，改由 `tests/docs-links.test.ts` 按文件系统校验，使同一份相对链接在 GitLab/GitHub 原始浏览与 Pages 站点上均可用（跨平台）。代价是 `ignoreDeadLinks` 让 VitePress 不再校验 `../` 链接，但文档内链完整性不变式仍由测试守护；`chinese-docs` 能力名略具误导（演进为双语但未更名，更名作为后续可选增量，避免破坏 openspec 状态/归档引用）。
