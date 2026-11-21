## ADDED Requirements

### Requirement: feishu.direct.auto_continue 配置段

配置 SHALL 支持可选的 `feishu.direct.auto_continue` 段：

- `budget`：正整数，默认 `5`，合法范围 `1–20`；超出范围或非整数 SHALL 校验失败并指明字段。
- `no_progress_streak`：正整数，默认 `2`；非正数 SHALL 校验失败并指明字段。
- `prompt`：字符串，默认 `继续未完成的部分。不要重复已完成的内容，也不要总结。`；SHALL 去首尾空白后非空且 ≤ 2000 字，否则校验失败并指明字段。

该段缺失时 SHALL 使用上述全部默认值，且 SHALL NOT 默认开启 Auto-continue（必须由 `/loop` 显式开启）。该段 SHALL NOT 提供 `enabled` 开关。`agent.max_turns`（Jira worker）SHALL 保持原有语义，不受本段影响。

#### Scenario: 段缺失时全部默认

- **WHEN** WORKFLOW.md 不含 `feishu.direct.auto_continue`
- **THEN** effective config 的 budget=5、no_progress_streak=2、prompt=默认续跑文案；Auto-continue 仍为关闭，直到用户 `/loop`

#### Scenario: 合法配置被接受

- **WHEN** 配置写 `auto_continue: { budget: 8, no_progress_streak: 3, prompt: "继续实现并跑测试" }`
- **THEN** 解析结果保留这三个值

#### Scenario: budget 越界被拒绝

- **WHEN** `budget: 0` 或 `budget: 21` 或 `budget: 1.5`
- **THEN** 配置校验失败并指明 `feishu.direct.auto_continue.budget`

#### Scenario: streak 非正被拒绝

- **WHEN** `no_progress_streak: 0` 或负数
- **THEN** 配置校验失败并指明 `feishu.direct.auto_continue.no_progress_streak`

#### Scenario: prompt 为空或过长被拒绝

- **WHEN** `prompt: ""` 或超过 2000 字
- **THEN** 配置校验失败并指明 `feishu.direct.auto_continue.prompt`
