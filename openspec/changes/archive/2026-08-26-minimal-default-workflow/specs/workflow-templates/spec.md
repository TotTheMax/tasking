## ADDED Requirements

### Requirement: 三个 workflow 变体与模板映射

tasking SHALL 支持三个 workflow 变体，各自有唯一的 starter 模板文件，共用同一 config schema，仅 prompt body 不同：`default`（最小，模板 `WORKFLOW.md.example`）、`code-mr`（全-MR，模板 `WORKFLOW.code-mr.md.example`）、`grill-openspec`（模板 `WORKFLOW.grill-openspec.md.example`）。`resolveExampleFile(workflow)` SHALL 按变体返回对应模板路径。`normalizeWorkflow(value)` SHALL 接受 `default`/`code-mr`/`grill-openspec` 三值，未知值 SHALL 视为 invalid。`SUPPORTED_WORKFLOWS` SHALL 列出三者。`default` 变体 SHALL 指最小 workflow（无 git 分支/MR/glab、无 review 暂停、不装技能）；`code-mr` SHALL 指全-MR workflow（建分支→写码→glab 建 MR→review→land 合并，装 `land`+`install-glab`）；`grill-openspec` 不变。

#### Scenario: default 选最小模板
- **WHEN** 调用 `tasking init --workflow default`
- **THEN** 用 `WORKFLOW.md.example` 生成 WORKFLOW.md，其 prompt body 不含 git 分支/MR/glab 步骤

#### Scenario: code-mr 选全-MR 模板
- **WHEN** 调用 `tasking init --workflow code-mr`
- **THEN** 用 `WORKFLOW.code-mr.md.example` 生成 WORKFLOW.md，其 prompt body 含建分支与 glab 建 MR 步骤

#### Scenario: grill-openspec 选 grill 模板
- **WHEN** 调用 `tasking init --workflow grill-openspec`
- **THEN** 用 `WORKFLOW.grill-openspec.md.example` 生成 WORKFLOW.md

#### Scenario: 未知变体报错
- **WHEN** 调用 `tasking init --workflow unknown`
- **THEN** 打印 unknown workflow 错误（列出三个支持值）并退出码 1，不写 WORKFLOW.md

### Requirement: 变体哨兵标记与 detectWorkflow 三路探测

每个非 `default` 变体的 starter 模板 prompt body SHALL 携带可被字符串包含检测的哨兵标记：`grill-openspec` 模板含 `## 🔍 拷问 / Grill Questions`；`code-mr` 模板含 `<!-- tasking-workflow: code-mr -->`。`default`（最小）模板 SHALL NOT 携带任一标记（作为兜底）。`detectWorkflow(body)` SHALL 按优先级探测：body 含 grill 标记 → `grill-openspec`；否则含 `<!-- tasking-workflow: code-mr -->` → `code-mr`；否则 → `default`。探测 SHALL NOT 做遗留启发式（如嗅探 MR/glab 语言）——无标记的 body 一律落 `default`。

#### Scenario: 探测 grill-openspec
- **WHEN** prompt body 含 `## 🔍 拷问 / Grill Questions`
- **THEN** `detectWorkflow` 返回 `grill-openspec`

#### Scenario: 探测 code-mr
- **WHEN** prompt body 含 `<!-- tasking-workflow: code-mr -->` 且不含 grill 标记
- **THEN** `detectWorkflow` 返回 `code-mr`

#### Scenario: 探测 default（无标记兜底）
- **WHEN** prompt body 不含 grill 标记也不含 code-mr 标记
- **THEN** `detectWorkflow` 返回 `default`

#### Scenario: 老全-MR 文件落 default
- **WHEN** 用户 WORKFLOW.md 是改版前的全-MR default（无哨兵标记）且运行 `tasking init --update` 未显式 `--workflow`
- **THEN** 探测为 `default`，漂移报告拿最小模板对比（可显式 `--workflow code-mr` 覆盖）

### Requirement: 按变体的技能集

`skillsForWorkflow(workflow)` SHALL 返回该变体 init 时安装的技能清单：`default` → `[]`（无技能）；`code-mr` → `[land, install-glab]`；`grill-openspec` → `[land, install-glab, opsx-grill-with-docs, opsx-propose-with-tdd, opsx-implement, openspec-archive-change]`。最小 `default` 不装技能 SHALL 因其不创造 MR（无 land/install-glab 之需）。

