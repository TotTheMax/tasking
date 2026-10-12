## ADDED Requirements

### Requirement: 可选 model 与 variant 标志

worker SHALL 在构建 `opencode run` 命令时，仅当 `opencode.model` 非空时追加 `--model <model>` 参数，仅当 `opencode.variant` 非空时追加 `--variant <variant>` 参数。两个选项 SHALL 彼此独立，可只配其一或都不配。两者皆未配置时 SHALL NOT 追加任何对应参数，命令与改动前完全一致。

#### Scenario: 未配置 model 与 variant 时不追加参数
- **WHEN** `opencode.model` 与 `opencode.variant` 均为 `null`（或空串）
- **THEN** 构建的命令不包含 `--model` 或 `--variant` 参数，与既有命令完全一致

#### Scenario: 仅配置 model
- **WHEN** `opencode.model` 为 `anthropic/claude-sonnet-4-5` 且 `opencode.variant` 未配置
- **THEN** 构建的命令包含 `--model` 与 `anthropic/claude-sonnet-4-5`，不包含 `--variant`

#### Scenario: 仅配置 variant
- **WHEN** `opencode.variant` 为 `high` 且 `opencode.model` 未配置
- **THEN** 构建的命令包含 `--variant` 与 `high`，不包含 `--model`

#### Scenario: 同时配置 model 与 variant
- **WHEN** `opencode.model` 为 `anthropic/claude-sonnet-4-5` 且 `opencode.variant` 为 `high`
- **THEN** 构建的命令依次包含 `--model anthropic/claude-sonnet-4-5` 与 `--variant high`，位于 `--agent` 之后、prompt 之前
