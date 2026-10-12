# 双语文档站点 design

## Context

`tasking` 文档现状：`docs/` 下 12 篇简体中文正文 + `docs/README.md` 索引（含术语对照表）+ `docs/adr/` 10 篇英文 ADR；根 `README.md` 为英文（npm 发布入口）；`CONTEXT.md` 为英文项目术语表。无文档站点生成器，markdown 在 GitLab Web 直接渲染。CI 仅 `.github/workflows/ci.yml`（lint→typecheck→test）；无 `.gitlab-ci.yml`、无 Pages job。仓库托管于自建 GitLab（192.168.10.180），MR 走 glab，后续将镜像到 GitHub。GitLab Pages 已启用（`pages_access_level=private`）。既有 `tests/docs-links.test.ts` 守护文档内链完整性。已归档变更 `add-chinese-docs` 当时明确暂缓了「站点生成器」与「i18n 多语言框架」。

干系人：中文工程团队、国际用户/贡献者、运维者。

约束（来自用户拷问答复）：
1. 仓库内、不引入仓库外的东西或流程；
2. 跨平台（GitLab + GitHub 后续镜像）；
3. 简单易用；
4. 全量翻译；
5. ADR 不译、其余 `docs/` 中英双；
6. 根 `README` 中英双。

npm 可达性已验证：`.npmrc` 仅把 `@ai-agent-infra` scope 指向内部 registry，其余包回退公共 npm，`vitepress` 可解析安装（`npm view vitepress` → registry.npmjs.org 1.6.4）。

## Goals / Non-Goals

**Goals:**
- 交付 VitePress 双语站点：`docs/zh/` + `docs/en/` 全量对等，导航栏语言切换器，单一 `defaultLocale` 配置项（初值 `zh`，一行可改 `en`），根路径重定向到 `defaultLocale`。
- 跨平台 Pages 部署：GitLab `.gitlab-ci.yml` pages job + GitHub `.github/workflows/docs.yml`，同一构建命令，均仓库内。
- 根 `README` 双语互链；`docs/adr/` 共享不译。
- 扩展文档链接完整性测试，守护双语对等与双语言树内链。
- 不改 `src/` 运行时与 npm 发布产物。

**Non-Goals:**
- 不做全文搜索、评论、分析等站点增强（后续增量）。
- 不做翻译记忆/抽取工具（i18next 等）——文档 prose 手工对等维护，由测试守护。
- 不改 `chinese-docs` 能力名（保留为稳定 id，仅演进其要求；更名作为后续可选增量）。
- 不把站点纳入 npm 包。
- 不迁移根 `CONTEXT.md`/`AGENTS.md`/`WORKFLOW*.md` 进站点（它们是仓库治理文档，非面向用户的文档）。

## Decisions

### 决策 1：采用 VitePress 作为文档站点生成器（取代 add-chinese-docs 决策 1）
**选择：** VitePress（npm devDep，仓库内，无外部运行时依赖）。
**理由：** markdown 原生（现有 12 篇几乎可直接迁入）、内置 i18n 多 locale 与导航栏语言切换器、单一 `defaultLocale` 满足需求 #3、Vite/Vue 与本仓库 TS/Node 栈一致、构建产物自包含、GitLab/GitHub Pages 部署都只需跑构建。
**备选：** Docusaurus（React，更重）、mkdocs-material（引入 Python 工具链到纯 Node 仓库，不合适）、Docsify（无构建但 i18n/切换器弱且需 vendor JS 或走 CDN——CDN 违反「仓库内」）。本选择满足用户「仓库内 + 跨平台 + 简单」约束。

### 决策 2：目录结构 docs/{zh,en} + adr 共享
**选择：** `docs/zh/` 与 `docs/en/` 平行树，slug 一一对应；`docs/adr/` 两语言共享同一份（ADR 本英文，不复制到 locale 子目录）；`docs/.vitepress/` 放配置与主题。
**理由：** VitePress i18n 惯例即 locale 子目录；结构清晰、易守对等不变式；ADR 避免重复维护。
**备选：** `docs/{zh,en}/adr/` 各复制——重复维护，已排除。

### 决策 3：默认语言单一配置项
**选择：** `docs/.vitepress/config.ts` 顶部导出常量 `defaultLocale`（初值 `"zh"`），VitePress `locales` 中该 locale 设为 root locale（`/`），其余 locale 挂 `/en/`；根路径重定向到 `defaultLocale`。改默认语言 = 改一行常量。
**理由：** 满足需求 #3「全局默认值方便修改、后面可默认展示英文」。

### 决策 4：跨平台双 Pages 部署（仓库内）
**选择：** `.gitlab-ci.yml`（pages job：`npm ci` → `npm run docs:build` → `cp -r docs/.vitepress/dist public`）+ `.github/workflows/docs.yml`（GitHub Pages via `actions/deploy-pages`，同一构建命令）。两文件均仓库内、同一构建。
**理由：** 用户要求跨平台且仓库内；CI 配置本身就是仓库内文件，不引入仓库外流程。两平台构建一致，仅部署胶水不同。
**备选：** 仅 GitLab Pages——不满足「后续上 GitHub」；Netlify/Vercel 外部服务——违反「仓库内」，已排除。

### 决策 5：双语对等与内链由测试守护（扩展 docs-links.test.ts）
**选择：** 扩展既有 `tests/docs-links.test.ts`：扫描 `docs/{zh,en}/**/*.md`，断言 zh/en 同 slug 一一对应（bilingual parity），断言两语言树内本地相对链接均解析；扫描根 `README.md`/`README.zh-CN.md`/`CONTEXT.md`。
**理由：** 复用既有不变式风格，防漂移；公开 seam 是文件系统，不依赖被测文档实现细节。

### 决策 6：根 README 双语互链，npm 主保持英文
**选择：** `README.md` 英文（npm 发布与 GitHub/GitLab 默认渲染主），新增 `README.zh-CN.md` 中文，各自顶部加语言切换链接。
**理由：** npm 包消费者与平台默认见英文；中文用户一键切到中文。满足「根 README 中英双」。

## Risks / Trade-offs

- **[风险] 双语漂移** → zh 改了 en 未跟。**缓解：** bilingual parity 测试守护文件集对等；docs-links 测试守护两树内链；`AGENTS.md` 已要求改文档同步更新。
- **[风险] 站点构建进 CI 增耗时** → 增 `docs:build` 一步。**缓解：** VitePress 构建快（小站点秒级）；作为 CI 校验 job，失败即阻断。
- **[权衡] 能力名 `chinese-docs` 演进为双语但名未改** → 略具误导。**接受：** 更名有破坏 openspec 状态/归档引用的风险，作为后续可选增量；其 Purpose 行已更新为双语。
- **[权衡] VitePress 引入 devDep** → 增依赖体积。**接受：** 仅 devDep，不进 npm 包 `files`；构建产物自包含，无运行时外部依赖。
