## Why

`tasking` 项目目前缺少系统性的中文文档。`README.md` 仅给出英文快速上手,新用户与贡献者无法快速理解项目架构、配置语义、命令用法与开发编译流程。随着核心实现已完成(bootstrap-tasking-runtime),现在需要一套完整的中文文档来降低上手门槛、支撑团队协作分发。

## What Changes

- **新增 `docs/` 目录**,承载全部中文 Markdown 文档。
- **新增使用指南** (`docs/usage.md`):覆盖安装、`tasking init/start/status/logs/triage` 命令详解、`WORKFLOW.md` 全配置块字段表、飞书与 Jira 凭据配置、工作区与 hooks、prompt 模板语法、典型场景示例。
- **新增项目开发编译指南** (`docs/development.md`):覆盖环境要求、依赖安装、目录结构说明、构建/类型检查/lint/测试命令、开发运行、发布流程、代码风格与约定。
- **新增架构概览** (`docs/architecture.md`):双源双调度模型、共享 Task 模型、worker 子进程隔离、inbox 持久化、重启恢复、安全不变式。
- **新增文档索引** (`docs/README.md`):docs 目录导航,链接到各分册。
- **新增配置参考** (`docs/configuration.md`):`WORKFLOW.md` front matter 全字段、默认值、`$VAR`/`~`/相对路径解析规则、动态重载语义、校验规则。
- 文档语言为简体中文;代码示例与命令保持原文。

## Capabilities

### New Capabilities
- `chinese-docs`: 在 `docs/` 目录下提供中文文档集,包含使用指南、开发编译指南、架构概览、配置参考与文档索引。

### Modified Capabilities
<!-- 无 spec 级行为变更;本次仅新增文档,不改任何代码与运行时行为。 -->

## Impact

- **新增文件**:`docs/README.md`、`docs/usage.md`、`docs/development.md`、`docs/architecture.md`、`docs/configuration.md`。
- **无代码变更**:不修改 `src/` 下任何源码,不改变运行时行为。
- **无依赖变更**:不新增 npm 依赖。
- **CI 影响**:文档为纯 Markdown,不参与 lint/typecheck/test;可选地在 CI 中加入 Markdown 链接检查(本次不强制)。
- **包发布影响**:`docs/` 不纳入 npm 包(`package.json` 的 `files` 字段仅含 `dist` 与 `README.md`),不影响发布产物体积。
