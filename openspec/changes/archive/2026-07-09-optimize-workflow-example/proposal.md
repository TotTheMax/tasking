## Why

`WORKFLOW.md.example` 和 `init` 生成的 starter WORKFLOW.md 缺少多个已实现的配置字段(`auth_mode`、`assignee`、`server.host`、`logging.file` 等)，且无字段注释。新用户无法从示例理解全部可用配置，容易遗漏关键设置。

## What Changes

- `WORKFLOW.md.example` 补全全部配置字段，每个字段加内联注释说明用途、默认值、是否必填
- `src/cli/init.ts` 的 starter WORKFLOW.md 同步补全缺失字段(`auth_mode`、`assignee`、`server.host`、`logging`、`hooks.after_run`、`hooks.before_remove`)
- 两处配置示例保持字段一致，注释风格统一
- prompt body 补充 `jira_rest`/`jira_upload_attachment` 工具使用指引(与 init.ts 已有的指引对齐)

## Capabilities

### New Capabilities

(无)

### Modified Capabilities

- `workflow-prompt-optimization`: WORKFLOW.md.example 和 init starter 的配置字段覆盖与注释质量提升

## Impact

- `WORKFLOW.md.example` — 补全字段 + 内联注释
- `src/cli/init.ts` — starter 模板同步更新
- 无代码逻辑变更，仅模板内容
