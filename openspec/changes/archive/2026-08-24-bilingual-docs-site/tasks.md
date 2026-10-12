# Tasks

## 1. 双语对等与内链测试（TDD red→green）

- [x] 1.1 改 `tests/docs-links.test.ts` 为失败态：扫描 `docs/{zh,en}/**/*.md`（递归）+ 根 `README.md`/`README.zh-CN.md`/`CONTEXT.md`；新增断言 `docs/zh/` 与 `docs/en/` 同 slug 一一对应（bilingual parity）；断言两语言树内全部本地相对链接均解析到已存在文件。运行确认红（`docs/zh/`、`docs/en/` 尚不存在，parity 与链接均失败）。
- [x] 1.2 若 1.1 运行暴露与本次新增无关的既有断链，作为文档卫生修复之并记录修复处。

## 2. VitePress 站点骨架（使 docs:build 可跑）

- [x] 2.1 `package.json` 加 `vitepress` devDep 与 `docs:build`/`docs:dev`/`docs:preview` 脚本（`docs:build` = `vitepress build docs`，`docs:dev` = `vitepress dev docs`，`docs:preview` = `vitepress preview docs`）；`npm install` 确认 `vitepress` 可装；`files` 字段保持不变（站点不进 npm 包）。先确认 `npm run docs:build` 在无 config 时红。
- [x] 2.2 写 `docs/.vitepress/config.ts`：顶部导出 `const defaultLocale = "zh" as const`；`defineConfig` 内 `locales` 配双 locale（`zh` 为 root `/`、`en` 为 `/en/`）；`themeConfig` 配导航栏 + 语言切换器（VitePress i18n `localeLinks`）；`srcDir` 默认 `docs`（即 `docs/.vitepress/`）。`npm run docs:build` 转绿（产出 `docs/.vitepress/dist`）。

## 3. 中文文档迁入 docs/zh/

- [x] 3.1 `git mv` 现有 `docs/*.md`（12 篇正文 + 原 `docs/README.md` → `docs/zh/index.md`）入 `docs/zh/`；修正迁移后的内部相对链接：同目录互引保持 `./x.md`；指向 `docs/adr/` 用 `../adr/x.md`。
- [x] 3.2 `docs/zh/index.md` 顶部加语言切换链接，指向 `/en/` 对应页。

## 4. 英文全量翻译 docs/en/

- [x] 4.1 为 12 篇正文各写 `docs/en/<slug>.md` 英文版，slug 与 zh 一一对应；命令/配置键名/代码标识符/文件路径/示例代码保持原文（不翻译）；内部链接指向 en 同目录或 `../adr/`；内容与 zh 对等（描述同一行为/字段/默认值）。
- [x] 4.2 写 `docs/en/index.md`（英文索引），顶部加语言切换链接指向 `/`（zh）。

## 5. 根 README 双语互链

- [x] 5.1 `README.md` 顶部加语言切换链接（指向 `README.zh-CN.md`）；保持英文为主；Quick start 末尾的中文上手链接改指 `docs/zh/getting-started.md`。
- [x] 5.2 新增 `README.zh-CN.md`（中文，内容与英文 README 对等），顶部加语言切换链接指向 `README.md`；其 docs 链接指向 `docs/zh/`。

## 6. 跨平台 Pages 部署（仓库内）

- [x] 6.1 新增 `.gitlab-ci.yml`：`pages` job（`image: node:22` → `npm ci` → `npm run docs:build` → `cp -r docs/.vitepress/dist public` → `artifacts: paths: [public]`，`only/refs: main`）。
- [x] 6.2 新增 `.github/workflows/docs.yml`：`actions/checkout@v4` → `setup-node@v4`(22) → `npm ci` → `npm run docs:build` → `actions/configure-pages`+`upload-pages-artifact`(`docs/.vitepress/dist`)+`deploy-pages`；`on.push.branches:[main]` + workflow_dispatch。
- [x] 6.3 `.github/workflows/ci.yml` 增一步 `npm run docs:build`（站点构建校验，防漂移），不动 lint/typecheck/test 门禁顺序。

## 7. ADR + openspec 校验 + 全量验证

- [x] 7.1 新增 `docs/adr/0012-bilingual-docs-site.md`：Status=accepted；记录采用 VitePress + 双平台（GitLab+GitHub）Pages 部署，取代 `add-chinese-docs` 决策 1「不引入站点生成器」；含 Considered Options（Docusaurus/mkdocs-material/Docsify）与 Consequences。
- [x] 7.2 `openspec status --change bilingual-docs-site` 确认 `applyRequires`（tasks）done、全绿；`openspec validate --change bilingual-docs-site`（若可用）校验 spec delta 合法（MODIFIED 项命中既有 requirement、scenario 为 4 个 `#`）。
- [x] 7.3 `npm run lint && npm run typecheck && npm test` 全绿（含扩展后的 `tests/docs-links.test.ts`）；`npm run docs:build` 成功产出含 zh/en 两语言的 `docs/.vitepress/dist`。
