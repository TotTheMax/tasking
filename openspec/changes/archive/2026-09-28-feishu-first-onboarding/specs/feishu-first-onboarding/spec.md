# feishu-first-onboarding

## ADDED Requirements

### Requirement: init 默认变体为 feishu-direct

`tasking init` SHALL 以 `feishu-direct` 为默认变体：未指定 `--workflow` 的交互式流程默认走飞书直连分支；未指定 `--workflow` 的非交互式流程 SHALL 写入 feishu-direct 模板。`--workflow` 显式指定 SHALL 覆盖默认。

#### Scenario: 裸非交互 init 写 feishu-direct 模板
- **WHEN** 运行 `tasking init --non-interactive`（未指定 `--workflow`）
- **THEN** 生成的 WORKFLOW.md 为 feishu-direct 模板（`tracker.kind: none`、`feishu.enabled: true`）

#### Scenario: 显式 --workflow 覆盖默认
- **WHEN** 运行 `tasking init --workflow minimal --non-interactive`
- **THEN** 生成的 WORKFLOW.md 为 minimal 模板（`tracker.kind: jira`）

### Requirement: 任务来源首问

交互式 init 在未指定 `--workflow` 时 SHALL 以「任务来源」二选一作为首问：「只用飞书直连（回车默认）」与「接 Jira」。选飞书直连 SHALL 直接进入飞书凭据问答；选接 Jira SHALL 追问变体三选一（`minimal` / `code-mr` / `grill-openspec`，附简述）后进入 Jira 凭据问答。已指定 `--workflow` 时 SHALL 跳过首问与变体追问。

#### Scenario: 回车默认飞书直连
- **WHEN** 交互式 init 任务来源首问直接回车
- **THEN** 进入飞书凭据问答，全程不出现 Jira 问答与变体名

#### Scenario: 选接 Jira 追问变体
- **WHEN** 用户在任务来源首问选择「接 Jira」
- **THEN** 追问变体三选一（minimal/code-mr/grill-openspec），随后进入 Jira 凭据问答

#### Scenario: 指定 --workflow 跳过首问
- **WHEN** 运行交互式 `tasking init --workflow code-mr`
- **THEN** 不问任务来源，直接进入 Jira 凭据问答

### Requirement: 飞书凭据连通验证

飞书分支采集 app_id 与 app_secret 后 SHALL 立即用其请求 tenant_access_token 做连通验证：成功 SHALL 打印确认并继续；失败 SHALL 打印人话原因（凭据错误 / 应用未发布版本 / 网络不可达等）并重问 app_secret（app_id 保留）。验证 SHALL NOT 阻断 init——连续失败后 SHALL 提供跳过验证继续的出路。

#### Scenario: 验证成功
- **WHEN** app_id/app_secret 可成功换取 tenant_access_token
- **THEN** 打印连通成功提示，继续群选择问答

#### Scenario: 验证失败重问 secret
- **WHEN** 换取 tenant_access_token 返回凭据错误
- **THEN** 打印人话错误原因，重问 app_secret（app_id 不再重问）

#### Scenario: 连续失败可跳过
- **WHEN** 验证连续失败达到重问上限
- **THEN** 提供跳过验证继续完成 init 的选项，生成的 WORKFLOW.md 保留所填值

### Requirement: intake 群编号帮选

连通验证成功后 SHALL 调用群列表接口（机器人所在群）并以编号菜单供用户选择 intake 群（回车默认第一项），选择结果写入 `feishu.intake_chat_id`。群列表为空、接口失败或验证被跳过时 SHALL 回落为手填问答。

#### Scenario: 群列表选择
- **WHEN** 连通验证成功且机器人所在群非空
- **THEN** 列出群名供编号选择，回车默认第一项，所选群写入 intake_chat_id

#### Scenario: 回落手填
- **WHEN** 群列表接口失败（或列表为空、或验证被跳过）
- **THEN** 回落为手填 intake_chat_id 问答（`oc_` 前缀提示）

### Requirement: 可选项目问答与 path_roots 收敛

飞书分支末尾 SHALL 问一个可跳过的项目：项目名（回车跳过）；填了项目名 SHALL 追问目录绝对路径并校验存在（`existsSync`，不存在或非目录 SHALL 重问）。填写成功 SHALL 写 `feishu.direct.projects[<name>] = <path>` 且 `path_roots` 收敛为 `[<该路径>]`；跳过 SHALL 保持 `projects: {}` 与 `path_roots: []`，并在完成提示中警告 path 模式当前不限制目录。SHALL 只问一个项目。

#### Scenario: 填写项目预填并收敛
- **WHEN** 用户填项目名 `tasking` 与存在的目录 `/repos/tasking`
- **THEN** WORKFLOW.md 含 `projects: { tasking: { path: "/repos/tasking" } }` 与 `path_roots: ["/repos/tasking"]`

#### Scenario: 目录不存在重问
- **WHEN** 用户填的目录路径不存在
- **THEN** 提示并重问目录路径

#### Scenario: 回车跳过
- **WHEN** 用户在项目名问答直接回车
- **THEN** `projects` 为空、`path_roots` 保持 `[]`，完成提示含"path 模式当前不限制目录"警告

### Requirement: 按变体分级的完成提示

init 完成提示 SHALL 按变体分流：feishu-direct SHALL 打印"配置完成 + `tasking start` + 群里发 `/chat <项目名> <消息>`"的可执行首句（跳过项目问答时附 path 警告行）；Jira 变体（minimal/code-mr/grill-openspec）SHALL 维持现有手动字段提示（active_states/terminal_states/review_state/after_create）。

#### Scenario: feishu-direct 完成提示给首句命令
- **WHEN** feishu-direct 分支完成 init
- **THEN** 提示含 `tasking start` 与 `/chat <项目名> <消息>` 示例命令

#### Scenario: Jira 变体维持手工字段提示
- **WHEN** 接 Jira 分支完成 init
- **THEN** 提示列出 active_states/terminal_states/review_state/after_create 手动编辑字段
