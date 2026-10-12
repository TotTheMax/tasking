# workflow-template-agent-catalog Specification

## Purpose
TBD - created by archiving change workflow-template-agent-catalog. Update Purpose after archive.
## Requirements
### Requirement: 模板 opencode 块含 agents 目录字段

每个 workflow starter 模板（`WORKFLOW.md.example`、`WORKFLOW.code-mr.md.example`、`WORKFLOW.grill-openspec.md.example`）的 `opencode` 块 SHALL 提供 `agents` 字段（字符串数组），作为已知 opencode agent profile 的咨询性目录，缺省为 `[]`（空目录＝不校验，任何 `agent:<name>` 直通）。`agents` 字段 SHALL 附带注释说明其语义（可选、咨询性、供 `/agent` 命令展示并对未知名提示、不作硬白名单），且与 `opencode.agent`（兜底默认，如 `build`）并存。模板 SHALL NOT 将 `agents` 设为非空默认值（保持与 `DEFAULTS.opencode.agents = []` 一致，避免 init 后出现未经用户同意的校验行为）。

#### Scenario: 三个模板均含空 agents 默认
- **WHEN** 查看 `WORKFLOW.md.example`、`WORKFLOW.code-mr.md.example`、`WORKFLOW.grill-openspec.md.example` 的 `opencode` 块
- **THEN** 三者均含 `agents: []` 及说明注释，`agent: build` 兜底默认保留

#### Scenario: 默认空目录不校验
- **WHEN** 用户 `tasking init` 后不修改 `agents`
- **THEN** `opencode.agents` 解析为空数组，任何 `agent:<name>` 标签直通使用（与 `DEFAULTS` 一致）

