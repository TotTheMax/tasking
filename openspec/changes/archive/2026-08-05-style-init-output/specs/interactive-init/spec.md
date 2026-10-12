## ADDED Requirements

### Requirement: init 输出分节边框与状态图标
交互式 init SHALL 将输出组织为分节，每节用 `╭─` 标题行开头、`│` 前缀包裹内容行、`╰──` 结尾。节顺序 SHALL 为：Prerequisites → Jira Setup → Connection Test → Initialization → Next Steps。状态检查结果 SHALL 用状态图标标记：`✓`(通过)、`✗`(失败)、`⚠`(警告)、`·`(信息)。提问文本 SHALL 用粗体突出，提示文字 SHALL 用暗色压低。非 TTY 输出 SHALL 自动去除颜色，输出纯文本。

#### Scenario: 交互模式分节输出
- **WHEN** stdin 为 TTY 时调用 `tasking init`
- **THEN** 输出包含 5 个分节，每节有 ╭─ 标题行和 ╰── 结尾行，内容行以 │ 开头

#### Scenario: 状态图标标记检查结果
- **WHEN** init 执行前置检查或连接测试
- **THEN** 通过项以 ✓ 开头，失败项以 ✗ 开头，警告项以 ⚠ 开头，信息项以 · 开头

#### Scenario: 非 TTY 自动去色
- **WHEN** stdout 非 TTY（管道或重定向）时调用 `tasking init`
- **THEN** 输出不含 ANSI 转义码，为纯文本

## MODIFIED Requirements

### Requirement: 交互式凭据问答
`tasking init` SHALL 在 stdin 为 TTY 时启动交互式 readline 问答，逐项收集：`tracker.kind`（固定 `jira`）、`tracker.endpoint`（用户输入）、`tracker.api_key`（写入 `$JIRA_API_KEY` 环境变量引用）、`tracker.auth_mode`（用户选 basic/bearer）、`tracker.api_user`（仅 `auth_mode: basic` 时问）、`tracker.project_key`（用户输入）。问答 SHALL 支持回车跳过可选项。SHALL 在每个提示旁显示简短说明。提问格式串 SHALL 以 `│` 边框前缀开头，问题文本 SHALL 用粗体样式，提示文字 SHALL 用暗色样式。

#### Scenario: TTY 环境启动交互式问答
- **WHEN** stdin 为 TTY 且调用 `tasking init`
- **THEN** 启动 readline 逐项问答 Jira 凭据，每行以 │ 开头

#### Scenario: bearer 模式跳过 api_user
- **WHEN** 用户在 auth_mode 步骤选择 `bearer`
- **THEN** 跳过 api_user 问答

#### Scenario: basic 模式问 api_user
- **WHEN** 用户在 auth_mode 步骤选择 `basic`
- **THEN** 继续问 api_user

#### Scenario: api_key 写入环境变量引用
- **WHEN** 用户输入 api_key
- **THEN** WORKFLOW.md 的 `tracker.api_key` 字段写入 `$JIRA_API_KEY`，并提示用户将实际值加到 `~/.bashrc`

#### Scenario: 提问文本用粗体
- **WHEN** 显示提问问题
- **THEN** 问题文本使用粗体 ANSI 样式

#### Scenario: 提示文字用暗色
- **WHEN** 显示提问旁的 tip 说明
- **THEN** 提示文字使用暗色 ANSI 样式

### Requirement: Jira 连接测试与状态展示
问答完成后 SHALL 用两步测试验证凭据：第一步请求 `/serverInfo` 验证 endpoint 可达且 auth 有效，第二步请求 `/project/{key}/statuses` 验证 project key 可访问。每步 SHALL 设 5s 超时。第一步成功 SHALL 以 `✓` 图标打印 Jira 版本号。第二步成功 SHALL 以 `·` 前缀打印项目状态列表供用户参考。第一步失败 SHALL 以 `✗` 图标打印错误信息（含 endpoint 和常见原因提示：API 版本、context path、URL 可达性）。第二步失败 SHALL 以 `⚠` 图标打印 project key 错误信息（含 key 值和检查建议）。两步均不阻断后续流程。

#### Scenario: 两步均成功
- **WHEN** endpoint 可达、auth 有效、project key 可访问
- **THEN** 以 ✓ 打印 Jira 版本号，以 · 前缀打印项目状态列表，提示用户自行分配 active_states/terminal_states

#### Scenario: 第一步失败（endpoint 不可达或 auth 无效）
- **WHEN** `/serverInfo` 返回非 200 或网络错误
- **THEN** 以 ✗ 打印错误信息（含 endpoint 和常见原因提示），跳过第二步，继续生成配置文件

