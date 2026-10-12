# agent-selection Specification (delta)

## ADDED Requirements

### Requirement: 模板文档化 agents 目录

workflow starter 模板（`WORKFLOW.md.example`、`WORKFLOW.code-mr.md.example`、`WORKFLOW.grill-openspec.md.example`）的 `opencode` 块 SHALL 文档化 `agents` 目录字段（缺省 `[]`），使 `tasking init` 后用户能看到可用 agent 的默认配置。`agents` 缺省为空数组时 SHALL 不产生任何校验（与运行时 `DEFAULTS.opencode.agents` 一致）。

#### Scenario: 模板可见 agents 默认配置
- **WHEN** 用户查看任一 starter 模板的 `opencode` 块
- **THEN** 可见 `agents: []` 字段及说明注释，`opencode.agent` 兜底默认保留
