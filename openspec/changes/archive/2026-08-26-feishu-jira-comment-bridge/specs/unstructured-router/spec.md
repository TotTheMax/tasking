## REMOVED Requirements

### Requirement: Route agent 分诊非结构化 inbox 条目
**Reason**: Feishu 不再当任务源；triage/route-agent 路径移除，改 CommentBridge 评论同步镜像（见 comment-bridge）。
**Migration**: 飞书消息经 REST 轮询 + binding 同步到 Jara comment；不再有"未分诊→Task"分诊。

### Requirement: Route agent 以 opencode plugin 暴露 inbox 工具
**Reason**: inbox triage 工具（`pop_untriaged`/`mark_decision`/`feishu.reply`）随 route-agent 一并移除。
**Migration**: 飞书回复由 `FeishuSource.reply`/`replyInThread`；不再有 inbox triage 工具。

### Requirement: Route agent 按 tick 有界且可触发
**Reason**: route-agent 移除；`tasking triage` 子命令桩移除。
**Migration**: 无替代（功能删除）。

### Requirement: 决策任务经共享 worker 路径派发
**Reason**: 幻影 `Task(source:"feishu")` 派发移除；飞书不再产生新任务。
**Migration**: 想从飞书建任务用 `/issue`（建真 Jara issue，经正常 scheduler 派发，见 comment-bridge）。

### Requirement: Inbox 幂等与持久
**Reason**: inbox-as-triage-buffer 移除；better-sqlite3+WAL 模式复用为 comment-bridge 的 binding store（带游标）。
**Migration**: 幂等/持久由 binding 表游标 + sentinel/`msg_id` 提供（见 comment-bridge）。
