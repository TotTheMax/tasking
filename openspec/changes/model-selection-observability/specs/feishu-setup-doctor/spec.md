## ADDED Requirements

### Requirement: 模型解析检查

doctor SHALL 包含模型解析检查项，探测经 `opencode api`（`model.default`/`model.list`，以 workspace root 为目录上下文，带超时）：`opencode.model` 已配置时 SHALL 显示配置值并经 `model.list` 校验该模型仍可用——失效时检查 **fail**（说明任务将在此模型上失败）；未配置时 SHALL 显示 `model.default` 的实际解析值并 **warn** 未配置走服务端默认、目录更新可能漂移；探测失败或超时 SHALL **info** 降级，不算体检失败。检查详情 SHALL 提示完整模型列表的查询方式（`opencode api model.list`）。

#### Scenario: 配置有效

- **WHEN** `opencode.model` 配置为 A 且 `model.list` 包含 A
- **THEN** 检查 pass，详情显示配置值 A

#### Scenario: 配置失效

- **WHEN** `opencode.model` 配置为 A 且 `model.list` 不含 A
- **THEN** 检查 fail，详情说明该模型已不可用

#### Scenario: 未配置

- **WHEN** `opencode.model` 为 null 且探测解析值为 X
- **THEN** 检查 warn，详情显示"实际会解析为 X"及漂移风险提示

#### Scenario: opencode 不可达

- **WHEN** 模型探测调用失败或超时
- **THEN** 检查 info 降级，不影响体检整体结论
