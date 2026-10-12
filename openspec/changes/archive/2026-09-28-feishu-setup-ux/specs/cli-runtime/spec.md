# cli-runtime — delta

## MODIFIED Requirements

### Requirement: CLI 入口与子命令
`tasking` CLI SHALL 为单一入口,通过 npm 分发,可 `npx tasking` 调用。它 SHALL 支持子命令 `init`、`start`、`status`、`logs`、`stop`、`tui`、`doctor`。`start` SHALL 启动托管两个调度器的 daemon 进程;`doctor` SHALL 执行只读体检;其余子命令 SHALL 控制或观察运行中的 daemon。

#### Scenario: 无子命令
- **WHEN** `tasking` 不带子命令被调用
- **THEN** 打印用法并以非零码退出

#### Scenario: 未知子命令
- **WHEN** `tasking` 以未知子命令被调用
- **THEN** 打印错误并以非零码退出

#### Scenario: npx 执行
- **WHEN** 在 Node 22+ 且有网络的宿主机上调用 `npx tasking start`
- **THEN** daemon 启动,无需全局安装

## ADDED Requirements

### Requirement: doctor 子命令
`tasking doctor` SHALL 在当前目录执行全链路只读体检（WORKFLOW.md 解析、飞书 token+探针+intake 可达、Jira 连接、opencode PATH），中文输出逐项结果与末尾汇总表，退出码 `0`（全部通过）或 `1`（任一失败）。它 SHALL 出现在顶层 help 与子命令帮助中，且不接收参数、不执行写操作。

#### Scenario: help 列出 doctor
- **WHEN** 运行 `tasking help`
- **THEN** 命令清单包含 `doctor` 及其一句说明

#### Scenario: 无 WORKFLOW.md
- **WHEN** 在没有 WORKFLOW.md 的目录运行 `tasking doctor`
- **THEN** WORKFLOW 项标 ✗ 并提示先运行 `tasking init`，退出码 `1`
