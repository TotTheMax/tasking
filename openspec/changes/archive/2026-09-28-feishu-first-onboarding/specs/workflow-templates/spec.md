# workflow-templates

## MODIFIED Requirements

### Requirement: 三个 workflow 变体与模板映射

tasking SHALL 支持四个 workflow 变体，各自有唯一的 starter 模板文件，共用同一 config schema：`minimal`（最小，模板 `WORKFLOW.minimal.md.example`）、`code-mr`（全-MR，模板 `WORKFLOW.code-mr.md.example`）、`grill-openspec`（模板 `WORKFLOW.grill-openspec.md.example`）、`feishu-direct`（飞书直连专用，模板 `WORKFLOW.feishu-direct.md.example`）。`resolveExampleFile(workflow)` SHALL 按变体返回对应模板路径（含 zh/en 两语言）。`normalizeWorkflow(value)` SHALL 接受 `minimal`/`code-mr`/`grill-openspec`/`feishu-direct` 四值，未知值 SHALL 视为 invalid。`SUPPORTED_WORKFLOWS` SHALL 列出四者。`minimal` SHALL 指最小 workflow（无 git 分支/MR/glab、无 review 暂停、不装技能）；`code-mr` SHALL 指全-MR workflow（建分支→写码→glab 建 MR→review→land 合并，装 `land`+`install-glab`）；`grill-openspec` 不变；`feishu-direct` 为 init 的默认变体（见 `feishu-first-onboarding`）。`minimal` 为原 `default` 变体更名，SHALL NOT 保留 `default` 取值别名。

#### Scenario: minimal 选最小模板
- **WHEN** 调用 `tasking init --workflow minimal`
- **THEN** 用 `WORKFLOW.minimal.md.example` 生成 WORKFLOW.md，其 prompt body 不含 git 分支/MR/glab 步骤

#### Scenario: code-mr 选全-MR 模板
- **WHEN** 调用 `tasking init --workflow code-mr`
- **THEN** 用 `WORKFLOW.code-mr.md.example` 生成 WORKFLOW.md，其 prompt body 含建分支与 glab 建 MR 步骤

#### Scenario: grill-openspec 选 grill 模板
- **WHEN** 调用 `tasking init --workflow grill-openspec`
- **THEN** 用 `WORKFLOW.grill-openspec.md.example` 生成 WORKFLOW.md

#### Scenario: feishu-direct 选直连模板
- **WHEN** 调用 `tasking init --workflow feishu-direct`
- **THEN** 用 `WORKFLOW.feishu-direct.md.example` 生成 WORKFLOW.md（`tracker.kind: none`、`feishu.enabled: true`）

#### Scenario: 旧名 default 不再有效
- **WHEN** 调用 `tasking init --workflow default`
- **THEN** 打印 unknown workflow 错误（列出四个支持值）并退出码 1，不写 WORKFLOW.md

#### Scenario: 未知变体报错
- **WHEN** 调用 `tasking init --workflow unknown`
- **THEN** 打印 unknown workflow 错误（列出四个支持值）并退出码 1，不写 WORKFLOW.md

### Requirement: 变体哨兵标记与 detectWorkflow 三路探测

每个非 `minimal` 变体的 starter 模板 prompt body SHALL 携带可被字符串包含检测的哨兵标记：`grill-openspec` 模板含 `## 🔍 拷问 / Grill Questions`；`code-mr` 模板含 `<!-- tasking-workflow: code-mr -->`；`feishu-direct` 模板含 `<!-- tasking-workflow: feishu-direct -->`。`minimal` 模板 SHALL NOT 携带任一标记（作为兜底）。`detectWorkflow(body)` SHALL 按优先级探测：body 含 feishu-direct 标记 → `feishu-direct`；否则含 grill 标记 → `grill-openspec`；否则含 code-mr 标记 → `code-mr`；否则 → `minimal`。探测 SHALL NOT 做遗留启发式——无标记的 body 一律落 `minimal`。

#### Scenario: 探测 feishu-direct
- **WHEN** prompt body 含 `<!-- tasking-workflow: feishu-direct -->`
- **THEN** `detectWorkflow` 返回 `feishu-direct`（即使 body 其余部分与 minimal 同形）

#### Scenario: 探测 grill-openspec
- **WHEN** prompt body 含 `## 🔍 拷问 / Grill Questions`
- **THEN** `detectWorkflow` 返回 `grill-openspec`

#### Scenario: 探测 code-mr
- **WHEN** prompt body 含 `<!-- tasking-workflow: code-mr -->` 且无 feishu-direct / grill 标记
- **THEN** `detectWorkflow` 返回 `code-mr`

#### Scenario: 无标记兜底 minimal
- **WHEN** prompt body 不含任何标记
- **THEN** `detectWorkflow` 返回 `minimal`

### Requirement: 按变体的技能集

