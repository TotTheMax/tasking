## Context

当前 `WORKFLOW.md.example` 的 prompt body 存在三处脱节：

1. **技能脱节**：模板步骤 2-3 用原始 `git add -A && git commit` / `git push` 命令，但 tasking 已实现 5 个技能（commit/pull/push/debug/land）。agent 不会自动使用技能除非模板引导。
2. **状态脱节**：`tracker.review_state` 在 `TrackerConfig` 中定义并解析，但 scheduler/worker 从不读取——是死字段。模板写 "Transition to review state" 但不告诉 agent 具体状态名。同时模板不注入 `terminal_states`，agent 不知道哪些状态不能自行 transition。
3. **工具指南脱节**：jira_rest 和 jira_upload_attachment 的使用说明内联在模板正文中，篇幅长且不可复用。应抽成独立 `jira` 技能。

约束：
- Liquid 引擎（`src/worker/prompt.ts`）非常精简：只支持 `{{ var.path | filter }}`、`{% if %}` / `{% else %}` / `{% endif %}`，不支持 `{% for %}` 循环、`{% assign %}`、带参数的 filter。
- `prompt.test.ts` 必须保持绿色——模板改动需同步更新测试。
- WORKFLOW.md.example 的 front matter（YAML 配置）与 prompt body（Liquid 模板）用 `---` 分隔。

## Goals / Non-Goals

**Goals:**
- 模板引用全部 6 个技能（pull/commit/push/debug/land/jira）替代原始命令和内联示例
- 移除 `review_state` 死字段（类型、解析器、配置、spec）
- 注入 `terminal_states` 让 agent 知道哪些状态不可自行 transition
- 新增 `jira` 技能，将工具使用指南从模板抽离
- 保持 Liquid 引擎不变——不新增 `for` 循环支持
- 测试覆盖所有变更

**Non-Goals:**
- 不改 Liquid 引擎（不加 `for` 循环、不加 filter 参数）
- 不改 scheduler 逻辑（`active_states`/`terminal_states` 的使用方式不变）
- 不改 MCP 工具实现（jira_rest / jira_upload_attachment 不变）
- 不改技能注入机制（仍由仓库 `.opencode/skills/` 自带，非代码注入）

## Decisions

### D1: terminal_states 预 join 为逗号分隔字符串

**选择**：在 `renderPrompt` 调用点将 `string[]` 预 join 为 `"Done, Closed, Cancelled"` 字符串，注入 `RenderContext.terminal_states`。

**理由**：Liquid 引擎不支持 `{% for %}` 循环。数组直接 `{{ arr }}` 会被 `JSON.stringify` 渲染成 `["Done","Closed"]`，可读性差且不自然。预 join 是最小改动方案。

**替代方案**：
- 给 Liquid 引擎加 `for` 循环——改动大，影响面广，`prompt.test.ts` 全部要改
- 加 `join` filter 并支持 filter 参数——引擎的 filter 解析用 `split("|")`，不支持 `:`参数语法，改动也不小
- 直接传数组让 `JSON.stringify` 渲染——可读性差

### D2: 移除 review_state，agent 自行查 transitions

**选择**：删除 `TrackerConfig.review_state` 字段、`resolveTracker` 中的解析行、`DEFAULTS.tracker.review_state`、`WORKFLOW.md.example` front matter 中的 `review_state` 行。模板不再提 "review state"，改为让 agent 用 `jira` 技能查 transitions 自行判断。

**理由**：`review_state` 从未被程序逻辑使用（grep 确认只在 config 层）。agent 已有 `jira_rest` 工具可查 transitions 并按名称选择。模板只需告诉 agent "不要 transition 到终态"。

**替代方案**：
- 保留字段但真正注入模板——增加模板复杂度，且字段语义模糊（不同 Jira 部署审查态名不同）
- 保留字段但不注入——维持现状的死字段，不解决问题

### D3: 新增 jira 技能，抽离模板内联示例

**选择**：创建 `assets/skills/jira/SKILL.md`，包含 jira_rest 和 jira_upload_attachment 的完整使用指南。模板正文只写 "use the `jira` skill for Jira interactions"。

**理由**：
- 技能可独立维护，不增加模板篇幅
- 与现有 5 个技能的模式一致（技能在 `.opencode/skills/` 中，随 git clone 进入 workspace）
- agent 可按需查阅，不在 prompt 中占 token

**替代方案**：
- 保留内联示例——模板过长，token 消耗大，维护时需改两处

### D4: RenderContext 新增 terminal_states 字段

**选择**：
```typescript
export interface RenderContext {
  task: Task;
  attempt: number | null;
  terminal_states: string;  // 预 join: "Done, Closed, Cancelled"
}
```

`renderPrompt` 签名扩展为接受 `terminal_states` 参数。调用点（`runner.ts`）从 `config.tracker.terminal_states` 取数组，`.join(", ")` 后传入。

**理由**：只注入 `terminal_states` 不注入 `active_states`——agent 已知当前状态（`task.state`），只需知道哪些状态不能自行 transition。`active_states` 对 agent 无直接用途。

### D5: 模板结构重写

**选择**：prompt body 新结构：
```
You are a coding agent working on: {{ task.identifier }} - {{ task.title }}

{% if task.description %}
## Description
{{ task.description }}
{% endif %}

## Skills available
- pull, commit, push, debug, land, jira

## Workflow
{% if attempt %}
This is attempt {{ attempt }}. Check git status/log. Continue unfinished work.
If you have an open MR, use the `land` skill.
If stuck, use the `debug` skill.
{% else %}
This is the first attempt. Use the `pull` skill to sync, then start working.
{% endif %}

### For code tasks:
1. pull (sync branch)
2. make changes
3. commit (conventional format)
4. push (create MR)
5. jira skill: query transitions, transition to review state, add comment, add label
6. Do NOT transition to terminal states ({{ terminal_states }})

### For non-code tasks:
1. Complete the work
2. jira skill: add comment, query transitions, transition directly to Done
```

**理由**：简洁，每步引用技能名，不再内联 git 命令和 jira_rest 示例。`{{ terminal_states }}` 直接渲染预 join 字符串。

### D6: buildContinuationGuidance 同步引用技能

**选择**：`buildContinuationGuidance` 函数（`src/worker/prompt.ts:176`）的续轮指引文本中引用 `debug` 和 `land` 技能，与模板的重试分支保持一致。

**理由**：续轮指引在 worker 内 turn 2+ 使用，应与模板语言风格一致。

## Risks / Trade-offs

- **[BREAKING: review_state 删除]** → 已有用户配置中写了 `review_state` 的会被忽略（YAML 多余字段不报错，但语义消失）。在 `docs/configuration.md` 标注移除。用户需删除该行。
- **[模板大改：prompt.test.ts 需大量更新]** → 所有引用旧模板结构的测试用例需重写。新测试覆盖 terminal_states 注入、技能引用、attempt 分支。
- **[jira 技能依赖 agent 按需查阅]** → 模板只引用技能名，不内联用法。agent 需主动查阅 SKILL.md。opencode 的技能系统支持这一点。
- **[terminal_states 预 join 的可读性]** → 预 join 字符串 `"Done, Closed, Cancelled"` 在模板中自然可读，但如果状态名含逗号会出错——Jira 状态名不含逗号，风险极低。
