## ADDED Requirements

### Requirement: workflow 选择问答
`tasking init` 交互式流程 SHALL 询问使用哪个 workflow，选项为 `default` 与 `grill-openspec`。当用户已通过 `--workflow` 指定时 SHALL 跳过此问答。所选 workflow SHALL 决定使用哪个模板生成 `WORKFLOW.md`（见 `cli-runtime`）。

#### Scenario: 未指定 --workflow 时询问
- **WHEN** stdin 为 TTY 且未指定 `--workflow` 时调用 `tasking init`
- **THEN** 交互式询问选择 workflow（`default` / `grill-openspec`）

#### Scenario: 已指定 --workflow 跳过问答
- **WHEN** 调用 `tasking init --workflow grill-openspec` 且 stdin 为 TTY
- **THEN** 跳过 workflow 选择问答，直接用 `grill-openspec` 模板

#### Scenario: 选择决定模板
- **WHEN** 用户在交互式问答中选择 `grill-openspec`
- **THEN** 使用 `WORKFLOW.grill-openspec.md.example` 模板生成 `WORKFLOW.md`
