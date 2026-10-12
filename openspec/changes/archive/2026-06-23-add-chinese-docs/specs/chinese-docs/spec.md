## ADDED Requirements

### Requirement: 文档目录与索引
项目 SHALL 在 `docs/` 目录下提供中文文档集,并 SHALL 包含 `docs/README.md` 作为索引,链接到各分册文档。索引 SHALL 列出每篇文档的标题、用途与适用读者。

#### Scenario: docs 目录存在
- **WHEN** 查看仓库根目录
- **THEN** 存在 `docs/` 目录,且其中包含 `README.md`、`usage.md`、`development.md`、`architecture.md`、`configuration.md`

#### Scenario: 索引链接到各分册
- **WHEN** 打开 `docs/README.md`
- **THEN** 它列出全部文档并附简体中文说明与相对链接

### Requirement: 使用指南
`docs/usage.md` SHALL 用简体中文覆盖安装方式(全局安装与 `npx`)、`tasking init`/`start`/`status`/`logs`/`triage` 五个子命令的用法与退出码、`WORKFLOW.md` 配置概览、Jira 与飞书凭据配置、工作区与 hooks、prompt 模板变量、典型场景示例。命令示例与配置键名 SHALL 保持原文。

#### Scenario: 新用户按指南完成上手闭环
- **WHEN** 新用户阅读 `docs/usage.md` 并照做
- **THEN** 能完成 `tasking init` → 编辑 `WORKFLOW.md` → `tasking start` 的闭环

#### Scenario: 子命令均有退出码说明
- **WHEN** 阅读 `docs/usage.md` 的命令章节
- **THEN** 每个子命令的正常与非零退出条件均有中文说明

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
所有文档 SHALL 以简体中文撰写正文说明;命令、配置键名、代码标识符、文件路径 SHALL 保持原文(英文)。文档内容 SHALL 与 `package.json`、`src/` 源码、`WORKFLOW.md.example` 及 `bootstrap-tasking-runtime` 的 spec/design 保持一致,不得描述未实现的行为。

#### Scenario: 配置键名保持原文
- **WHEN** 文档引用配置字段
- **THEN** 字段名(如 `polling.interval_ms`)保持英文原文,不翻译

#### Scenario: 文档与实现一致
- **WHEN** 对比 `docs/configuration.md` 描述的默认值与 `src/config/resolver.ts` 中的 `DEFAULTS`
- **THEN** 两者一致