`skillsForWorkflow(workflow)` SHALL 返回该变体 init 时安装的技能清单：`minimal` → `[]`（无技能）；`code-mr` → `[land, install-glab]`；`grill-openspec` → `[land, install-glab, opsx-grill-with-docs, opsx-propose-with-tdd, opsx-implement, openspec-archive-change]`；`feishu-direct` → `[]`。最小 `minimal` 不装技能 SHALL 因其不创造 MR（无 land/install-glab 之需）。

#### Scenario: minimal 不装技能
- **WHEN** 调用 `tasking init --workflow minimal`
- **THEN** `.opencode/skills/` 下不安装任何技能（land/install-glab/opsx 均不存在）

#### Scenario: code-mr 装 land 与 install-glab
- **WHEN** 调用 `tasking init --workflow code-mr`
- **THEN** `.opencode/skills/land/` 与 `.opencode/skills/install-glab/` 被安装，不装 opsx 技能

#### Scenario: grill-openspec 装全部六个
- **WHEN** 调用 `tasking init --workflow grill-openspec`
- **THEN** land、install-glab 及四个 opsx 技能均安装

### Requirement: 最小 minimal 模板的 prompt body 与 frontmatter

`minimal` 变体的 starter 模板（`WORKFLOW.minimal.md.example`）prompt body SHALL 指导 agent：先查 transitions 转入语义为"in progress"的 active 态（不硬编码状态名）→ 在工作目录完成任务（SHALL NOT 建 git 分支、SHALL NOT 建 MR、SHALL NOT 用 glab）→ 把结果上传 Jira（摘要 comment via `jira_rest` ＋ 附件 via `jira_upload_attachment`）→ 查 transitions 转入语义为终态的 terminal 态。其 frontmatter SHALL 设 `review_state: null`（无 review 桶）、`active_states: [待办, 处理中]`、`terminal_states: [完成, 关闭, 取消, 重复]`，其余 config schema 字段与其它模板一致。模板 SHALL NOT 含 grill、code-mr 或 feishu-direct 标记。

#### Scenario: 最小 minimal body 不含 MR 步骤
- **WHEN** 查看 `WORKFLOW.minimal.md.example` 的 prompt body
- **THEN** 不含 `glab mr create`、`git` 分支、`land` 技能引用、`review_state` 转入指令

#### Scenario: 最小 minimal body 指示上传结果到 Jira
- **WHEN** 渲染 `WORKFLOW.minimal.md.example` 的 prompt body
- **THEN** 含 `jira_rest`（评论）与 `jira_upload_attachment`（附件）引用

#### Scenario: 最小 minimal frontmatter 无 review 桶
- **WHEN** 解析 `WORKFLOW.minimal.md.example` 的 frontmatter
- **THEN** `review_state` 为 `null`，`active_states` 为 `[待办, 处理中]`，`terminal_states` 为 `[完成, 关闭, 取消, 重复]`

#### Scenario: 最小 minimal body 渲染不抛错
- **WHEN** 用 `renderPrompt` 渲染 `WORKFLOW.minimal.md.example` 的 prompt body（attempt null 与重试均测）
- **THEN** 不抛 TaskingError，含 `{{ task.identifier }}` 渲染值

## RENAMED Requirements

- FROM: `### Requirement: 最小 default 模板的 prompt body 与 frontmatter`
- TO: `### Requirement: 最小 minimal 模板的 prompt body 与 frontmatter`

## ADDED Requirements

### Requirement: feishu-direct 模板的说明性 prompt body

`feishu-direct` 变体的 starter 模板 prompt body SHALL 仅为变体哨兵与语言哨兵加至多两行面向用户的说明注释（直连会话不使用 prompt body——用户消息即任务指令；想接 Jira 重跑 `tasking init` 选「接 Jira」）。body SHALL NOT 含 Liquid 表达式、Jira workflow 指令或 ADR/开发者内部引用。说明 SHALL 用用户可读语言（zh/en 模板各用其语言）。

#### Scenario: zh 模板 body 为说明性两行
- **WHEN** 查看 `WORKFLOW.feishu-direct.md.example` 的 prompt body
- **THEN** 首行为 `<!-- tasking-workflow: feishu-direct -->` 哨兵，其后为不含 Liquid 表达式与 ADR 引用的用户语言说明

#### Scenario: en 模板 body 对齐
- **WHEN** 查看 `WORKFLOW.feishu-direct.en.md.example` 的 prompt body
- **THEN** 首行为语言哨兵，说明为英文，Liquid 表达式集合与 zh 版一致（均为空）

#### Scenario: 说明性 body 可被漂移机器处理
- **WHEN** 用 `--update` 对 feishu-direct WORKFLOW.md 做漂移报告
- **THEN** 变体被正确探测为 `feishu-direct`，body diff 正常输出
