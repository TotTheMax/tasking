## ADDED Requirements

### Requirement: Template language 选择问答
`tasking init` 交互式流程 SHALL 在未通过 `--lang` 显式指定语言时询问模板语言（「Template language」选择框，选项 `中文` 与 `English`，`中文` 在前作为回车默认）。已显式指定 `--lang` 时 SHALL 跳过此问答。所选语言 SHALL 与 workflow 选择正交，共同决定使用哪个模板文件（见 `cli-runtime`）。

#### Scenario: 未指定 --lang 时询问语言
- **WHEN** stdin 为 TTY 且未指定 `--lang` 时调用 `tasking init`
- **THEN** 交互式弹出 Template language 选择框（`中文` / `English`）

#### Scenario: 已指定 --lang 跳过语言问答
- **WHEN** 调用 `tasking init --lang en` 且 stdin 为 TTY
- **THEN** 跳过 Template language 问答，直接使用英文模板

#### Scenario: 语言选择决定模板文件
- **WHEN** 用户在交互式问答中选择 `English`
- **THEN** 使用所选 workflow 变体的英文版模板生成 `WORKFLOW.md`

## MODIFIED Requirements

### Requirement: workflow 选择问答
`tasking init` 交互式流程 SHALL 询问使用哪个 workflow，选项为 `default`、`code-mr` 与 `grill-openspec`。当用户已通过 `--workflow` 指定时 SHALL 跳过此问答。所选 workflow SHALL 决定使用哪个模板生成 `WORKFLOW.md`（见 `cli-runtime`）；模板语言由独立的 Template language 问答或 `--lang` 决定。

#### Scenario: 未指定 --workflow 时询问
- **WHEN** stdin 为 TTY 且未指定 `--workflow` 时调用 `tasking init`
- **THEN** 交互式询问选择 workflow（`default` / `code-mr` / `grill-openspec`）

#### Scenario: 已指定 --workflow 跳过问答
- **WHEN** 调用 `tasking init --workflow grill-openspec` 且 stdin 为 TTY
- **THEN** 跳过 workflow 选择问答，直接用 grill-openspec 模板

#### Scenario: 选择决定模板
- **WHEN** 用户在交互式问答中选择 `code-mr`
- **THEN** 使用所选语言的 code-mr 模板生成 `WORKFLOW.md`