#### Scenario: default 不装技能
- **WHEN** 调用 `tasking init --workflow default`
- **THEN** `.opencode/skills/` 下不安装任何技能（land/install-glab/opsx 均不存在）

#### Scenario: code-mr 装 land 与 install-glab
- **WHEN** 调用 `tasking init --workflow code-mr`
- **THEN** `.opencode/skills/land/` 与 `.opencode/skills/install-glab/` 被安装，不装 opsx 技能

#### Scenario: grill-openspec 装全部六个
- **WHEN** 调用 `tasking init --workflow grill-openspec`
- **THEN** land、install-glab 及四个 opsx 技能均安装

### Requirement: 最小 default 模板的 prompt body 与 frontmatter

`default` 变体的 starter 模板（`WORKFLOW.md.example`）prompt body SHALL 指导 agent：先查 transitions 转入语义为"in progress"的 active 态（不硬编码状态名）→ 在工作目录完成任务（SHALL NOT 建 git 分支、SHALL NOT 建 MR、SHALL NOT 用 glab）→ 把结果上传 Jira（摘要 comment via `jira_rest` ＋ 附件 via `jira_upload_attachment`）→ 查 transitions 转入语义为终态的 terminal 态。其 frontmatter SHALL 设 `review_state: null`（无 review 桶）、`active_states: [待办, 处理中]`、`terminal_states: [完成, 关闭, 取消, 重复]`，其余 config schema 字段与其它模板一致。模板 SHALL NOT 含 grill 标记或 code-mr 标记。

#### Scenario: 最小 default body 不含 MR 步骤
- **WHEN** 查看 `WORKFLOW.md.example` 的 prompt body
- **THEN** 不含 `glab mr create`、`git` 分支、`land` 技能引用、`review_state` 转入指令

#### Scenario: 最小 default body 指示上传结果到 Jira
- **WHEN** 渲染 `WORKFLOW.md.example` 的 prompt body
- **THEN** 含 `jira_rest`（评论）与 `jira_upload_attachment`（附件）引用

#### Scenario: 最小 default frontmatter 无 review 桶
- **WHEN** 解析 `WORKFLOW.md.example` 的 frontmatter
- **THEN** `review_state` 为 `null`，`active_states` 为 `[待办, 处理中]`，`terminal_states` 为 `[完成, 关闭, 取消, 重复]`

#### Scenario: 最小 default body 渲染不抛错
- **WHEN** 用 `renderPrompt` 渲染 `WORKFLOW.md.example` 的 prompt body（attempt null 与重试均测）
- **THEN** 不抛 TaskingError，含 `{{ task.identifier }}` 渲染值

### Requirement: code-mr 模板保留全-MR 流程

`code-mr` 变体的 starter 模板（`WORKFLOW.code-mr.md.example`）prompt body SHALL 保留原 `default` 的全-MR 流程：转 in-progress active 态 → 从 origin/main 同步建 feature 分支 → 写码 → conventional commit → push 与 `glab mr create` → 扫 MR 反馈保 CI 绿 → 转 review 态 → 重派时增量修复/全量重置/合并三路。其 prompt body SHALL 含 `<!-- tasking-workflow: code-mr -->` 哨兵标记。其 skills SHALL 为 `[land, install-glab]`。

#### Scenario: code-mr body 含全-MR 步骤
- **WHEN** 查看 `WORKFLOW.code-mr.md.example` 的 prompt body
- **THEN** 含 sync origin/main、feature 分支、`glab mr create`、`land` 技能引用、review/增量修复/全量重置/合并三路

#### Scenario: code-mr body 含哨兵标记
- **WHEN** 查看 `WORKFLOW.code-mr.md.example` 的 prompt body
- **THEN** 含 `<!-- tasking-workflow: code-mr -->`

#### Scenario: code-mr body 渲染不抛错
- **WHEN** 用 `renderPrompt` 渲染 `WORKFLOW.code-mr.md.example` 的 prompt body（attempt null 与重试均测）
- **THEN** 不抛 TaskingError，含 `{{ task.identifier }}` 与 `{{ review_state }}` 渲染值
