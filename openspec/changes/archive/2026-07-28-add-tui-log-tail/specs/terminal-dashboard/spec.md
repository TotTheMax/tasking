## MODIFIED Requirements

### Requirement: 终端 TUI 状态面板
daemon SHALL 提供可选的终端 TUI 状态面板,通过 ANSI 转义码在 stderr 上渲染只读状态画面。TUI SHALL 定时(默认 1s)拉取运行时快照并重绘。TUI SHALL 在 overview 底部渲染 Logs 区块,显示最近日志条目并按 level 着色。TUI SHALL NOT 接收键盘输入——它是纯只读显示面。TUI SHALL NOT 参与编排器正确性。

#### Scenario: TUI 渲染运行中任务
- **WHEN** TUI 启用且有任务运行
- **THEN** 渲染运行中任务表格,含标识符、状态、运行时长、turn 计数、token 总量、session ID、最近事件

#### Scenario: TUI 渲染退避队列
- **WHEN** TUI 启用且有 retry 队列
- **THEN** 渲染退避队列,含标识符、attempt、倒计时、错误摘要

#### Scenario: TUI 渲染汇总栏
- **WHEN** TUI 启用
- **THEN** 渲染汇总:agent 数量/上限、吞吐量 tps、运行时长、token in/out/total

#### Scenario: TUI 渲染日志尾部
- **WHEN** TUI 启用且 LogRingBuffer 有日志条目
- **THEN** overview 底部渲染 `├─ Logs` 区块,显示最近 6 条日志,按 level 着色(error 红、warn 黄、info 默认、debug 暗灰),每条显示时间戳(短格式)、level、消息(截断至终端宽度)

#### Scenario: TUI 无日志缓冲时跳过 Logs 区块
- **WHEN** TUI 启用但未注入 LogRingBuffer
- **THEN** overview 不渲染 Logs 区块

#### Scenario: 内容无变化不重绘
- **WHEN** 快照内容与前次渲染相同且未超过周期性重绘间隔
- **THEN** 不重绘(节流去重)

#### Scenario: TUI 不参与正确性
- **WHEN** TUI 不可用或渲染出错
- **THEN** 编排不受影响地继续

## REMOVED Requirements

### Requirement: TUI 渲染汇总栏中的 rate-limit 显示
**Reason**: `rate_limits` 从未被填充（Jira DC 不返回限流头），始终显示 `unavailable`，为死功能
**Migration**: 无需迁移，该字段从未有实际值
