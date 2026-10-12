# 新增快速上手指南（getting-started）

## Context

`docs/` 已有 8+ 篇中文分册文档（`usage.md`/`feishu-quickstart.md`/`configuration.md`/`architecture.md`/…），`docs/README.md` 是分册索引，根 `README.md`（英文）的 Quick start 仅 4 行命令、无凭据与飞书细节。新用户需在多个文档间跳转拼凑才能首次上手，缺一条「零到跑通」的线性路径。`chinese-docs` spec 已对每篇分册文档提出要求，但无「单页线性上手」要求。

拷问结论（TAS-13 Jira 评论 11721/11722）：
- Q1 = A：新建 `docs/getting-started.md`，自包含线性指南，深度细节深链到既有分册；不重排 `docs/README.md`。
- Q2 = A：Jira 为核心主流程，飞书作「可选：接飞书 IM」独立一节，仍完整走机器人创建步骤（不只是一句「见此链接」）。
- Q3 = 加：根 `README.md` Quick start 末尾加一行指向新中文 `docs/getting-started.md`。

## Goals / Non-Goals

Goals：
- 新用户照 `docs/getting-started.md` 一页到底完成安装→准备→配置→启动→验证闭环（Jira 路径）。
- 飞书为可选节，但建机器人步骤完整可照做。
- 关键命令/配置内联可复制；深度细节深链既有分册，避免重复维护。
- 根 `README.md` 与 `docs/README.md` 均可发现新指南。
- 文档内链完整性有测试守护，防止链接指向不存在/被改名的文件。

Non-Goals：
- 不重写或合并既有分册文档（`usage.md`/`configuration.md`/`feishu-quickstart.md` 等保持原职责）。
- 不翻译根 `README.md` 为中文（仅加一行指向）。
- 不覆盖源码开发路径（属 `docs/development.md`，本指南面向运维者/使用者）。
- 不校验外链（`http(s)`）可达性；仅校验本地相对链接。

## Decisions

### D1：新建单页 `docs/getting-started.md`，而非重排索引
新建一篇自包含线性指南，关键步骤内联、深度细节深链。文件名用 `getting-started.md` 而非 `quickstart.md`，以避开已有 `feishu-quickstart.md` 的命名撞车——后者降为被本指南「可选：接飞书」节深链的详尽分册。
- 备选：把 `docs/README.md` 重排成引导式分步索引（B 方案）——仍是跳转，新用户需开多标签页。
- 理由：单页到底体验最顺；既有分册职责不变、维护面最小。

### D2：Jira 为核心主流程，飞书为可选节（内容仍走全）
指南主线 = 安装→Jira token→`init`→最小 `WORKFLOW.md`→`start`→验证；飞书作「可选：接飞书 IM」独立一节，完整走机器人创建（建应用→开机器人→scope→发布审批→拉群→取 `chat_id`→配 `feishu:` 块→验证清单），精简版内联 + 深链 `feishu-quickstart.md`。
- 备选：Jira+飞书双源作为单一线性主流程（飞书必经）——但飞书是 opt-in，强制必经不贴合真实上手顺序。
- 理由：Jira 无论如何要先通；飞书按需，但任务明确要求覆盖「建飞书机器人」，故可选节里把建机器人步骤走全。

### D3：自包含 + 深链，DRY 不重复全量分册内容
指南内联「跑通所必需」的最小命令/配置（安装、`init`、最小 `tracker` 块、`start`、验证；飞书的 scope 表与 `feishu:` 块），其余（全字段表、超时模型、状态流转、命令全选项、发布流程等）深链到对应分册。新用户无需开 8 个标签页即可跑通；需要细节时一键跳转。
- 备选：完全自包含（复制分册全量内容）——重复维护，易漂移。
- 理由：跑通所需信息内联，深度信息单点维护于分册。

### D4：文档内链完整性由测试守护（TDD 锚点）
新增 `tests/docs-links.test.ts`：扫描 `docs/**/*.md` 与根 `README.md`/`CONTEXT.md` 的本地相对 markdown 链接（`[text](./x.md)` / `[](../y.md)`，排除 `http(s)`、纯锚点 `#x`、裸邮箱/URL），断言目标文件存在；并断言 `docs/getting-started.md` 存在。这是文档质量的行为级测试（seam = 文件系统 + markdown 解析），非实现细节耦合、非同义反复，可跨重构存活。先写测试见红（`getting-started.md` 不存在），再写文档见绿。
- 备选：无测试、靠人眼——内链最易在改名/移动时悄悄失效。
- 理由：零成本防住文档头号 bug（链接指向不存在文件），且为本变更提供真实 red→green 循环。

### D5：根 `README.md` 仅加一行指向，不改英文内容
Quick start 末尾追加一行 `For a guided end-to-end quickstart (Chinese), see docs/getting-started.md`。可发现性提升，且不破坏根 README 现有英文结构与内容。

### D6：`docs/README.md` 索引加一行，并置顶「新用户优先看此篇」
索引新增 `getting-started.md` 一行，并在「快速导航」首条改为指向本篇（原首条指向 `usage.md` 的「安装」节降为次条）。

## Risks / Trade-offs

- [指南与分册内容漂移] → 指南只内联跑通必需最小集，深度信息单点维护于分册；分册改字段名时指南若引用了该字段需同步。D4 的内链测试能捕获「链接目标文件消失」，但捕获不了「字段值漂移」——以 AGENTS.md「改 config schema/命令行为须同步文档」约定兜底。
- [飞书可选节与 `feishu-quickstart.md` 部分重叠] → 有意为之（Q2 要求建机器人步骤在指南内走全）；重叠的是步骤骨架，详尽手把手仍只在分册，深链衔接。
- [内链测试扫描全量 docs，若既有文档已有断链] → 视为文档卫生修复，纳入本变更范围（属「整理文档」职责）。

## Migration Plan

无迁移：纯文档 + 测试增量。回滚 = 回退本 MR。

## Open Questions

无（拷问已闭环）。
