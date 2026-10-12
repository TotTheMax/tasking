## ADDED Requirements

### Requirement: WORKFLOW.md.example 包含全部配置字段与注释
`WORKFLOW.md.example` SHALL 包含全部已实现的配置块(`tracker`、`polling`、`workspace`、`hooks`、`agent`、`opencode`、`router`、`feishu`、`server`、`logging`)及其全部字段。每个字段 SHALL 有 YAML `#` 内联注释说明用途。必填字段 SHALL 标注 `(必填)`。涉及密钥的字段 SHALL 注释提示用 `$VAR` 间接引用。

#### Scenario: 包含全部配置块
- **WHEN** 查看 `WORKFLOW.md.example` 的 front matter
- **THEN** 包含 `tracker`、`polling`、`workspace`、`hooks`、`agent`、`opencode`、`router`、`feishu`、`server`、`logging` 共 10 个配置块

#### Scenario: 每个字段有注释
- **WHEN** 查看 `WORKFLOW.md.example` 的任意配置字段
- **THEN** 该字段所在行或上方有 `#` 注释说明其用途

#### Scenario: 新增字段已包含
- **WHEN** 查看 `WORKFLOW.md.example`
- **THEN** 包含 `tracker.assignee`、`tracker.auth_mode`、`server.host`、`logging.file.path` 等新增字段

### Requirement: init starter 模板与 example 完全一致
`src/cli/init.ts` SHALL 读取 `WORKFLOW.md.example` 作为 starter 模板内容，生成的 WORKFLOW.md 与 example 完全一致（含全部字段、注释、prompt body）。不再维护独立的内联模板字符串。

#### Scenario: init 生成的文件与 example 一致
- **WHEN** 运行 `tasking init` 生成 WORKFLOW.md
- **THEN** 生成的文件内容与 `WORKFLOW.md.example` 完全相同

#### Scenario: init 生成的文件包含注释
- **WHEN** 查看 `tasking init` 生成的 WORKFLOW.md
- **THEN** 每个配置字段有 `#` 内联注释说明用途
