# 新增快速上手指南（getting-started）

## Why

现有中文文档很全但分散在 8+ 个文件（`usage.md`/`feishu-quickstart.md`/`configuration.md`/…），`docs/README.md` 只是分册索引，根 `README.md`（英文）的 Quick start 仅 4 行命令、无凭据与飞书细节。新用户没有一条「零到跑通」的线性路径，需在多个文档间跳转拼凑才能首次上手。需要一篇自包含的线性上手指南，让新用户一页到底完成安装→准备→配置→启动→验证（含可选飞书机器人创建），深度细节链到既有分册文档。

## What Changes

- 新增 `docs/getting-started.md`：一篇自包含的简体中文线性上手指南，覆盖安装（`npm i -g tasking` / `npx`）→准备 Jira API token→`tasking init`→最小 `WORKFLOW.md`→`tasking start`→验证清单；外加「可选：接飞书 IM」一节，完整走机器人创建（建应用→开机器人→授权 scope→发布审批→拉群→取 `chat_id`→配 `feishu:` 块→验证清单），关键步骤内联可复制，深度细节深链到 `usage.md`/`configuration.md`/`feishu-quickstart.md`。
- 根 `README.md` 的 Quick start 末尾新增一行，指向新中文 `docs/getting-started.md`（提升可发现性，不改现有英文内容）。
- 新增 `tests/docs-links.test.ts`：扫描 `docs/**/*.md` 与根 `README.md`/`CONTEXT.md` 的本地 markdown 链接（`[text](./path)` / `[](../path)`，排除 `http`/锚点），断言目标文件存在；并断言 `docs/getting-started.md` 存在。作为文档内链完整性的回归守护。
- `docs/README.md` 文档索引新增一行指向 `getting-started.md`，并标注「新用户优先看此篇」。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `chinese-docs`：新增「快速上手指南」要求（`docs/getting-started.md` 的线性内容覆盖与可选飞书节）；新增「文档内链完整性」要求（本地 markdown 链接须指向已存在文件，并由测试守护）。

## Impact

- 新增文件：`docs/getting-started.md`、`tests/docs-links.test.ts`。
- 修改文件：`README.md`（Quick start 末尾加一行指向）、`docs/README.md`（索引加一行）。
- 无运行时代码、API、依赖、配置项、数据模型变更；纯文档 + 一个文档质量测试。
