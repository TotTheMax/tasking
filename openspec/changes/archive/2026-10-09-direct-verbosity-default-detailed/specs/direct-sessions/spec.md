## MODIFIED Requirements

### Requirement: 每 turn 一条总结消息（verbosity 可选）
用户消息入队时系统 SHALL 立即给出可见反馈；turn 结束后系统 SHALL 在话题内发送恰好一条结果：最后一刻 assistant 文本 + 一行统计（耗时、工具调用次数、token 用量）。`summary` 与 `quiet` 下结果 SHALL 为文本消息（quiet 省略统计行、仅正文 + 权限拒绝提示），超长时截断。`feishu.direct.verbosity: detailed`（**默认**）下系统 SHALL 为该 turn 创建并原地更新一张轮次卡片（见"每 turn 一张轮次卡片"），结果 SHALL 以**结果卡片**投递：完整 assistant 文本按 markdown 渲染（标题/粗体/表格/代码块）+ 统计行；结果超出卡片预算时 SHALL 改为把完整文本作为 `.md` 文件附件发到话题，附件不可用则降级为长文本，仍装不下则提示去 TUI 活动视图。任何 verbosity 下系统 SHALL NOT 再为单个工具调用单独发送文本消息；detailed 下轮次卡片 SHALL NOT 复述最终 assistant 文本（它由结果卡片承载），只保留中间步骤文本。轮次卡片的折叠面板需飞书/Lark 客户端 ≥ V7.9 渲染；更低版本显示「请升级」占位符（ SHALL NOT 崩溃或影响结果投递），该版本要求 SHALL 写入模板注释与双语文档，`verbosity: summary` 是显式回退。

#### Scenario: summary 模式的交付形状
- **WHEN** verbosity=summary 的会话完成一次成功的 turn
- **THEN** 话题内只新增一条 bot 消息，含 assistant 最终文本与一行统计

#### Scenario: detailed 模式的交付形状（含默认）
- **WHEN** verbosity=detailed（含未配置 verbosity 的缺省情形）的会话完成一次含 3 个工具调用的 turn
- **THEN** 话题内新增一张承载这 3 个工具明细的轮次卡片与一张 markdown 结果卡片，且不存在逐个工具的单条文本消息

#### Scenario: 超长回答改为文件投递
- **WHEN** detailed 下某轮的回答超出卡片预算
- **THEN** 完整回答以 `.md` 文件附件发到话题；附件不可用时降级为长文本

#### Scenario: turn 超时
- **WHEN** 某 turn 触发 wall_clock 或 inactivity 超时
- **THEN** 系统在话题内报告中断原因，会话转入可继续追问状态

### Requirement: feishu.direct 零配置默认可用
`feishu.enabled` 为 true 时直连功能 SHALL 默认启用（`feishu.direct` 段缺失 = 全默认值；段内显式 `enabled: false` 关闭）。`projects` 可为空（path 模式即可用）。所有其他项 SHALL 有合理默认值：`path_roots: []`、`auto_approve: false`、`verbosity: detailed`、`max_concurrent: 5`、`idle_ttl_ms: 30 天`。

#### Scenario: 零配置 path 模式可用
- **WHEN** WORKFLOW.md 的 feishu 段不含 `direct` 子块（feishu.enabled: true）
- **THEN** 直连默认启用，`/chat /绝对路径 <消息>` 直接可用，无需任何新增配置

#### Scenario: 两行配置启用项目名模式
- **WHEN** WORKFLOW.md 的 feishu 段仅含 `direct: { projects: { tasking: /repos/tasking } }`
- **THEN** 解析后的配置填满所有默认值，`/chat tasking …` 可用

#### Scenario: 显式关闭
- **WHEN** `feishu.direct.enabled: false`
- **THEN** 直连不激活，`/chat` 按未知命令处理
