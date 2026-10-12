## Purpose

WORKFLOW.md prompt 模板优化与字段规范。
## Requirements
### Requirement: WORKFLOW.md prompt 模板包含 jira_rest 使用指南
`WORKFLOW.md.example` 的 prompt body SHALL 引用 `jira` 技能作为 Jira 交互的指南来源,SHALL NOT 在模板正文中内联 jira_rest API 路径示例。模板 SHALL 指示 agent 使用 `jira` 技能完成状态转换、评论添加、标签添加等操作。`jira` 技能文件（`assets/skills/jira/SKILL.md`）SHALL 包含 jira_rest 工具的完整使用说明与 API 路径示例(如 `GET /issue/{key}/transitions` 查可用 transitions、`POST /issue/{key}/transitions` 转状态、`POST /issue/{key}/comment` 加评论、`GET /issue/{key}/comment` 读评论、`GET /issue/{key}?fields=attachment` 读附件)。

#### Scenario: prompt 引用 jira 技能
- **WHEN** 查看 `WORKFLOW.md.example` 的 prompt body
- **THEN** 包含对 `jira` 技能的引用,SHALL NOT 内联 jira_rest API 路径示例

#### Scenario: jira 技能包含完整 API 示例
- **WHEN** 查看 `assets/skills/jira/SKILL.md`
- **THEN** 包含 transitions 查询与转换、评论读写、标签添加、附件读写的使用说明与 API 路径示例

### Requirement: 代码任务走 review 交接态而非直接完成
prompt 模板 SHALL 指示:对于需要提交代码的任务,agent 完成后 SHALL 用 `jira` 技能查询可用 transitions 并按名称选择审查态(如 "处理中"、"In Review")进行转换,SHALL NOT 直接转为终态。prompt SHALL 指示 agent 添加评论含变更摘要与 MR 链接,SHALL 指示 agent 添加 `needs-review` 标签。人工 review + merge 后由人工转为终态。

#### Scenario: prompt 指示代码任务走 review
- **WHEN** prompt 模板渲染给代码任务的 agent
- **THEN** 指示 agent 用 `jira` 技能查询 transitions、转到审查态(不直接完成)、加评论、加标签

### Requirement: 非代码任务直接完成
prompt 模板 SHALL 指示:对于非代码任务(文档、调研、配置等),agent 完成后 SHALL 用 `jira` 技能查询可用 transitions 并直接转为完成态,SHALL 添加评论含工作摘要与产出说明。

#### Scenario: prompt 指示非代码任务直接完成
- **WHEN** prompt 模板渲染给非代码任务的 agent
- **THEN** 指示 agent 用 `jira` 技能查询 transitions 并直接转完成态、加评论

### Requirement: agent 先查 transitions 再转状态
prompt 模板 SHALL 指示 agent 在转状态前先查询可用 transitions,再按状态名称选择对应 id 执行转换。SHALL NOT 硬编码 transition id(因不同 Jira 部署的 id 不同)。此指南 SHALL 在 `jira` 技能中详述,模板只引用技能名。

#### Scenario: prompt 指示先查 transitions
- **WHEN** prompt 模板包含转状态指示
- **THEN** 指示 agent 用 `jira` 技能查询可用 transitions 再按名称选 id

### Requirement: agent 在 Jira 中添加跟踪信息
prompt 模板 SHALL 指示 agent 在工作过程中和完成时用 `jira` 技能在 Jira 任务中添加跟踪信息:
- 完成时:变更摘要评论(改了什么、为什么)
- 如有 MR:评论中附 MR 链接
- 如有 demo/截图:评论中附链接或描述
- 完成时:添加标签(如 `agent-done` 或 `needs-review`)便于团队筛选

#### Scenario: prompt 指示添加评论
- **WHEN** prompt 模板包含完成指示
- **THEN** 指示 agent 用 `jira` 技能添加含变更摘要的评论

#### Scenario: prompt 指示添加标签
- **WHEN** prompt 模板包含完成指示
- **THEN** 指示 agent 用 `jira` 技能添加 `needs-review` 或 `agent-done` 标签

### Requirement: prompt 根据 attempt 区分首次与重试
prompt 模板 SHALL 根据 `attempt` 变量提供不同指令:首次(`attempt` null)给完整任务指令,SHALL 引用 `pull`/`commit`/`push`/`jira` 技能;重试(`attempt` >= 1)给"检查工作区当前状态,继续未完成的工作"指令,SHALL 引用 `land` 技能(监控 CI、处理 review 反馈并合并)和 `debug` 技能(排查问题)。

#### Scenario: 首次 attempt 给完整指令
- **WHEN** `attempt` 为 null
- **THEN** prompt 包含完整任务说明,引用 pull/commit/push/jira 技能

#### Scenario: 重试 attempt 给续轮指令
- **WHEN** `attempt` >= 1
- **THEN** prompt 指示检查 git status / 工作区状态,继续未完成的工作,引用 land 和 debug 技能

#### Scenario: 重试 attempt 引用 land 技能
- **WHEN** `attempt` >= 1 且 workspace 存在已创建的 MR
- **THEN** prompt 指示 agent 使用 `land` 技能监控 CI 并处理 review 反馈

