## ADDED Requirements

### Requirement: 冷启动探测建立 intake 初始游标
`CommentBridge.discoverIntake` 在 `intake_cursor` 为空（新机器 / 无 bindings.db）时，SHALL 先发一次不带时间参数的探测请求（服务端按默认返回最新一页），取返回项 `create_time` 的最大值作为初始游标写入 `bridge_meta.intake_cursor`，且本轮 SHALL 只记不处理（不建 issue、不回复 ack、不推进其他状态）。下一轮起按该游标正常增量轮询。空游标时 SHALL NOT 再回退到 24h 回看窗口。

#### Scenario: 新机器首次轮询建立游标
- **WHEN** `discoverIntake` 发现 `intake_cursor` 为空，且 intake 群存在历史消息
- **THEN** 发一次不带时间参数的探测请求，取 `max(create_time)` 写入 `intake_cursor`，本轮不处理任何消息、不回复 ack、不建 issue

#### Scenario: 探测后下一轮正常增量消费
- **WHEN** 初始游标已写入，intake 群在探测点之后出现新消息
- **THEN** 正常轮询消费游标之后的新消息（建 issue / ack / 命令各按既有分支处理）

#### Scenario: 空游标不回退 24h 回看
- **WHEN** `intake_cursor` 为空且无任何可探测消息
- **THEN** 游标保持为空，不按 24h 窗口拉取历史，不产生重放

### Requirement: 空游标不传 start_time
`FeishuSource` 的 `resolveStartTime` SHALL 在游标为空时返回空（不生成时间值），`listMessages` / `listThreadReplies` SHALL 在该情况下不传 `start_time` 参数，SHALL NOT 回退到"现在减 24 小时"。传了游标时 SHALL 仍归一化后作为 `start_time`。

#### Scenario: 空游标请求不带 start_time
- **WHEN** 调用 `listMessages(chatId, "")` 或 `listThreadReplies(threadId, "")`
- **THEN** 发出的请求 URL 不含 `start_time` 参数

#### Scenario: 有游标仍带 start_time
- **WHEN** 调用 `listMessages(chatId, "1700000000")`
- **THEN** 请求 URL 含 `start_time=1700000000`

### Requirement: 轮询分页
`listMessages` 与 `listThreadReplies` SHALL 处理飞书分页响应：响应含 `has_more=true` 时 SHALL 携带返回的 `page_token` 继续请求下一页，累积所有页的消息后返回；`has_more` 非真或 `page_token` 为空时 SHALL 停止。窗口内消息数超过单页上限（50）时 SHALL NOT 只取第一页。

#### Scenario: 多页消息全部返回
- **WHEN** 服务端对同一窗口返回两页（第一页 `has_more=true` 且带 `page_token`）
- **THEN** 两次请求分别带上正确的 `page_token`，最终返回两页全部消息

#### Scenario: 单页时不多请求
- **WHEN** 响应 `has_more=false`
- **THEN** 不发起后续分页请求，返回该页消息

## MODIFIED Requirements

### Requirement: 话题消息按游标增量拉取
`listThreadReplies` SHALL 接受 `since` 游标并作为 `start_time` 传给飞书 API 做服务端增量拉取（游标为空时 SHALL 不传 `start_time`）。`bridgeMessages` SHALL 按持久化游标跳过 `create_time <= 游标` 的消息，保证 daemon 重启后不重复桥接、不重复执行命令。分页按飞书响应处理。

#### Scenario: 重启后不重复桥接
- **WHEN** daemon 重启后 `bridgeMessages` 处理某话题，话题内存在 `create_time` 早于或等于持久化游标的人自由文本
- **THEN** 该文本不被再次桥成 Jira comment

#### Scenario: 重启后不重复执行命令
- **WHEN** daemon 重启后 `bridgeMessages` 处理某话题，话题内存在早于游标的命令消息
- **THEN** 该命令不被再次执行

#### Scenario: 增量拉取带 start_time
- **WHEN** 调用 `listThreadReplies(threadId, since)` 且 since 非空
- **THEN** 请求的 `start_time` 为 since 归一化后的秒数

#### Scenario: 空游标不传 start_time
- **WHEN** 调用 `listThreadReplies(threadId, "")`
- **THEN** 请求 URL 不含 `start_time` 参数

### Requirement: 轮询拉取会话消息
`FeishuSource.listMessages(chatId, sinceCursor)` 供 CommentBridge 轮询 intake 群消息，返回该游标之后的新文本消息（游标为空时按服务端默认返回最新一页，不传 `start_time`）。分页按飞书响应处理。

#### Scenario: 轮询拉取会话消息
- **WHEN** CommentBridge 调用 `listMessages(chatId, sinceCursor)` 且 sinceCursor 非空
- **THEN** 返回该会话 sinceCursor 之后的新文本消息（含分页累积）

#### Scenario: 空游标返回最新一页
- **WHEN** CommentBridge 调用 `listMessages(chatId, "")`
- **THEN** 请求不带 `start_time`，返回服务端默认的最新一页消息（供冷启动探测使用）
