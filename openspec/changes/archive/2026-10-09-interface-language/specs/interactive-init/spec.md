## MODIFIED Requirements

### Requirement: Template language 选择问答
`tasking init` 交互式流程 SHALL 在未通过 `--lang` 显式指定语言时询问模板语言（「Template language」选择框，选项 `中文` 与 `English`，`中文` 在前作为回车默认）。已显式指定 `--lang` 时 SHALL 跳过此问答。所选语言 SHALL 与 workflow 选择正交，共同决定使用哪个模板文件（见 `cli-runtime`），并同时种子界面语言：选 `English` 时 SHALL 在生成的 WORKFLOW.md front matter 写入 `interface_language: en`；选 `中文` 时 SHALL 省略该字段（默认值 `zh`，遵循 generated-config-trimming 的只写非默认字段）。`init --update` SHALL 把 `interface_language` 作为新字段（默认 `zh`）纳入 drift 报告而不写入。

#### Scenario: 未指定 --lang 时询问语言
- **WHEN** stdin 为 TTY 且未指定 `--lang` 时调用 `tasking init`
- **THEN** 交互式弹出 Template language 选择框（`中文` / `English`）

#### Scenario: 已指定 --lang 跳过语言问答
- **WHEN** 调用 `tasking init --lang en` 且 stdin 为 TTY
- **THEN** 跳过 Template language 问答，直接使用英文模板

#### Scenario: 语言选择决定模板文件
- **WHEN** 用户在交互式问答中选择 `English`
- **THEN** 使用所选 workflow 变体的英文版模板生成 `WORKFLOW.md`

#### Scenario: 选 English 种子 interface_language
- **WHEN** 以 `--lang en`（或交互选 `English`）完成 init
- **THEN** 生成的 WORKFLOW.md front matter 含 `interface_language: en`

#### Scenario: 选中文省略字段
- **WHEN** 以 `--lang zh`（或交互选 `中文`）完成 init
- **THEN** 生成的 WORKFLOW.md front matter 不含 `interface_language` 字段

#### Scenario: --update 只报告不写入
- **WHEN** 对不含 `interface_language` 的旧 WORKFLOW.md 运行 `init --update`
- **THEN** drift 报告列出该新字段及默认值 `zh`，文件未被写入
