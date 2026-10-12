## ADDED Requirements

### Requirement: 终端 TUI 状态面板
daemon SHALL 提供可选的终端 TUI 状态面板,通过 ANSI 转义码在 stderr 上渲染只读状态画面。TUI SHALL 定时(默认 1s)拉取运行时快照并重绘。TUI SHALL NOT 接收键盘输入——它是纯只读显示面。TUI SHALL NOT 参与编排器正确性。

#### Scenario: TUI 渲染运行中任务
- **WHEN** TUI 启用且有任务运行
- **THEN** 渲染运行中任务表格,含标识符、状态、运行时长、turn 计数、token 总量、session ID、最近事件

#### Scenario: TUI 渲染退避队列
- **WHEN** TUI 启用且有 retry 队列
- **THEN** 渲染退避队列,含标识符、attempt、倒计时、错误摘要

#### Scenario: TUI 渲染汇总栏
- **WHEN** TUI 启用
- **THEN** 渲染汇总:agent 数量/上限、吞吐量 tps、运行时长、token in/out/total、rate-limit(若可用)

#### Scenario: 内容无变化不重绘
- **WHEN** 快照内容与前次渲染相同且未超过周期性重绘间隔
- **THEN** 不重绘(节流去重)

#### Scenario: TUI 不参与正确性
- **WHEN** TUI 不可用或渲染出错
- **THEN** 编排不受影响地继续

### Requirement: TUI 吞吐量 sparkline
TUI SHALL 在汇总栏渲染一个 sparkline 吞吐量趋势图(最近 10 分钟),使用块字符 `▁▂▃▄▅▆▇█`。sparkline SHALL 按时间窗口分桶计算平均 tps。

#### Scenario: sparkline 反映趋势
- **WHEN** 有 token 消耗历史
- **THEN** sparkline 显示 24 列桶状图,高度与各桶 tps 成正比

### Requirement: TUI 与日志互不干扰
TUI 启用时,结构化日志 SHALL NOT 写入 stderr(避免被 TUI 清屏覆盖),SHALL 仅写入文件 sink。TUI 未启用时,日志 SHALL 继续写入 stderr。

#### Scenario: TUI 启用时日志走文件
- **WHEN** TUI 启用
- **THEN** stderr 仅用于 TUI 渲染,日志行写入文件 sink

#### Scenario: TUI 未启用时日志走 stderr
- **WHEN** TUI 未启用
- **THEN** 日志行写入 stderr
