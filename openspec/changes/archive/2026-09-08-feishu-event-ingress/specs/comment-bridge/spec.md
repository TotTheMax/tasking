## MODIFIED Requirements

### Requirement: CommentBridge 是 scheduler 的 sibling 同步组件
CommentBridge SHALL 是独立于 scheduler 的组件，依赖注入 `JiraTracker`+`FeishuSource`+`BindingStore`+config+logger，在 `tasking start` 里与 scheduler 并列实例化与启停。CommentBridge SHALL NOT 阻塞或修改 scheduler 的派发/reconcile。其循环节奏 SHALL 拆分为二：forward 快循环（`feishu.forward_interval_ms`，默认 5s，仅跑 Jira→飞书评论转发）与 Sweep（`feishu.sweep_interval_ms`，默认 12h，另加"启动时"与"WS 重连成功时"两个触发点）。

#### Scenario: start 并列启停
- **WHEN** 运行 `tasking start`
- **THEN** CommentBridge 与 scheduler 各自启停、互不阻塞

#### Scenario: scheduler 不被桥阻塞
- **WHEN** CommentBridge 同步循环运行中
- **THEN** scheduler 继续独立轮询与派发

#### Scenario: 双节奏独立运转
- **WHEN** forward 快循环与 Sweep 同时配置
- **THEN** forward 以 `forward_interval_ms` 节奏只跑 Jira→飞书转发，Sweep 以 `sweep_interval_ms` 节奏只做补拉，互不拖慢对方

### Requirement: 入站事件驱动、Sweep 兜底、无公网端口
飞书入站 SHALL 以事件通道为主路径（见 `feishu-event-ingress` 能力）：`im.message.receive_v1` 事件实时入站队列处理。轮询逻辑 SHALL 降级为 Sweep 兜底清扫——经 `FeishuSource.listMessages`/`listThreadReplies` 按持久游标增量补拉——仅在 daemon 启动时、WS 重连成功时、`feishu.sweep_interval_ms` 定时器触发时执行。系统 SHALL 保持 outbound-only：无入站 HTTP server、无公网端口、不使用 webhook。`/issue` 发现在单一 intake 群内，SHALL NOT 扫描多个群。

#### Scenario: 无公网端口
- **WHEN** CommentBridge 运行
- **THEN** 不监听任何入站 HTTP 端口

#### Scenario: 主路径为事件推送
- **WHEN** 事件通道健康
- **THEN** 新消息从事件实时入队处理，Sweep 各轮均查空（游标无推进）

#### Scenario: Sweep 补回遗漏消息
- **WHEN** 某条消息未经过事件通道（绕过、静默丢失或 daemon 停机窗口内发出）
- **THEN** 下一次 Sweep（启动/重连/12h 定时器）按游标拉取并补处理，游标语义与既有行为一致（含 ADR 0016 冷启动探测）

#### Scenario: 配置键迁移
- **WHEN** WORKFLOW.md 中存在旧键 `feishu.poll_interval_ms`
- **THEN** validator 报错并提示改名为 `feishu.forward_interval_ms`；`feishu.sweep_interval_ms` 缺省时取默认 12h
