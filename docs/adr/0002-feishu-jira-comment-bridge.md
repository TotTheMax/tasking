# Feishu 群不再当任务源，改成 Jira 评论双向同步镜像（runtime 不动）

Feishu 不再是产生新任务的非结构化源——删 `RouteAgentRunner`、triage prompt、`TaskSource="feishu"` 幻影任务、`triage` 子命令桩。改成：Feishu 是**已存在 Jira issue 的评论同步镜像**。新增 sibling 组件 `CommentBridge`（自带 timer、依赖注入、与 scheduler 并列启停），双向镜像 Jira comment ⇄ Feishu 话题：Jara→飞书 转发 agent/人直发的评论；飞书→Jara 把人的自由文本桥成 Jira comment。按 issue 1:1 绑定到一个飞书话题(`root_id`)，一个指定 intake 群承载所有线程。`/issue` 建真 Jira issue（默认带 `tracker.required_labels`+`assignee`+`project_key`，锁死不可覆盖，否则过不了 `isRoutable`/`buildJql` 成孤儿），`/state` 转状态、`/help` 列命令。

理由：agent 已读写 Jira comment（grill Q、人答都走 Jira comment），所以"人的飞书输入以 Jira comment 到达"对 agent 透明、runtime 零改动——延展 ADR 0001 的"runtime 不动"边界到飞书侧。删 triage 是删复杂度：一个 intake 模型替代"每条飞书消息→幻影 feishu 任务"。`CommentBridge` 复用 `FeishuSource`（token 缓存、`reply()`）+ store 模式 + `JiraTracker.request()`（评论读写 / createIssue / fetchTransitions / transitionIssue 都走它）。

被否：① 给 agent 一个 `feishu.reply` MCP 让它直接发飞书（破 runtime 不动、agent 多一处副作用）；② 把同步塞进 scheduler（破单一职责 + 节奏冲突 5s vs 30s）。代价：飞书侧 binding 表 + 游标的状态性由 tasking 持有，不在 Jira。
