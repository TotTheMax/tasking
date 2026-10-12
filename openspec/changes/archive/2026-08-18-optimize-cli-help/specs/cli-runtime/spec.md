## ADDED Requirements

### Requirement: 顶层 help 含命令说明
`tasking --help` 与 `tasking help`（无目标时）SHALL 输出到 stdout 并以 0 退出。help SHALL 包含 `tasking` 一句话简介、用法行、命令列表（每个公开子命令 `init`/`start`/`status`/`logs`/`stop`/`tui` 附一句话说明）、选项（`-h, --help`）、以及“详情见 `tasking <cmd> --help`”的指引。命令说明 SHALL 为英文。

#### Scenario: tasking --help
- **WHEN** 调用 `tasking --help` 或 `tasking -h`
- **THEN** 输出到 stdout、退出码 0，且文本含 `init`/`start`/`status`/`logs`/`stop`/`tui` 及 `--help`

#### Scenario: tasking help 无目标
- **WHEN** 调用 `tasking help`
- **THEN** 输出与 `tasking --help` 相同的顶层 help、退出码 0

### Requirement: 子命令帮助
每个公开子命令 `init`/`start`/`status`/`logs`/`stop`/`tui` SHALL 支持 `--help|-h`，`init`/`start`/`status`/`logs`/`stop`/`tui` SHALL 可通过 `tasking help <cmd>` 查看。子命令帮助 SHALL 输出到 stdout、退出码 0，并包含该命令的用法行、参数/选项说明（含短选项与默认值）。`triage` SHALL NOT 出现在任何帮助文本中。

#### Scenario: 子命令 --help
- **WHEN** 调用 `tasking init --help`、`tasking start -h`、`tasking status --help`、`tasking logs --help`、`tasking stop --help`、`tasking tui --help`
- **THEN** 各自打印对应命令帮助到 stdout、退出码 0

#### Scenario: help 加目标命令
- **WHEN** 调用 `tasking help logs`（或其他公开子命令名）
- **THEN** 打印该命令的帮助到 stdout、退出码 0

#### Scenario: help 后跟未知命令
- **WHEN** 调用 `tasking help bogus`
- **THEN** 打印错误到 stderr、退出码 1，且不打印 `triage`

#### Scenario: 帮助文本不含 triage
- **WHEN** 检查 `tasking --help` 与任一子命令帮助文本
- **THEN** 文本中不包含 `triage`
