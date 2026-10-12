## ADDED Requirements

### Requirement: 快速上手指南
项目 SHALL 在 `docs/getting-started.md` 提供一篇自包含的简体中文线性上手指南，面向运维者/使用者（用发布版 CLI，非源码开发）。指南 SHALL 按真实上手顺序线性覆盖：安装（`npm install -g tasking` 与 `npx` 免安装）、准备 Jira API token、`tasking init`、最小可跑通的 `WORKFLOW.md`（`tracker` 块含 `endpoint`/`api_key`/`api_user`/`project_key`，`$VAR` 间接引用凭据）、`tasking start`、启动后验证清单。关键命令与配置块 SHALL 内联可复制；深度细节（全字段表、超时模型、状态流转、命令全选项等）SHALL 以相对链接深链到既有分册文档，SHALL NOT 复制分册全量内容。指南 SHALL 包含一节「可选：接飞书 IM」，完整覆盖机器人创建步骤（建自建应用→开机器人能力→授权 scope `im:message.group_msg`/`im:chat:readonly`/`im:message:send_as_bot`→发布版本并审批→建 intake 群拉机器人入群→取 `chat_id`→配 `feishu:` 块→验证清单），并深链到 `docs/feishu-quickstart.md` 的手把手详尽步骤。指南内所有文档间链接 SHALL 指向已存在文件。根 `README.md` 的 Quick start 末尾 SHALL 有一行指向 `docs/getting-started.md`；`docs/README.md` 索引 SHALL 列出 `getting-started.md` 并在快速导航置顶「新用户优先看此篇」。

#### Scenario: 新用户一页跑通 Jira 路径
- **WHEN** 新用户照 `docs/getting-started.md` 主线照做（不接飞书）
- **THEN** 能完成安装→准备 Jira token→`tasking init`→编辑最小 `WORKFLOW.md`→`tasking start`→看到派发，全程无需打开其他分册

#### Scenario: 飞书可选节可独立照做
- **WHEN** 用户完成 Jira 主线后阅读「可选：接飞书 IM」一节并照做
- **THEN** 能完成建应用→授权→拉群→取 `chat_id`→配 `feishu:` 块→在 intake 群验证 `/help` 与 `/issue`，并知道手把手细节在 `docs/feishu-quickstart.md`

#### Scenario: 深度细节不内联复制
- **WHEN** 指南需要全配置字段表或超时模型细节
- **THEN** 以相对链接深链到 `docs/configuration.md`/`docs/timeout-model.md`，SHALL NOT 在指南内复制其全量内容

#### Scenario: 根 README 可发现指南
- **WHEN** 新用户打开仓库根 `README.md`
- **THEN** Quick start 末尾有一行指向 `docs/getting-started.md` 的中文上手指南

### Requirement: 文档内链完整性
`docs/` 目录下全部 `*.md` 以及仓库根 `README.md` 与 `CONTEXT.md` 中的本地相对 markdown 链接（形如 `[text](./path.md)` 或 `[text](../pkg/path.md)`，目标以 `./` 或 `../` 起始或不含协议头的相对路径，排除 `http(s)://`、纯锚点 `#...`、mailto 与裸 URL）SHALL 指向仓库内已存在的文件。该不变式 SHALL 由 `tests/docs-links.test.ts` 守护，该测试 SHALL 扫描上述文件、解析本地相对链接并断言目标存在，且 SHALL 断言 `docs/getting-started.md` 存在。测试 SHALL NOT 依赖被测文档的实现细节，仅通过文件系统这一公开 seam 校验可观察行为。

#### Scenario: 新指南缺失则测试红
- **WHEN** `docs/getting-started.md` 尚不存在时运行 `tests/docs-links.test.ts`
- **THEN** 测试失败（红）

#### Scenario: 链接指向不存在文件则测试红
- **WHEN** 任一被扫描文档含本地相对链接指向不存在的文件
- **THEN** 测试失败并报告该文件与坏链接

#### Scenario: 全部链接解析则测试绿
- **WHEN** 被扫描文档全部本地相对链接均指向已存在文件且 `docs/getting-started.md` 存在
- **THEN** 测试通过（绿）
