## Context

`tasking` 核心实现已在 `bootstrap-tasking-runtime` 变更中完成:一个 TypeScript CLI daemon,从 Jira(结构化)与飞书(非结构化)两个任务源编排 opencode coding-agent。源码位于 `src/`,镜像能力划分;`README.md` 为英文且仅覆盖快速上手;`WORKFLOW.md.example` 给出了配置样例但无逐字段说明。

现状:无 `docs/` 目录,无系统性中文文档。新用户需阅读源码才能理解配置语义、命令行为与开发流程;贡献者缺少架构与编译指南。

干系人:中文工程团队、希望快速试用 `npx tasking` 的运维者、以及需要扩展适配器或 plugin 的二次开发者。

约束:文档语言为简体中文;代码示例、命令、配置键名保持原文(英文);文档不纳入 npm 发布产物;不修改任何源码与运行时行为。

## Goals / Non-Goals

**Goals:**
- 在 `docs/` 下建立结构清晰的中文文档集,覆盖:使用指南、开发编译指南、架构概览、配置参考、文档索引。
- 使用指南让新用户在 10 分钟内完成 `tasking init` → 配置 → `tasking start` 上手闭环。
- 开发编译指南让贡献者能独立完成环境搭建、构建、测试、发布。
- 配置参考对 `WORKFLOW.md` 每个配置块逐字段给出类型、默认值、`$VAR`/`~`/相对路径解析规则。
- 架构概览解释双源双调度、共享 Task 模型、worker 隔离、inbox 持久化、重启恢复、安全不变式。

**Non-Goals:**
- 不做文档站点生成(如 VitePress/Docusaurus);本次仅交付 Markdown 文件。
- 不做 i18n 多语言框架;本次只产出中文。
- 不修改源码、配置 schema、运行时行为。
- 不把 `docs/` 纳入 npm 包发布产物。
- 不在 CI 中强制 Markdown 链接检查(可作为后续增量)。

## Decisions

### 决策 1:文档以纯 Markdown 组织,不引入站点生成器
**选择:** `docs/` 下直接放 `.md` 文件,提供 `docs/README.md` 作为索引。

**理由:** 项目体量小,Markdown 在 GitHub/编辑器中可直接渲染,无需构建步骤;引入站点生成器会增加依赖与维护成本,超出本次范围。

**备选:** VitePress/Docusaurus 站点——视觉更好,但需额外依赖与配置,暂缓。

### 决策 2:按受众分册而非单一大文件
**选择:** 拆分为 `usage.md`(用户)、`development.md`(贡献者)、`architecture.md`(理解者)、`configuration.md`(配置查阅)、`README.md`(索引)。

**理由:** 不同读者关心点不同:运维者只需 usage,贡献者需要 development,二次开发者需要 architecture + configuration。分册避免单文件过长、便于按需阅读。

**备选:** 单一 `docs/GUIDE.md`——简单但难导航,已排除。

### 决策 3:文档内容以现有源码与 `bootstrap-tasking-runtime` 的 spec/design 为事实来源
**选择:** 文档描述的命令、配置字段、默认值、架构行为,全部从 `package.json`、`src/`、`WORKFLOW.md.example`、`bootstrap-tasking-runtime` 的 spec/design 中抽取,确保与实现一致。

**理由:** 文档必须反映真实行为而非凭空撰写;以源码与 spec 为单一事实来源可避免文档漂移。

**备选:** 独立撰写——易与实现脱节,已排除。

### 决策 4:配置参考以字段表形式呈现,逐块说明
**选择:** `configuration.md` 对 `tracker`/`polling`/`workspace`/`hooks`/`agent`/`opencode`/`router`/`feishu`/`server` 每块用表格列出字段、类型、默认值、是否必需、说明。

**理由:** 字段表是最易查阅的格式,运维者可快速定位;与 `WORKFLOW.md.example` 对照阅读。

### 决策 5:`docs/` 不纳入 npm 发布
**选择:** `package.json` 的 `files` 字段保持 `["dist", "README.md"]`,文档仅存在于仓库,不进入发布包。

**理由:** 文档面向仓库读者与本地开发,npm 包消费者通过 `README.md` 已足够;减小发布体积。

## Risks / Trade-offs

- **[风险] 文档与实现漂移** → 后续代码变更若未同步更新文档,文档会过时。**缓解:** 在 `AGENTS.md` 中补充"修改配置 schema 或命令行为时,必须同步更新 `docs/configuration.md` 与 `docs/usage.md`";文档内容以 spec 为事实来源,便于交叉核对。
- **[风险] 中文术语不统一** → 如 "dispatch"(派发/调度)、"reconcile"(对账/调和)等术语可能出现多种译法。**缓解:** 在 `docs/README.md` 末尾附术语表,统一译法;后续文档遵循该表。
- **[权衡] 仅中文、无英文版** → 国际用户无法直接使用。接受:目标受众为中文团队;`README.md` 已有英文快速上手,可作为国际用户的入口。
- **[权衡] 无文档站点** → 长文档在 GitHub 上阅读尚可,但搜索与导航体验弱于站点。接受:体量未到需要站点的程度。
