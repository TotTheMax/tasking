## ADDED Requirements

### Requirement: 等待审批状态展示
任务的 turn 处于等待审批状态时，TUI 任务详情/运行中列表 SHALL 显示"等待审批"标记与剩余等待时间（依据 `permission_timeout_ms` 倒计时）；直连会话区块的运行中会话同样 SHALL 显示该状态。等待结束（回复/超时/中断）后 SHALL 恢复常规运行状态显示。

#### Scenario: 详情页显示等待审批倒计时
- **WHEN** 某任务的 turn 挂起等审批且剩余 12 分钟
- **THEN** 该任务详情显示"等待审批（剩 12m）"类标记

#### Scenario: 恢复运行显示
- **WHEN** 审批获准
- **THEN** 标记消失，恢复常规运行中显示
