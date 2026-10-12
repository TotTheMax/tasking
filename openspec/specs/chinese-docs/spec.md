## Purpose

中文文档目录的创建与维护规范。
## Requirements
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

### Requirement: 使用指南
`docs/usage.md` SHALL 用简体中文覆盖安装方式(全局安装与 `npx`)、`tasking init`/`start`/`status`/`logs`/`triage` 五个子命令的用法与退出码、`WORKFLOW.md` 配置概览、Jira 与飞书凭据配置、工作区与 hooks、prompt 模板变量、典型场景示例。命令示例与配置键名 SHALL 保持原文。

#### Scenario: 新用户按指南完成上手闭环
- **WHEN** 新用户阅读 `docs/usage.md` 并照做
- **THEN** 能完成 `tasking init` → 编辑 `WORKFLOW.md` → `tasking start` 的闭环

#### Scenario: 子命令均有退出码说明
- **WHEN** 阅读 `docs/usage.md` 的命令章节
- **THEN** 每个子命令的正常与非零退出条件均有中文说明

### Requirement: 快速上手指南
项目 SHALL 在 `docs/zh/getting-started.md` 提供一篇自包含的简体中文线性上手指南，面向运维者/使用者（用发布版 CLI，非源码开发）。指南 SHALL 按真实上手顺序线性覆盖：安装（`npm install -g tasking` 与 `npx` 免安装）、准备 Jira API token、`tasking init`、最小可跑通的 `WORKFLOW.md`（`tracker` 块含 `endpoint`/`api_key`/`api_user`/`project_key`，`$VAR` 间接引用凭据）、`tasking start`、启动后验证清单。关键命令与配置块 SHALL 内联可复制；深度细节（全字段表、超时模型、状态流转、命令全选项等）SHALL 以相对链接深链到既有分册文档，SHALL NOT 复制分册全量内容。指南 SHALL 包含一节「可选：接飞书 IM」，完整覆盖机器人创建步骤（建自建应用→开机器人能力→授权 scope `im:message.group_msg`/`im:chat:readonly`/`im:message:send_as_bot`→发布版本并审批→建 intake 群拉机器人入群→取 `chat_id`→配 `feishu:` 块→验证清单），并深链到 `docs/zh/feishu-quickstart.md` 的手把手详尽步骤。指南内所有文档间链接 SHALL 指向已存在文件。根 `README.md` 的 Quick start 末尾 SHALL 有指向 `docs/zh/getting-started.md` 的链接；各 locale 文档索引（`docs/zh/index.md`、`docs/en/index.md`）SHALL 列出 `getting-started.md` 并在新用户快速导航置顶。

#### Scenario: 新用户一页跑通 Jira 路径
- **WHEN** 新用户照 `docs/zh/getting-started.md` 主线照做（不接飞书）
- **THEN** 能完成安装→准备 Jira token→`tasking init`→编辑最小 `WORKFLOW.md`→`tasking start`→看到派发，全程无需打开其他分册

#### Scenario: 飞书可选节可独立照做
- **WHEN** 用户完成 Jira 主线后阅读「可选：接飞书 IM」一节并照做
- **THEN** 能完成建应用→授权→拉群→取 `chat_id`→配 `feishu:` 块→在 intake 群验证 `/help` 与 `/issue`，并知道手把手细节在 `docs/zh/feishu-quickstart.md`

#### Scenario: 深度细节不内联复制
- **WHEN** 指南需要全配置字段表或超时模型细节
- **THEN** 以相对链接深链到 `docs/zh/configuration.md`/`docs/zh/timeout-model.md`，SHALL NOT 在指南内复制其全量内容

#### Scenario: 根 README 可发现指南
- **WHEN** 新用户打开仓库根 `README.md`
- **THEN** Quick start 末尾有一行指向 `docs/zh/getting-started.md` 的中文上手指南

### Requirement: 开发编译指南
`docs/development.md` SHALL 用简体中文覆盖 Node 版本要求、依赖安装、`src/` 目录结构说明、`build`/`typecheck`/`lint`/`lint:fix`/`test`/`test:watch`/`dev` 命令、开发运行方式、发布流程(`npm publish`、`prepublishOnly` 钩子、`files` 字段)、代码风格约定(biome、双引号、分号、尾逗号、ESM/NodeNext)。

