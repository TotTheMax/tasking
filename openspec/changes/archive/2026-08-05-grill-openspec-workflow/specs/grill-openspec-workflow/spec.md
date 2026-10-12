## ADDED Requirements

### Requirement: grill-openspec 模板文件存在
`WORKFLOW.grill-openspec.md.example` SHALL 存在于仓库根目录，SHALL 与 `WORKFLOW.md.example` 共享同一 config schema（相同 front matter 字段集），SHALL 仅 prompt body 不同。

#### Scenario: 模板文件存在且 schema 一致
- **WHEN** 查看 `WORKFLOW.grill-openspec.md.example`
- **THEN** 文件存在，front matter 字段集与 `WORKFLOW.md.example` 一致，prompt body 与 `WORKFLOW.md.example` 不同

### Requirement: grill-openspec prompt body 编码四阶段路由
grill-openspec 模板的 prompt body SHALL 指示 agent 按四阶段自判路由：grill（查代码定事实、起草 `CONTEXT.md`/`docs/adr/`、把待定决策合并成一条带标记头的 Jira comment、转 review 态、不建 MR 不建 openspec change）、实施（`opsx-propose-with-tdd` 建 openspec change、`opsx-implement` 按 tasks 实现、建 MR、转 review）、合并（`land` 合 MR、`openspec-archive-change` 归档、转 terminal）、运行中升级（任何阶段遇 truly blocking 决策可发拷问 comment 转 review）。grill 阶段若 agent 能从代码库定全部、无待定决策，SHALL 跳过 comment 与 review 暂停、直接进实施阶段。prompt SHALL 指示 agent 重派时以产物为主判定阶段（有无 `CONTEXT.md`/拷问 comment/openspec change/MR），不确定查 Jira comments。

#### Scenario: prompt 含四阶段指引
- **WHEN** 渲染 grill-openspec prompt body
- **THEN** 包含 grill、实施、合并、运行中升级四段指引

#### Scenario: grill 阶段不建 MR
- **WHEN** prompt body 描述 grill 阶段
- **THEN** 指示发拷问 comment 转 review，SHALL NOT 建 MR、SHALL NOT 建 openspec change

#### Scenario: grill 无疑问直接进实施
- **WHEN** prompt body 描述 grill 阶段且 agent 能从代码库定全部决策（无待定决策）
- **THEN** 指示跳过 comment 与 review 暂停、直接进实施阶段

#### Scenario: 重派以产物判阶段
- **WHEN** prompt body 描述重派路由
- **THEN** 指示 agent 以产物（`CONTEXT.md`/拷问 comment/openspec change/MR）为主判阶段，不确定查 Jira comments

### Requirement: grill-openspec prompt 不硬编码状态名
grill-openspec prompt body SHALL NOT 出现字面量具体状态名（如"待办"/"合并中"/"重置处理"），SHALL 用 `{{ active_states }}`/`{{ review_state }}`/`{{ terminal_states }}` 引用注入值 + 角色描述。合 MR 信号 SHALL 优先看当前 active 状态语义，语义不明 SHALL 指示查 glab MR 审批状态（approved→合，未 approve+反馈→增量修复）。

#### Scenario: 不含字面量状态名
- **WHEN** 查看 grill-openspec prompt body
- **THEN** 不出现具体 Jira 实例的状态名字面量（"待办"/"合并中"/"重置处理"/"代码评审中"等），改用 `{{ active_states }}`/`{{ review_state }}`/`{{ terminal_states }}`

#### Scenario: 合 MR 信号分层
- **WHEN** prompt body 描述合 MR 触发
- **THEN** 指示先看当前 active 状态语义，不明则查 glab MR 审批状态

### Requirement: grill-openspec prompt 只用现有模板变量
grill-openspec prompt body SHALL 只用 `task`/`attempt`/`active_states`/`review_state`/`terminal_states` 变量，SHALL NOT 引用这些之外的变量（`RenderContext` 不变）。

#### Scenario: 只用现有变量
- **WHEN** 用 `renderPrompt` 渲染 grill-openspec prompt body
- **THEN** 不抛 `unknown variable` 错误，且不引用 `task`/`attempt`/`active_states`/`review_state`/`terminal_states` 之外的变量

### Requirement: 拷问 comment 固定标记头
grill-openspec prompt SHALL 指示 agent 发拷问时在 Jira comment 用固定标记头 `## 🔍 拷问 / Grill Questions`，便于重派时识别自己的拷问 comment。

#### Scenario: 拷问 comment 标记头
- **WHEN** prompt body 描述发拷问
- **THEN** 指示用固定标记头 `## 🔍 拷问 / Grill Questions`

### Requirement: 拷问未答默认走推荐
grill-openspec prompt SHALL 指示 agent 重派捞答案时，对人未答的题采用 agent 当初的推荐答案（在 comment 中标注"未答采用推荐"）继续，truly blocking 才升级重发那一题。

#### Scenario: 未答走推荐
- **WHEN** prompt body 描述拷问未答处理
- **THEN** 指示采用 agent 推荐答案并标注、继续；SHALL 仅在 truly blocking 时升级重发

### Requirement: 返工不重新 grill
grill-openspec prompt SHALL 指示：增量修复（MR 还在）同分支改、push、CI 绿、转 review；全量重置（重置处理语义）关旧 MR、新分支、按现有 openspec change 重新 implement。两条返工路 SHALL NOT 重新 grill。

#### Scenario: 增量修复不重新 grill
- **WHEN** prompt body 描述增量修复
- **THEN** 指示同分支改、push、CI 绿、转 review，SHALL NOT 重新 grill

#### Scenario: 全量重置不重新 grill
- **WHEN** prompt body 描述全量重置
- **THEN** 指示关旧 MR、新分支、按现有 openspec change 重新 implement，SHALL NOT 重新 grill

### Requirement: grill-openspec prompt 引用四个技能并注明交付责任
grill-openspec prompt SHALL 引用 `.opencode/skills/` 下的 `opsx-grill-with-docs`/`opsx-propose-with-tdd`/`opsx-implement`/`openspec-archive-change` 四个技能，SHALL 注明技能由 `tasking init` 装进目标仓库、随 `after_create` 克隆进入工作区，运行时 daemon 不每工作区拷贝。

#### Scenario: prompt 引用四个技能
- **WHEN** 渲染 grill-openspec prompt body
- **THEN** 引用 `opsx-grill-with-docs`、`opsx-propose-with-tdd`、`opsx-implement`、`openspec-archive-change` 四个技能名

#### Scenario: 注明技能交付责任
- **WHEN** prompt body 描述技能来源
- **THEN** 注明技能由 `tasking init` 装进目标仓库、运行时 daemon does NOT copy them per-workspace