### Requirement: prompt 模板包含 jira_upload_attachment 使用指南
`jira_upload_attachment` 工具的使用说明 SHALL 包含在 `jira` 技能文件（`assets/skills/jira/SKILL.md`）中,SHALL NOT 内联在模板正文。技能 SHALL 包含调用示例(如 `jira_upload_attachment({ issue_key: "{key}", filename: "screenshot.png", content: "<base64>" })`)与生成 base64 content 的方法(`fs.readFileSync(path).toString('base64')`)。

#### Scenario: jira 技能包含 jira_upload_attachment 用法
- **WHEN** 查看 `assets/skills/jira/SKILL.md`
- **THEN** 包含 `jira_upload_attachment` 工具的使用说明与调用示例

#### Scenario: jira 技能包含 base64 编码方法
- **WHEN** 查看 `jira` 技能中附件上传说明
- **THEN** 包含将本地文件转为 base64 的示例代码 `fs.readFileSync(path).toString('base64')`

### Requirement: 完成流程集成可选附件上传步骤
prompt 模板 SHALL 在代码任务和非代码任务的完成步骤中指示 agent 如有产出文件(截图、日志、测试报告等),SHALL 用 `jira` 技能上传到 Jira 任务。该步骤为条件性的——仅在存在产出文件时执行,SHALL NOT 强制 agent 造文件。

#### Scenario: 代码任务完成时上传附件
- **WHEN** prompt 模板渲染给代码任务的 agent,且 agent 有产出文件(如测试报告)
- **THEN** 指示 agent 用 `jira` 技能上传产出文件到 Jira 任务

#### Scenario: 无产出文件时跳过附件上传
- **WHEN** prompt 模板包含附件上传指引,但 agent 无产出文件
- **THEN** 指示 agent 跳过附件上传步骤(条件性语言"如有")

#### Scenario: 非代码任务也可上传附件
- **WHEN** prompt 模板渲染给非代码任务的 agent,且有产出文件(如调研报告)
- **THEN** 指示 agent 用 `jira` 技能上传产出文件

### Requirement: WORKFLOW.md.example 包含全部配置字段与注释
`WORKFLOW.md.example` SHALL 包含全部已实现的配置块及其全部字段。每个字段 SHALL 有 YAML `#` 内联注释说明用途。必填字段 SHALL 标注 `(必填)`。涉及密钥的字段 SHALL 注释提示用 `$VAR` 间接引用。`WORKFLOW.md.example` SHALL NOT 包含已移除的 `review_state` 字段。`active_states` 示例 SHALL 体现三层状态模型,包含初始态、工作中态、合并态、返工态。注释 SHALL 说明 review 态不放在 `active_states` 或 `terminal_states` 中。注释 SHALL 说明增量修复（人移回初始态）与全量重置（人移到返工态）的区别。

#### Scenario: active_states 示例体现三层模型+双路径
- **WHEN** 查看 `WORKFLOW.md.example` 的 `active_states` 字段
- **THEN** 包含至少 4 个状态（初始态、工作中态、合并态、返工态）

#### Scenario: 注释说明 review 态
- **WHEN** 查看 `WORKFLOW.md.example` 的 `active_states` 或 `terminal_states` 注释
- **THEN** 说明 review 态（如"代码评审中"）不放在两个列表中

#### Scenario: 注释说明双路径 review
- **WHEN** 查看 `WORKFLOW.md.example` 的 `active_states` 注释
- **THEN** 说明人移回初始态=增量修复、人移到返工态=全量重置

#### Scenario: 不包含已移除的 review_state 字段
- **WHEN** 查看 `WORKFLOW.md.example` 的 front matter
- **THEN** 不包含 `review_state` 字段

### Requirement: init starter 模板与 example 完全一致
`src/cli/init.ts` SHALL 读取 `WORKFLOW.md.example` 作为 starter 模板内容，生成的 WORKFLOW.md 与 example 完全一致（含全部字段、注释、prompt body）。不再维护独立的内联模板字符串。

#### Scenario: init 生成的文件与 example 一致
- **WHEN** 运行 `tasking init` 生成 WORKFLOW.md
- **THEN** 生成的文件内容与 `WORKFLOW.md.example` 完全相同

#### Scenario: init 生成的文件包含注释
- **WHEN** 查看 `tasking init` 生成的 WORKFLOW.md
- **THEN** 每个配置字段有 `#` 内联注释说明用途

### Requirement: prompt 模板注入 terminal_states 和 active_states
prompt 模板 SHALL 通过 `RenderContext.terminal_states` 和 `RenderContext.active_states` 接收预 join 的状态名称字符串。模板 SHALL 在 State Flow 小节中渲染 `{{ active_states }}` 和 `{{ terminal_states }}` 告诉 agent 哪些状态是活跃的（会被派发）、哪些是终态（不可自行 transition）。`active_states` 和 `terminal_states` SHALL 由 `renderPrompt` 调用点从配置数组 `.join(", ")` 后传入。

