## ADDED Requirements

### Requirement: 交互式凭据问答
`tasking init` SHALL 在 stdin 为 TTY 时启动交互式 readline 问答，逐项收集：`tracker.kind`（固定 `jira`）、`tracker.endpoint`（用户输入）、`tracker.api_key`（写入 `$JIRA_API_KEY` 环境变量引用）、`tracker.auth_mode`（用户选 basic/bearer）、`tracker.api_user`（仅 `auth_mode: basic` 时问）、`tracker.project_key`（用户输入）。问答 SHALL 支持回车跳过可选项。SHALL 在每个提示旁显示简短说明。

#### Scenario: TTY 环境启动交互式问答
- **WHEN** stdin 为 TTY 且调用 `tasking init`
- **THEN** 启动 readline 逐项问答 Jira 凭据

#### Scenario: bearer 模式跳过 api_user
- **WHEN** 用户在 auth_mode 步骤选择 `bearer`
- **THEN** 跳过 api_user 问答

#### Scenario: basic 模式问 api_user
- **WHEN** 用户在 auth_mode 步骤选择 `basic`
- **THEN** 继续问 api_user

#### Scenario: api_key 写入环境变量引用
- **WHEN** 用户输入 api_key
- **THEN** WORKFLOW.md 的 `tracker.api_key` 字段写入 `$JIRA_API_KEY`，并提示用户将实际值加到 `~/.bashrc`

### Requirement: Jira 连接测试与状态展示
问答完成后 SHALL 用收集到的凭据连 Jira 测试连接。SHALL 设 5s 超时。连接成功 SHALL 拉取项目状态列表并打印出来供用户参考。连接失败 SHALL 打印错误信息（含 endpoint），不阻断后续流程。

#### Scenario: 连接成功打印项目状态
- **WHEN** 凭据正确且 Jira 可达
- **THEN** 打印项目状态列表，提示用户自行分配 active_states/terminal_states

#### Scenario: 连接失败不阻断
- **WHEN** 凭据错误或网络不可达
- **THEN** 打印错误信息（含 endpoint 和失败原因），继续生成配置文件

#### Scenario: 连接超时
- **WHEN** Jira 5s 内未响应
- **THEN** 打印超时错误，继续生成配置文件

### Requirement: opencode 安装检查
init SHALL 检查 `opencode` 命令是否可执行（`which opencode`）。找不到 SHALL 打印警告，SHALL NOT 阻断 init 流程。

#### Scenario: opencode 已安装
- **WHEN** `opencode` 在 PATH 中
- **THEN** 不打印警告，继续

#### Scenario: opencode 未安装
- **WHEN** `opencode` 不在 PATH 中
- **THEN** 打印警告"未检测到 opencode，daemon 无法执行任务"，继续

### Requirement: 编辑器自动打开
生成 WORKFLOW.md 后 SHALL 尝试打开编辑器，尝试顺序为 `$VISUAL` → `$EDITOR` → `code`。SHALL 以非阻塞方式打开（spawn detached + stdio ignore）。全部失败 SHALL 打印文件路径并提示用户手动编辑。

#### Scenario: 用 $VISUAL 打开
- **WHEN** 环境变量 `$VISUAL` 已设置
- **THEN** 用该编辑器打开 WORKFLOW.md

#### Scenario: 用 $EDITOR 打开
- **WHEN** `$VISUAL` 未设置但 `$EDITOR` 已设置
- **THEN** 用该编辑器打开 WORKFLOW.md

#### Scenario: 用 code 打开
- **WHEN** `$VISUAL` 和 `$EDITOR` 均未设置但 `code` 可执行
- **THEN** 用 `code` 打开 WORKFLOW.md

#### Scenario: 无可用编辑器
- **WHEN** `$VISUAL`、`$EDITOR`、`code` 均不可用
- **THEN** 打印文件路径，提示"请手动编辑此文件完成配置"

### Requirement: 完成提示
init 完成后 SHALL 打印友好提示，列出需手动编辑的字段：`active_states`、`terminal_states`、`review_state`、`after_create` hook。

#### Scenario: 打印需手动编辑的字段
- **WHEN** init 流程完成
- **THEN** 打印提示"完美运作需手动编辑以下字段"及字段列表
