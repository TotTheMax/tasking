# interactive-init

## MODIFIED Requirements

### Requirement: workflow 选择问答

`tasking init` 交互式流程在未指定 `--workflow` 时 SHALL 以「任务来源」二选一作为首问：「只用飞书直连（回车默认）」与「接 Jira」。选飞书直连 SHALL 直接进入飞书凭据问答（见 `feishu-first-onboarding`）；选接 Jira SHALL 追问变体三选一（`minimal` / `code-mr` / `grill-openspec`，选项旁附简述：minimal＝最小：工作目录完成任务→上传 Jira→转终态；code-mr＝写码＋建 MR；grill-openspec＝拷问→propose→implement→archive）。已通过 `--workflow` 指定时 SHALL 跳过首问与变体追问。模板语言由独立的 Template language 问答或 `--lang` 决定（见 `cli-runtime`）。

#### Scenario: 任务来源回车默认飞书直连
- **WHEN** stdin 为 TTY 且未指定 `--workflow` 时调用 `tasking init`，任务来源首问直接回车
- **THEN** 进入飞书凭据问答，不出现 Jira 问答与变体名

#### Scenario: 接 Jira 追问变体
- **WHEN** 用户在任务来源首问选择「接 Jira」
- **THEN** 交互式追问变体三选一（`minimal` / `code-mr` / `grill-openspec`），随后进入 Jira 凭据问答

#### Scenario: 已指定 --workflow 跳过问答
- **WHEN** 调用 `tasking init --workflow code-mr` 且 stdin 为 TTY
- **THEN** 跳过任务来源与变体问答，直接用 `code-mr` 模板

#### Scenario: 选择 minimal 用最小模板
- **WHEN** 用户在变体问答中选择 `minimal`
- **THEN** 使用 `WORKFLOW.minimal.md.example` 模板生成 `WORKFLOW.md`，其 prompt body 不含 git 分支/MR/glab 步骤

#### Scenario: 选择 code-mr 用全-MR 模板
- **WHEN** 用户在变体问答中选择 `code-mr`
- **THEN** 使用所选语言的 `WORKFLOW.code-mr.md.example` 模板生成 `WORKFLOW.md`

#### Scenario: 选择 grill-openspec 用 grill 模板
- **WHEN** 用户在变体问答中选择 `grill-openspec`
- **THEN** 使用 `WORKFLOW.grill-openspec.md.example` 模板生成 `WORKFLOW.md`

### Requirement: Feishu Setup 交互引导

交互式 init 的接 Jira 分支 SHALL 在 Jira 段之后提供 **Feishu Setup** 段：询问是否启用飞书评论桥；启用则采集 app_id、app_secret、intake_chat_id，并复用已发现的项目 issueTypes 供选择 `create_issue_type`（选项首项为模板默认 `Task`，回车即默认）。app_secret 采集 SHALL 支持明文直接写入（留空则保留 `$FEISHU_APP_SECRET` env 引用并提示 export）。采集值 SHALL 写入生成的 WORKFLOW.md `feishu:` 块：`app_id`/`intake_chat_id`/`create_issue_type` 写明文值，`enabled` 置 `true`。不启用则保持模板 `enabled: false`。

#### Scenario: 启用并采集
- **WHEN** 交互式 init 接 Jira 分支中用户选择启用飞书桥并填写值
- **THEN** 生成的 WORKFLOW.md `feishu:` 块 `enabled: true`、app_id/intake_chat_id/create_issue_type 为所填值

#### Scenario: app_secret 明文写入
- **WHEN** 用户在 app_secret 问答输入明文值
- **THEN** WORKFLOW.md 的 `app_secret` 写该明文值，并提示可改用 `FEISHU_APP_SECRET` 环境变量

#### Scenario: app_secret 留空保留 env 引用
- **WHEN** 用户在 app_secret 问答直接回车
- **THEN** `app_secret` 保持 `$FEISHU_APP_SECRET` 引用，并打印 export 提示

#### Scenario: 不启用保持关闭
- **WHEN** 交互式 init 接 Jira 分支中用户选择不启用飞书桥
- **THEN** 生成的 WORKFLOW.md 飞书块保持 `enabled: false`，不写任何飞书值

### Requirement: 完成提示

init 完成后 SHALL 按变体打印分级提示：feishu-direct SHALL 打印"配置完成"与可执行首句（`tasking start`，然后在群里发 `/chat <项目名> <消息>`），跳过项目问答时附 path 模式不限制目录的警告行；Jira 变体（minimal/code-mr/grill-openspec）SHALL 列出需手动编辑的字段：`active_states`、`terminal_states`、`review_state`、`after_create` hook。

#### Scenario: feishu-direct 打印首句命令
- **WHEN** feishu-direct 分支完成 init
- **THEN** 提示含 `tasking start` 与 `/chat` 示例命令

#### Scenario: Jira 变体打印需手动编辑的字段
- **WHEN** 接 Jira 分支完成 init
- **THEN** 打印提示"完美运作需手动编辑以下字段"及字段列表
