## ADDED Requirements

### Requirement: 版本查询

`tasking` CLI SHALL 支持顶层 flag `--version` 与 `-v`，在子命令分发之前处理。命中时 SHALL 向 stdout 打印 `package.json` 的 `version` 字段（裸 semver，无名称前缀、无样式、无颜色），随后以退出码 0 结束，不执行任何其他动作。读取失败时 SHALL 打印 `unknown` 并仍以退出码 0 结束。顶层帮助文本 SHALL 在 Options 区列出该 flag。该 flag 仅在子命令位置（`argv` 首个参数）生效。

#### Scenario: 长形式查询版本

- **WHEN** 调用 `tasking --version`
- **THEN** stdout 输出一个裸 semver（形如 `0.6.17`）加换行，退出码为 0

#### Scenario: 短形式查询版本

- **WHEN** 调用 `tasking -v`
- **THEN** 行为与 `--version` 完全一致

#### Scenario: 帮助文本露出

- **WHEN** 调用 `tasking --help`
- **THEN** Options 区包含 `--version` 与 `-v` 的说明行

### Requirement: doctor 输出自身版本

`tasking doctor` SHALL 在输出头部第一行显示 tasking 自身版本（形如 `tasking <semver>`），使运维者粘贴的体检报告自带版本信息。版本读取失败时 SHALL 显示 `tasking unknown` 且不影响其余体检项。

#### Scenario: doctor 头部版本行

- **WHEN** 调用 `tasking doctor`（体检环境可用或部分可用）
- **THEN** 输出第一行为 `tasking ` 后跟 semver 版本号
