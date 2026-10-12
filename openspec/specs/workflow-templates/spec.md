## Purpose

三个 workflow 变体（`default` 最小、`code-mr` 全-MR、`grill-openspec`）的定义：各自的 starter 模板文件与变体→模板映射、prompt body 哨兵标记、按变体的技能集，以及 `detectWorkflow` 的三路标记探测。
## Requirements
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

### Requirement: feishu-direct 模板的配置面与 prompt body

feishu-direct 模板 SHALL 满足：① tracker 块 `kind: none` 生效并**保留全量 Jira 字段注释**（与 default 模板同构），头部注释注明"如需启用 Jira 源：改 `kind: jira` 并填写以下字段"——用户看不到源码，WORKFLOW.md 是唯一配置参考；② feishu 块 `enabled: true`，app_id/app_secret/intake_chat_id 以 `$VAR` 引用，direct 段完整文档化（projects 两形态示例、path_roots、auto_approve、verbosity、max_concurrent、idle_ttl_ms）；③ prompt body 沿用 default 最小正文 + 顶部注释说明"直连会话以用户消息为 prompt，此 body 在启用 Jira 源后生效"；④ 与其余模板一致满足 agents catalog（`opencode.agents: []` + 注释）与 `DEFAULTS.feishu` 键覆盖守卫。

#### Scenario: 模板可解析且配置自洽
- **WHEN** 解析 feishu-direct 模板 front matter
- **THEN** `tracker.kind` 为 `none`、`feishu.enabled` 为 true、`feishu.direct` 空配置解析合法（与 en-templates 守卫同口径）

#### Scenario: 切换 Jira 源的路径自明
- **WHEN** 用户阅读模板 tracker 块
- **THEN** 注释给出启用方法（改 kind 并填字段），字段说明齐全，无需查阅源码

### Requirement: 模板中的死配置注释化

模板 SHALL 将无运行时消费方的配置以注释形式保留并标注原因，成为 canonical 参照的一部分：`router` 段整段注释并标注「未实现：当前仅解析，无运行时代码」；`feishu.verification_token` / `feishu.encrypt_key` 注释并标注「webhook 模式预留」。模板其余段落 SHALL 保持 active（模板仍是可直接复制的全量参照与漂移/语言对齐测试的基准）。

#### Scenario: router 段在模板中为注释
- **WHEN** 解析任一 starter 模板
- **THEN** `router` 键不出现在解析结果中（整段为注释），且注释内含「未实现」标注

#### Scenario: 模板其余段仍可解析
- **WHEN** 解析任一 starter 模板的 frontmatter
- **THEN** `tracker`/`polling`/`workspace`/`hooks`/`agent`/`opencode`/`feishu`/`server`/`logging`/`env` 仍为可解析的活配置（除 `feishu.verification_token`/`encrypt_key` 两行为注释）

#### Scenario: 模板语言对齐不受影响
- **WHEN** 运行 en-templates 的语言对齐测试
- **THEN** zh/en 模板仍通过 YAML 键集合与 Liquid 表达式对齐断言

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

