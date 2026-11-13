## MODIFIED Requirements

### Requirement: token 与运行时记账正确性
daemon SHALL 从轮询数据提取 token 用量（消息级与会话级 tokens，合计口径为 input+output+reasoning，cache 不计入合计）,并 SHALL 跨已结束会话累积聚合 token 总量与运行时秒数,并 SHALL 在快照时加上活动会话的流逝时间。来自轮询的绝对总量 SHALL 以 delta 跟踪以避免重复计数。运行时总量 SHALL 在快照时作为实时聚合上报。

#### Scenario: 从轮询数据提取 token
- **WHEN** 轮询发现携带 tokens 的消息或会话终态
- **THEN** 按合计口径累加至聚合总量

#### Scenario: 跨会话累积聚合
- **WHEN** 某会话结束
- **THEN** 其运行时秒数与 token 总量加到累计已结束会话总量

#### Scenario: 快照含活动时间
- **WHEN** 有会话运行时取快照
- **THEN** 上报的运行时含活动会话流逝时间
