## MODIFIED Requirements

### Requirement: 文档目录与索引
项目 SHALL 在 `docs/` 下按 locale 分目录组织双语文档集：`docs/zh/`（简体中文）与 `docs/en/`（英文），两目录 SHALL 提供同 slug 一一对应的正文文件。每个 locale 目录 SHALL 包含 `index.md` 作为该语言的文档索引，列出各分册标题、用途与适用读者并附相对链接。`docs/adr/` SHALL 为两语言共享的单一目录（英文 ADR 不按 locale 复制）。`docs/.vitepress/` SHALL 存放站点配置与主题。

#### Scenario: 双 locale 目录存在
- **WHEN** 查看 `docs/` 目录
- **THEN** 存在 `docs/zh/`、`docs/en/` 子目录，各含 `index.md`、`usage.md`、`development.md`、`architecture.md`、`configuration.md` 等同 slug 文件

#### Scenario: 各 locale 索引链接到分册
- **WHEN** 打开 `docs/zh/index.md` 或 `docs/en/index.md`
- **THEN** 它列出该语言全部文档并附说明与相对链接

#### Scenario: ADR 共享不复制
- **WHEN** 查看 `docs/adr/`
- **THEN** 存在单一 `docs/adr/` 目录，不在 `docs/zh/` 或 `docs/en/` 下复制

### Requirement: 文档语言与一致性
项目 SHALL 维护两套正文：`docs/zh/` 简体中文与 `docs/en/` 英文，两套正文 SHALL 描述同一内容（bilingual parity）。正文说明文字 SHALL 在两语言间翻译；命令、配置键名、代码标识符、文件路径、示例代码 SHALL 保持原文（不翻译）。文档内容 SHALL 与 `package.json`、`src/` 源码、`WORKFLOW.md.example` 及既有 spec/design 保持一致，不得描述未实现的行为。

#### Scenario: 配置键名保持原文
- **WHEN** 文档引用配置字段
- **THEN** 字段名（如 `polling.interval_ms`）在 `docs/zh/` 与 `docs/en/` 中均保持英文原文，不翻译

#### Scenario: 两语言描述一致
- **WHEN** 对比 `docs/zh/configuration.md` 与 `docs/en/configuration.md`
- **THEN** 两者描述相同的默认值、字段与行为，仅正文语言不同

#### Scenario: 文档与实现一致
- **WHEN** 对比 `docs/en/configuration.md` 描述的默认值与 `src/config/resolver.ts` 中的 `DEFAULTS`
- **THEN** 两者一致

## ADDED Requirements

### Requirement: 双语对等与内链完整性
`docs/zh/` 与 `docs/en/` SHALL 保持文件名一一对应：每个 `docs/zh/<slug>.md` 必有同名 `docs/en/<slug>.md`，反之亦然。`docs/` 下全部 `*.md`、根 `README.md`、`README.zh-CN.md`、`CONTEXT.md` 中的本地相对 markdown 链接（形如 `[text](./path.md)` 或 `[text](../pkg/path.md)`，目标以 `./` 或 `../` 起始或不含协议头的相对路径，排除 `http(s)://`、纯锚点 `#...`、mailto 与裸 URL）SHALL 指向仓库内已存在文件，且在两 locale 树内均解析。该不变式 SHALL 由 `tests/docs-links.test.ts` 守护：该测试 SHALL 扫描上述文件、解析本地相对链接、断言目标存在，并 SHALL 断言 `docs/zh/` 与 `docs/en/` 同 slug 一一对应。测试 SHALL NOT 依赖被测文档的实现细节，仅通过文件系统这一公开 seam 校验可观察行为。

#### Scenario: zh/en 文件名失配则测试红
- **WHEN** `docs/zh/foo.md` 存在但 `docs/en/foo.md` 不存在时运行 `tests/docs-links.test.ts`
- **THEN** 测试失败（红）并报告缺失的对端文件

#### Scenario: 任一 locale 内存在坏链接则测试红
- **WHEN** `docs/zh/` 或 `docs/en/` 任一文件含本地相对链接指向不存在的文件
- **THEN** 测试失败并报告该文件与坏链接

#### Scenario: 双语对等且链接全解析则测试绿
- **WHEN** zh/en 文件名一一对应且全部本地相对链接均指向已存在文件
- **THEN** 测试通过（绿）

### Requirement: 语言切换器
文档站点 SHALL 在每个页面的导航栏提供语言切换器，可在当前页的 `zh` 与 `en` 版本之间跳转，并保持当前路径与锚点。切换器 SHALL 在两语言下均可见且可用。

#### Scenario: 任意页可切换语言
- **WHEN** 访问者在任一页面点击语言切换器
- **THEN** 跳转到同一页面的另一语言版本，路径与锚点保持对应

### Requirement: 默认语言可配
文档站点 SHALL 以单一配置项 `defaultLocale`（`docs/.vitepress/config.ts` 顶部常量，初值 `"zh"`）决定根路径 `/` 默认展示的语言。将该常量值改为另一 locale（如 `"en"`）即切换全局默认语言，SHALL NOT 需要其他结构性改动。首次访问根路径 SHALL 渲染到 `defaultLocale` 对应的内容。

#### Scenario: 默认中文
- **WHEN** `defaultLocale` 为 `"zh"` 且访问者打开站点根路径
- **THEN** 默认展示简体中文内容

#### Scenario: 一行改为默认英文
- **WHEN** 将 `defaultLocale` 改为 `"en"` 并重新部署
- **THEN** 站点根路径默认展示英文，无需其他改动

### Requirement: 文档站点与部署
项目 SHALL 使用 VitePress（npm devDep，仓库内，无外部运行时依赖）构建双语文档站点。`package.json` SHALL 提供 `docs:build`、`docs:dev`、`docs:preview` 脚本，`docs:build` SHALL 产出静态站点到 `docs/.vitepress/dist`。项目 SHALL 在仓库内提供跨平台 Pages 部署：`.gitlab-ci.yml` 的 `pages` job（`npm ci` → `npm run docs:build` → 产物复制到 `public/`）与 `.github/workflows/docs.yml`（GitHub Pages，同一构建命令），两者 SHALL 使用同一 `docs:build` 构建以保证产物一致。`package.json` 的 `files` 字段 SHALL NOT 包含 `docs/` 与 `.vitepress/`（站点不进 npm 包）。

#### Scenario: docs:build 产出静态站点
- **WHEN** 运行 `npm run docs:build`
- **THEN** `docs/.vitepress/dist` 下生成含 zh/en 两语言的静态 HTML 站点

#### Scenario: GitLab Pages 部署
- **WHEN** 在 GitLab 触发 CI
- **THEN** `.gitlab-ci.yml` 的 `pages` job 构建站点并作为 Pages 部署

#### Scenario: GitHub Pages 部署
- **WHEN** 在 GitHub 触发 CI
- **THEN** `.github/workflows/docs.yml` 用同一 `docs:build` 构建并部署到 GitHub Pages

#### Scenario: 站点不进 npm 包
- **WHEN** 检查 `package.json` 的 `files` 字段
- **THEN** 不含 `docs/` 与 `.vitepress/`
