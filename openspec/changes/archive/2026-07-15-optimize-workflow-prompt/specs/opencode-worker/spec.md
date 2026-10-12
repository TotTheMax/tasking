## MODIFIED Requirements

### Requirement: 严格变量的 prompt 渲染
worker SHALL 使用严格模板引擎渲染 `WORKFLOW.md` prompt 模板,以 `task`(或 `issue`)、`attempt` 与 `terminal_states` 为输入变量。未知变量 SHALL 导致渲染失败。未知 filter SHALL 导致渲染失败。渲染失败 SHALL 导致当前 attempt 失败。`terminal_states` SHALL 为预 join 的逗号分隔字符串(如 `"Done, Closed, Cancelled"`),由 `renderPrompt` 调用点从 `config.tracker.terminal_states` 数组 `.join(", ")` 后传入。

#### Scenario: 渲染 task、attempt 与 terminal_states
- **WHEN** 渲染首次 attempt
- **THEN** 模板收到 task 对象、`attempt` 为 null/缺失、`terminal_states` 为逗号分隔的终态名称字符串

#### Scenario: terminal_states 从配置数组预 join
- **WHEN** `config.tracker.terminal_states` 为 `["Done", "Closed"]` 且渲染 prompt
- **THEN** `RenderContext.terminal_states` 为 `"Done, Closed"`

#### Scenario: 未知变量失败
- **WHEN** 模板引用未定义变量
- **THEN** 渲染失败,attempt 失败
