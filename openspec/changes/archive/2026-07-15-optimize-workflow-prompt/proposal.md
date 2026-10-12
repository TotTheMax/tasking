## Why

WORKFLOW.md.example 的 prompt body 与当前系统能力脱节：模板仍用原始 git 命令而非已实现的技能（commit/pull/push/debug/land）；`tracker.review_state` 是死字段——解析了但程序逻辑从不读取；模板引用 "review state" 但 agent 不知道具体状态名；jira_rest 的使用说明散落在模板正文中，应抽成一个独立技能以便复用与维护。此外，模板没有注入 `terminal_states`，agent 不知道哪些状态不该自己 transition 过去。

## What Changes

- **BREAKING**: 移除 `tracker.review_state` 配置字段——从 `TrackerConfig` 类型、`resolveTracker` 解析器、`WORKFLOW.md.example` front matter、相关 spec 中删除。agent 改为自行查询 transitions 并按名称选择审查态。
- 新增 `jira` 技能（`assets/skills/jira/SKILL.md`），将 jira_rest 和 jira_upload_attachment 工具的使用指南从模板正文抽离为独立技能：查 transitions、转状态、读/加评论、读/加标签、读/上传附件。技能包含完整 API 路径示例。
- 扩展 `RenderContext`（`src/worker/prompt.ts`），注入 `terminal_states`（预 join 逗号分隔字符串），让模板能告诉 agent 哪些状态是终态、不可自行 transition。Liquid 引擎不支持 `for` 循环，所以预 join 是必要方案。
- 重写 `WORKFLOW.md.example` prompt body：
  - 引用 `pull`/`commit`/`push`/`debug`/`land`/`jira` 技能替代原始 git 命令和内联 jira_rest 示例
  - 用 `{{ terminal_states }}` 告诉 agent 禁止转入的终态
  - 移除 `review_state` 相关语言
  - 优化 workflow 步骤结构（首次 attempt 引用 pull+commit+push+jira；重试 attempt 引用 land+debug+jira）
- 补充 `buildContinuationGuidance` 中的技能引用，使其与模板一致
- 更新 `WORKFLOW.md.example` front matter：删除 `review_state` 行
- 更新 `DEFAULTS`（`src/config/config-types.ts`）：删除 `review_state` 默认值
- 全面测试：prompt 渲染测试（含 terminal_states 注入）、技能测试（jira 技能内容验证）、config 测试（review_state 已删除）

## Capabilities

### New Capabilities

（无——`jira` 技能归入已有的 `opencode-skills` 能力）

### Modified Capabilities

- `workflow-prompt-optimization`: 移除 review_state 引用；模板引用全部技能；注入 terminal_states；重写 workflow 步骤结构
- `opencode-skills`: 新增 `jira` 技能需求（jira_rest + jira_upload_attachment 使用指南）
- `opencode-worker`: `RenderContext` 新增 `terminal_states` 字段；`renderPrompt` 接受配置参数
- `jira-tracker`: 移除 `review_state` 配置字段

## Impact

- **配置**：`WORKFLOW.md.example` front matter 删除 `review_state` 行——已有用户配置需删除此字段（BREAKING）
- **代码**：`src/worker/prompt.ts`（RenderContext + renderPrompt 签名）、`src/worker/runner.ts`（传参）、`src/config/config-types.ts`（TrackerConfig 删字段）、`src/config/resolver.ts`（resolveTracker 删解析）
- **技能**：新增 `assets/skills/jira/SKILL.md`
- **模板**：`WORKFLOW.md.example` prompt body 重写
- **测试**：`tests/prompt.test.ts`、`tests/skills.test.ts`、`tests/config.test.ts`、`tests/worker.test.ts` 需更新
- **文档**：`docs/configuration.md`、`docs/usage.md`、`docs/skills.md` 需同步更新
