## MODIFIED Requirements

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