#### Scenario: 模板渲染 active_states
- **WHEN** `config.tracker.active_states` 为 `["待办", "处理中", "合并中", "返工"]` 且渲染 prompt
- **THEN** 模板中 `{{ active_states }}` 被替换为 `"待办, 处理中, 合并中, 返工"`

#### Scenario: 模板渲染 terminal_states
- **WHEN** `config.tracker.terminal_states` 为 `["完成", "Closed"]` 且渲染 prompt
- **THEN** 模板中 `{{ terminal_states }}` 被替换为 `"完成, Closed"`

#### Scenario: 模板包含 State Flow 小节
- **WHEN** 查看 `WORKFLOW.md.example` 的 prompt body
- **THEN** 包含 State Flow 小节，解释三层状态模型（active / review / terminal）

#### Scenario: State Flow 解释三层模型
- **WHEN** prompt 模板渲染给 agent
- **THEN** 包含对 active 状态（调度器派发）、review 状态（停 worker 保留工作区）、terminal 状态（清理工作区）的说明

### Requirement: prompt 模板引用全部技能
prompt 模板 SHALL 在 workflow 步骤中引用全部已实现的技能:首次 attempt 引用 `pull`(同步分支)、`commit`(规范化提交)、`push`(push + 创建 MR)、`jira`(Jira 交互);重试 attempt 引用 `land`(MR 落地)和 `debug`(问题排查)。模板 SHALL NOT 内联原始 git 命令(如 `git add -A && git commit`)。

#### Scenario: 首次 attempt 引用 pull/commit/push/jira 技能
- **WHEN** `attempt` 为 null 且渲染 prompt
- **THEN** 模板引用 `pull`、`commit`、`push`、`jira` 技能名

#### Scenario: 重试 attempt 引用 land/debug 技能
- **WHEN** `attempt` >= 1 且渲染 prompt
- **THEN** 模板引用 `land`、`debug` 技能名

#### Scenario: 模板不内联原始 git 命令
- **WHEN** 查看 `WORKFLOW.md.example` 的 prompt body
- **THEN** 不包含 `git add -A`、`git commit -m`、`git push` 等原始命令

### Requirement: workflow 步骤包含显式状态转换指引与双路径 review 处理
prompt 模板 SHALL 在 workflow 步骤的每一步加入显式的状态转换指引,告诉 agent 在该步骤应该转入什么类型的状态:
1. 开始工作时:从初始 active 态转入工作中 active 态
2. 创建 MR + 扫完反馈 + CI 绿后:转入 review 态（neither active nor terminal）
3. 人 review 后移到初始 active 态（PR 还在）→ 增量修复:同分支改 → push → 扫完反馈 → 转回 review 态
4. 人 review 后移到返工 active 态 → 全量重置:关旧 MR → 新分支 → 从头来 → 转回 review 态
5. 人 approve 后移到合并 active 态 → agent 被重新派发 → 跑 `land` 技能 → merge 成功后转入 terminal 态

模板 SHALL 使用 `{{ active_states }}` 和 `{{ terminal_states }}` 帮助 agent 理解哪些状态属于哪类。

#### Scenario: 步骤 1 指示转入工作中态
- **WHEN** prompt 模板渲染给代码任务的 agent（首次 attempt）
- **THEN** 指示 agent 用 `jira` 技能转入一个 active 状态（工作中态）

#### Scenario: 步骤 2 指示转入 review 态
- **WHEN** prompt 模板包含 MR 创建后的完成步骤
- **THEN** 指示 agent 转入一个既不在 `{{ active_states }}` 也不在 `{{ terminal_states }}` 中的状态（review 态）

#### Scenario: 步骤 3 增量修复路径
- **WHEN** prompt 模板包含 review 被退回的指引
- **THEN** 指示 agent 在人移回初始 active 态时,同分支改代码、push、扫完反馈、转回 review 态

#### Scenario: 步骤 4 全量重置路径
- **WHEN** prompt 模板包含返工态的指引
- **THEN** 指示 agent 在人移到返工 active 态时,关旧 MR、从 origin/main 创新分支、从头来、转回 review 态

#### Scenario: 步骤 5 land 后转 terminal
- **WHEN** prompt 模板包含合并步骤
- **THEN** 指示 agent 在 `land` 技能 merge 成功后转入 terminal 态

### Requirement: buildContinuationGuidance 引用技能与状态检查
`buildContinuationGuidance` 函数的续轮指引文本 SHALL 引用 `debug` 和 `land` 技能,与模板的重试分支语言风格一致。指引 SHALL 指示 agent 检查当前 Jira 状态,根据所处状态决定是增量修复（同分支改）还是全量重置（关 MR、新分支）。

#### Scenario: 续轮指引引用 debug 技能
- **WHEN** 调用 `buildContinuationGuidance`
- **THEN** 文本包含 `debug` 技能引用

#### Scenario: 续轮指引引用 land 技能
- **WHEN** 调用 `buildContinuationGuidance`
- **THEN** 文本包含 `land` 技能引用

#### Scenario: 续轮指引提示检查状态
- **WHEN** 调用 `buildContinuationGuidance`
- **THEN** 文本提示检查当前 Jira 状态并决定增量修复还是全量重置
