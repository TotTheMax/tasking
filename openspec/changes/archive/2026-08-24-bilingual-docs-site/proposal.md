# 双语文档站点（bilingual-docs-site）

## Why

现有 `docs/` 全为简体中文，国际用户无法直接使用；用户需要中英文快速切换，并要求在 GitLab/GitHub Pages 上默认展示中文、可一键切换全局默认语言（后续可改为默认英文）。已归档变更 `add-chinese-docs` 当时明确暂缓了「站点生成器」与「i18n 多语言框架」两项；本变理解冻这两项，交付一个仓库内、跨平台（GitLab + GitHub）、简单易用的双语文档站点。

## What Changes

- 引入 **VitePress**（npm devDep，仓库内，无外部运行时依赖）作为文档站点生成器；现有 `docs/*.md` 正文迁入 `docs/zh/`，新增 `docs/en/` 全量英文翻译（12 篇正文 + 各语言 `index.md`，slug 与中文一一对应，bilingual parity）。
- 新增 `docs/.vitepress/config.ts`：i18n 双 locale（`zh`/`en`）+ 导航栏语言切换器 + **单一 `defaultLocale`**（初值 `"zh"`，改一行即可切到 `"en"`），根路径重定向到 `defaultLocale`。
- `docs/adr/`（10 篇英文 ADR）**共享不复制**——两语言下指向同一份。
- 根 `README` 双语：`README.md` 保持英文（npm 发布主入口）+ 新增 `README.zh-CN.md`（中文），各自顶部加语言切换链接。
- 跨平台 Pages 部署（均仓库内）：新增 `.gitlab-ci.yml`（`pages` job：`npm ci` → `npm run docs:build` → 产物到 `public/`）与 `.github/workflows/docs.yml`（GitHub Pages，同一构建命令）。
- 扩展 `tests/docs-links.test.ts`：扫描 `docs/{zh,en}/**/*.md`，断言 zh/en 文件名一一对应，断言两语言树内本地相对链接均解析；扫描根 `README.md`/`README.zh-CN.md`/`CONTEXT.md`。
- `package.json` 新增 `docs:build`/`docs:dev`/`docs:preview` 脚本与 `vitepress` devDep；`files` 字段不变（站点不进 npm 包）。
- 新增 `docs/adr/0012-bilingual-docs-site.md` 记录「采用 VitePress + 双平台 Pages 部署，取代 add-chinese-docs 决策1的『不引入站点生成器』」。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `chinese-docs`：将「文档语言与一致性」要求由「仅简体中文」放宽为「zh+en 双语，命令/键名/路径保持原文」；新增「双语对等」「语言切换器」「默认语言可配」「文档站点与部署」要求；将「文档目录与索引」更新为按 locale 分目录（`docs/zh/`、`docs/en/`）；将「文档内链完整性」更新为扫描双语言树并校验 zh/en 文件名一一对应。

## Impact

- 新增文件：`docs/.vitepress/config.ts`、`docs/zh/**`（迁入现有正文）、`docs/en/**`（全量翻译）、`docs/zh/index.md`、`docs/en/index.md`、`README.zh-CN.md`、`.gitlab-ci.yml`、`.github/workflows/docs.yml`、`docs/adr/0012-bilingual-docs-site.md`。
- 修改文件：`package.json`（devDep + scripts）、`tests/docs-links.test.ts`、根 `README.md`（顶部加语言切换链）、`openspec/specs/chinese-docs/spec.md`（apply 后由变更同步）。
- 删除（移动）：`docs/*.md` 正文文件迁入 `docs/zh/`（原路径不再存在，由测试与索引重指）。
- 无 `src/` 源码、运行时、API、配置 schema、数据模型变更；npm 发布产物（`files`）不变。
