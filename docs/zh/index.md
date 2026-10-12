# tasking 文档

本目录提供 `tasking` 项目的简体中文文档集。`tasking` 是一个 TypeScript CLI daemon,从 Jira(结构化)与飞书(非结构化)两个任务源编排 opencode coding-agent 工作。

## 文档索引

| 文档 | 用途 | 适用读者 |
|------|------|----------|
| [快速上手](./getting-started.md) | 一页到底的线性上手：安装→准备→配置→启动→验证（含可选飞书机器人创建） | 新用户 |
| [使用指南](./usage.md) | 安装、命令、配置、凭据、工作区、prompt 模板、典型场景 | 运维者、新用户 |
| [开发编译指南](./development.md) | 环境搭建、目录结构、构建/测试/发布流程、代码风格 | 贡献者、二次开发者 |
| [架构概览](./architecture.md) | 双源双调度、共享 Task 模型、worker 隔离、状态持久化、安全不变式 | 二次开发者、理解者 |
| [配置参考](./configuration.md) | `WORKFLOW.md` 全字段表、解析规则、动态重载、校验 | 运维者、配置者 |
| [飞书接入 quickstart](./feishu-quickstart.md) | 手把手接飞书：建应用→授权→拉群→取 chat_id→配置→验证清单 | 运维者、新用户 |
| [飞书应用开通](./feishu-app-setup.md) | 飞书侧一次性准备：个人版/企业版差异、建应用、scope 清单、事件订阅、发布、WORKFLOW 配置 | 运维者、新用户 |
| [超时模型](./timeout-model.md) | 三层超时（不活跃/墙钟/stall）流程、信号链、retry 行为、场景分析 | 二次开发者、运维者 |
| [状态流转](./state-flow.md) | 三层状态模型（active/review/terminal）、双路径 review 处理、调度器 reconcile 三分支、Mermaid 流程图、grill-openspec 变体四阶段 | 运维者、配置者、二次开发者 |
| [技能系统](./skills.md) | 6 个 opencode 技能（commit/pull/push/debug/land/jira）、land_watch.py、使用方式 | 运维者、配置者 |
| [已知问题](./known-issues.md) | 已知限制（如 grill-openspec 续轮指引偏移）与待做增强（如 `tasking upgrade` 升级流程） | 二次开发者、运维者 |
| [日志](./logging.md) | 结构化 JSON 日志规约：必带上下文字段、消息格式、便于 grep 与告警的确定性措辞 | 二次开发者、运维者 |
| [Token 计费](./token-accounting.md) | 从 `opencode run` 事件流提取 token 用量并累加为运行时总额的规则 | 二次开发者、运维者 |

## 快速导航

- 第一次使用?先看 [快速上手](./getting-started.md),一页到底跑通(安装→准备→配置→启动→验证,含可选飞书)。
- 想看某个命令/配置细节?从 [使用指南](./usage.md) 的「安装」与「快速上手」开始。
- 要接飞书?看 [飞书接入 quickstart](./feishu-quickstart.md);飞书应用/权限怎么开通(含个人版)看 [飞书应用开通](./feishu-app-setup.md)。
- 想本地开发?看 [开发编译指南](./development.md)。
- 想理解整体设计?看 [架构概览](./architecture.md)。
- 查某个配置字段?看 [配置参考](./configuration.md)。
- 想了解超时机制?看 [超时模型](./timeout-model.md)。
- 想了解状态流转?看 [状态流转](./state-flow.md)。
- 想了解技能系统?看 [技能系统](./skills.md)。
- 想了解 grill-openspec 变体的设计取舍?看 [ADR 0001](../adr/0001-phase-routing-in-prompt.md) 与 [项目术语表](../../CONTEXT.md)。

## 术语对照表

为保持术语统一,本文档集采用以下译法:

| 英文 | 中文 | 说明 |
|------|------|------|
| dispatch | 派发 | 将任务交给 worker 执行 |
| reconcile | 对账 | 校对运行中任务与 tracker 当前状态 |
| retry | 重试 | 失败后按退避策略重新派发 |
| claim | 认领 | 调度器为任务加锁,防止重复派发 |
| workspace | 工作区 | per-task 的隔离工作目录 |
| backoff | 退避 | 重试间隔的指数增长策略 |
| route agent | 路由 agent | 分诊非结构化 inbox 条目的 LLM 子进程（**未实现**，规划中） |
| inbox | 收件箱 | 非结构化任务的持久化待分诊队列（**未实现**，规划中） |
| stall | 停滞 | 运行中任务长时间无活动信号 |
| terminal state | 终端状态 | 任务已完成或取消,不再派发 |
| active state | 活跃状态 | 任务待处理或进行中,可被派发 |