#### Scenario: 第一步成功但第二步失败（project key 不可访问）
- **WHEN** `/serverInfo` 成功但 `/project/{key}/statuses` 返回非 200
- **THEN** 以 ✓ 打印 Jira 版本号，以 ⚠ 打印 project key 错误信息（含 key 值和检查建议），继续生成配置文件

#### Scenario: 连接超时
- **WHEN** Jira 5s 内未响应
- **THEN** 以 ✗ 打印超时错误，继续生成配置文件

### Requirement: opencode 安装检查
init SHALL 在凭据收集之前检查 `opencode` 命令是否可执行（`which opencode`），作为 Prerequisites 节的一部分。已安装 SHALL 以 `✓` 图标标记。找不到 SHALL 以 `✗` 图标打印警告，SHALL NOT 阻断 init 流程。

#### Scenario: opencode 已安装
- **WHEN** `opencode` 在 PATH 中
- **THEN** 以 ✓ 标记，继续

#### Scenario: opencode 未安装
- **WHEN** `opencode` 不在 PATH 中
- **THEN** 以 ✗ 打印警告，继续

### Requirement: 编辑器自动打开
生成 WORKFLOW.md 后 SHALL 尝试打开编辑器，尝试顺序为 `$VISUAL` → `$EDITOR` → `code`。SHALL 以非阻塞方式打开（spawn detached + stdio ignore）。成功打开 SHALL 在 Next Steps 节以 `✓` 标记。全部失败 SHALL 以 `·` 打印文件路径并提示用户手动编辑。

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
- **THEN** 以 · 打印文件路径，提示手动编辑

### Requirement: 完成提示
init 完成后 SHALL 在 Next Steps 节打印提示，列出需手动编辑的字段：`active_states`、`terminal_states`、`review_state`、`after_create` hook。字段说明 SHALL 用暗色样式压低。`tasking start` 命令 SHALL 用绿色粗体突出。

#### Scenario: 打印需手动编辑的字段
- **WHEN** init 流程完成
- **THEN** 在 Next Steps 节打印字段列表，字段说明用暗色，`tasking start` 用绿色粗体

### Requirement: glab CLI 安装检查
交互式 init SHALL 在凭据收集之前检查 `glab` 命令是否可执行（`which glab`），作为 Prerequisites 节的一部分，紧跟 opencode 检查之后。已安装 SHALL 以 `✓` 图标标记。找不到 SHALL 以 `✗` 图标打印警告，SHALL NOT 阻断 init 流程。

#### Scenario: glab 已安装
- **WHEN** `glab` 在 PATH 中
- **THEN** 以 ✓ 标记，继续

#### Scenario: glab 未安装
- **WHEN** `glab` 不在 PATH 中
- **THEN** 以 ✗ 打印警告，继续

### Requirement: GitLab 环境变量条件提示
交互式 init SHALL 在 glab 检查之后（Prerequisites 节内）、凭据收集之前，检查 `process.env.GITLAB_TOKEN` 是否已设置。已设置 SHALL 以 `✓` 标记，跳过提示。未设置 SHALL 以 `⚠` 图标打印提示，说明两种配置方式：以环境变量方式 `export` 到 `~/.bashrc`，或直接在 WORKFLOW.md 的 `env:` 配置段填写值。SHALL NOT 阻断 init 流程。

#### Scenario: GITLAB_TOKEN 已设置
- **WHEN** `process.env.GITLAB_TOKEN` 有值
- **THEN** 以 ✓ 标记，不打印 GitLab 环境变量提示

#### Scenario: GITLAB_TOKEN 未设置
- **WHEN** `process.env.GITLAB_TOKEN` 未设置
- **THEN** 以 ⚠ 打印提示，包含两种配置方式（环境变量或直接写配置）

### Requirement: land skill 安装
交互式 init SHALL 将 `assets/skills/land/` 下的 `SKILL.md` 和 `land_watch.py` 拷贝到 WORKFLOW.md 同目录下的 `.opencode/skills/land/`。SHALL NOT 拷贝 `__pycache__`。目标目录或文件已存在 SHALL 跳过拷贝（永不覆盖）。拷贝成功 SHALL 在 Initialization 节以 `✓` 图标标记。拷贝失败 SHALL 以 `✗` 图标打印警告，SHALL NOT 阻断 init 流程。

#### Scenario: skill 不存在则拷贝
- **WHEN** `.opencode/skills/land/` 不存在
- **THEN** 创建目录并拷贝 `SKILL.md` 和 `land_watch.py`，以 ✓ 标记

#### Scenario: skill 已存在则跳过
- **WHEN** `.opencode/skills/land/` 已存在
- **THEN** 跳过拷贝，不覆盖任何文件，以 · 标记

#### Scenario: 拷贝失败不阻断
- **WHEN** skill 拷贝因权限不足等原因失败
- **THEN** 以 ✗ 打印警告，init 继续执行
