## ADDED Requirements

### Requirement: 任务条目模型字段反映解析模型

调度器运行条目的 model 状态 SHALL 反映最新已知的解析模型：`turn_started` 事件仍以配置值作为初值写入；收到 `model_resolved` 事件（或携带模型的 turn 完成事件）时 SHALL 将条目 model 更新为解析模型。TUI 与 HTTP dashboard 经既有状态通道展示该值，无需各自探测。

#### Scenario: 首轮解析后条目刷新

- **WHEN** 任务未配置 model，条目 model 初值为 null，随后收到 `model_resolved` 事件携带 `zhipuai-coding-plan/glm-5.3`
- **THEN** 条目 model 更新为该解析模型，dashboard 状态随之显示实际值

#### Scenario: 已配置时事件与配置值一致

- **WHEN** 任务配置 `opencode.model` 为 A 且解析模型亦为 A
- **THEN** 条目 model 保持 A，无可见变化

#### Scenario: 配置值与解析值不一致时以解析值为准

- **WHEN** 配置 model 为 A，但 `model_resolved` 事件携带 B
- **THEN** 条目 model 更新为 B