#### Scenario: 贡献者按指南搭建环境
- **WHEN** 新贡献者阅读 `docs/development.md` 并执行其中命令
- **THEN** 能完成依赖安装、构建、运行测试,并理解如何用 `npm run dev -- start` 开发运行

#### Scenario: 发布流程可执行
- **WHEN** 阅读 `docs/development.md` 的发布章节
- **THEN** 明确 `npm publish` 会触发 `prepublishOnly` 构建且仅发布 `dist` 与 `README.md`

### Requirement: 架构概览
`docs/architecture.md` SHALL 用简体中文解释双源双调度模型(结构化 Jira 确定性调度、非结构化飞书 route agent)、共享 `Task` 模型、`opencode run` worker 子进程隔离、SQLite inbox 持久化与内存调度状态、重启恢复策略、三条安全不变式(cwd==工作区、工作区位于 root 内、key 已清洗)。

#### Scenario: 二次开发者理解架构
- **WHEN** 二次开发者阅读 `docs/architecture.md`
- **THEN** 能理解两个任务源如何汇聚到共享 worker 路径,以及调度状态为何不跨重启而 inbox 跨重启

### Requirement: 配置参考
`docs/configuration.md` SHALL 用简体中文,以字段表形式逐块说明 `WORKFLOW.md` 的 `tracker`/`polling`/`workspace`/`hooks`/`agent`/`opencode`/`router`/`feishu`/`server` 配置块,每字段列出键名、类型、默认值、是否必需、中文说明。SHALL 说明 `$VAR` 间接引用、`~` 展开、相对 `workspace.root` 解析规则、动态重载语义与校验规则。

#### Scenario: 运维者查阅字段
- **WHEN** 运维者打开 `docs/configuration.md`
- **THEN** 能找到每个配置块的表格,含字段类型、默认值与中文说明

#### Scenario: 环境变量间接引用规则可查
- **WHEN** 运维者查阅 `$VAR` 解析规则
- **THEN** `docs/configuration.md` 明确说明 `$VAR_NAME` 仅对显式包含该形式的值生效、空值视为缺失、环境变量不全局覆盖 YAML

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

### Requirement: 双语对等与内链完整性
`docs/zh/` 与 `docs/en/` SHALL 保持文件名一一对应：每个 `docs/zh/<slug>.md` 必有同名 `docs/en/<slug>.md`，反之亦然。`docs/` 下全部 `*.md`、根 `README.md`、`README.zh-CN.md`、`CONTEXT.md` 中的本地相对 markdown 链接（形如 `[text](./path.md)` 或 `[text](../pkg/path.md)`，目标以 `./` 或 `../` 起始或不含协议头的相对路径，排除 `http(s)://`、纯锚点 `#...`、mailto 与裸 URL）SHALL 指向仓库内已存在文件，且在两 locale 树内均解析。该不变式 SHALL 由 `tests/docs-links.test.ts` 守护：该测试 SHALL 扫描上述文件、解析本地相对链接、断言目标存在，并 SHALL 断言 `docs/zh/` 与 `docs/en/` 同 slug 一一对应、`docs/zh/getting-started.md` 存在。测试 SHALL NOT 依赖被测文档的实现细节，仅通过文件系统这一公开 seam 校验可观察行为。

#### Scenario: zh/en 文件名失配则测试红
- **WHEN** `docs/zh/foo.md` 存在但 `docs/en/foo.md` 不存在时运行 `tests/docs-links.test.ts`
- **THEN** 测试失败（红）并报告缺失的对端文件

#### Scenario: 快速上手指南缺失则测试红
- **WHEN** `docs/zh/getting-started.md` 不存在时运行 `tests/docs-links.test.ts`
- **THEN** 测试失败（红）

#### Scenario: 任一 locale 内存在坏链接则测试红
- **WHEN** `docs/zh/` 或 `docs/en/` 任一文件含本地相对链接指向不存在的文件
- **THEN** 测试失败并报告该文件与坏链接

#### Scenario: 双语对等且链接全解析则测试绿
- **WHEN** zh/en 文件名一一对应、全部本地相对链接均指向已存在文件且 `docs/zh/getting-started.md` 存在
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

