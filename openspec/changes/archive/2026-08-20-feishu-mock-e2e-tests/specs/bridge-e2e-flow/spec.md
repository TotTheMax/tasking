## ADDED Requirements

### Requirement: 修正后 mock 与真实飞书 API 形状一致
测试 mock SHALL 以真实飞书 IM API 形状构造响应，使测试验证的是"与真实 API 一致"而非"与错误假设一致"：`reply_in_thread` 响应 SHALL 返回 `thread_id`；`create_time` SHALL 用 13 位毫秒时间戳（由 `toSecondsStr` 归一化为秒）；`listMessages` 请求 SHALL 用 `container_id_type=chat`，`listThreadReplies` SHALL 用 `container_id_type=thread`，mock SHALL 按容器类型区分返回；消息 sender SHALL 含真实字段（`sender_id.open_id`、`sender_name`、`sender_type`）。

#### Scenario: reply_in_thread 响应返回 thread_id
- **WHEN** 测试 mock 响应 `replyInThread` 请求
- **THEN** 响应含 `thread_id`，且 bridge 将之持久化到 binding

#### Scenario: create_time 用 13 位毫秒并归一化为秒
- **WHEN** mock 消息 `create_time` 为 13 位毫秒字符串
- **THEN** `toSecondsStr` 将其归一化为 10 位秒字符串，cursor 比较用秒

#### Scenario: 容器类型区分 chat 与 thread
- **WHEN** mock 收到 `listMessages`（chat）与 `listThreadReplies`（thread）请求
- **THEN** 分别按 `container_id_type=chat` 与 `container_id_type=thread` 返回对应容器消息

#### Scenario: 消息 sender 含真实字段
- **WHEN** mock 构造消息对象
- **THEN** 含 `sender_id.open_id`、`sender_name`、`sender_type`，可被 `parsePolledMessage` 完整解析

### Requirement: 端到端全流程测试覆盖两个入口
端到端流程测试 SHALL 用修正后的 mock 覆盖完整链路：飞书入口（`/issue` 建 issue）与 Jira 入口（tracker 派发）两种方式创建 issue → agent 执行（mock worker）→ 飞书/Jira 修改状态 → agent 添加 Jira comment → forwardComments 桥到飞书话题 → 话题内人回复桥成 Jira comment → 完结 → binding 置 terminal。测试 SHALL 验证 cursor 推进、sentinel 去重、binding 生命周期。

#### Scenario: 飞书入口全流程
- **WHEN** intake 群收到 `/issue` 消息且后续状态流转到 terminal
- **THEN** 创建 Jira issue + binding、回执已创建、话题建立、状态可经 `/state` 流转、完结后 binding terminal

#### Scenario: Jira 入口全流程
- **WHEN** tracker 派发 Jira issue 且后续状态流转到 terminal
- **THEN** `onDispatch` 建立飞书话题与 binding、`onTerminate` 回执已完结、binding terminal

#### Scenario: cursor 推进与 sentinel 去重
- **WHEN** 同一周期内存在 sentinel（via 飞书）comment 与已处理消息
- **THEN** sentinel comment 不被回投、已处理消息不重复桥接、cursor 单调推进
