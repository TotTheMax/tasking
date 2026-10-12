# interactive-init

## MODIFIED Requirements

### Requirement: workflow 选择问答

`tasking init` 交互式流程 SHALL 询问使用哪个 workflow，选项为 `default`、`code-mr`、`grill-openspec` 与 `feishu-direct`。当用户已通过 `--workflow` 指定时 SHALL 跳过此问答。所选 workflow SHALL 决定使用哪个变体模板生成 `WORKFLOW.md`（四变体映射见 workflow-templates）。问答 SHALL 在选项旁显示各变体简述（`feishu-direct`＝飞书直连专用：只配飞书、无 Jira）。`default` SHALL 为默认选中项。

#### Scenario: 选择 feishu-direct
- **WHEN** 交互式 init 中用户选择 `feishu-direct`
- **THEN** 使用 feishu-direct 模板生成 WORKFLOW.md，且后续问答按该变体裁剪（跳过 Jira 相关问答）

## ADDED Requirements

### Requirement: feishu-direct 分支的问答裁剪

交互式 init 在 `feishu-direct` 变体下 SHALL：跳过 Jira 凭据三问（endpoint/api_key/project）与 Jira 连接测试；跳过 "Enable Feishu bridge" 选择（`feishu.enabled: true` 直接烘焙——该变体里飞书就是全部）；跳过 issue types 问答（无 Jira 可查）；跳过 glab/GitLab 检查（无技能依赖）；仅询问飞书凭证 app_id 与 intake_chat_id（与现有 Feishu 问答一致；app_secret 不在终端回显，保留 `$FEISHU_APP_SECRET` 引用 + 环境变量提示）。SHALL NOT 新增交互式 projects 收集（模板留注释示例，用户编辑 WORKFLOW.md 配置）。

#### Scenario: 不问 Jira 凭据
- **WHEN** 交互式 init 选择 feishu-direct 后进入凭据阶段
- **THEN** 不出现 Jira endpoint/api_key/project 问答，也不执行连接测试

#### Scenario: 飞书必答两项
- **WHEN** feishu-direct 交互流进行
- **THEN** 依次询问 app_id、intake_chat_id 并写入生成的 WORKFLOW.md；app_secret 保持 `$FEISHU_APP_SECRET` 引用（提示经环境变量注入）

#### Scenario: VCS 前置检查跳过
- **WHEN** feishu-direct 交互流的 Prerequisites 面板打印
- **THEN** 不包含 glab 与 GitLab 环境变量检查（仅 opencode）

#### Scenario: Enable-Feishu 问答被跳过
- **WHEN** feishu-direct 交互流进行
- **THEN** 不出现 "Enable Feishu bridge" 选择，生成配置的 `feishu.enabled` 为 true
