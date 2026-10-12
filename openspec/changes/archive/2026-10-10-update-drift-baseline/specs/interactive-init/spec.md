## MODIFIED Requirements

### Requirement: Template language 选择问答
`tasking init` 交互式流程 SHALL 在未通过 `--lang` 显式指定语言时询问模板语言（「Template language」选择框，选项 `中文` 与 `English`，`中文` 在前作为回车默认）。已显式指定 `--lang` 时 SHALL 跳过此问答。所选语言 SHALL 与 workflow 选择正交，共同决定使用哪个模板文件（见 `cli-runtime`），并同时种子界面语言：选 `English` 时 SHALL 在生成的 WORKFLOW.md front matter 写入 `interface_language: en`；选 `中文` 时 SHALL 省略该字段（默认值 `zh`，遵循 generated-config-trimming 的只写非默认字段）。`init --update` 的漂移报告 SHALL NOT 将 `interface_language` 列为 zh 文件的缺失项（zh 漂移基线按生成器语义省略该字段）；en 文件的漂移基线 SHALL 含 `interface_language: en`，用户文件缺失该字段时 SHALL 照报。报告 SHALL NOT 写入该字段。

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

#### Scenario: --update 不把 zh 的 interface_language 列为缺失
- **WHEN** 对不含 `interface_language` 的 zh WORKFLOW.md 运行 `init --update`
- **THEN** 漂移报告不列出 `interface_language`（zh 生成基线按设计省略），文件未被写入
