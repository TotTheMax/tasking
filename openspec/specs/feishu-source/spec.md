## Purpose

飞书 IM 适配器：收件箱、事件处理、消息归一化。
## Requirements
### Requirement: 飞书 v1 接入范围
`feishu-source` 适配器 SHALL 接入飞书 IM 文本消息(v1)，通过 REST 轮询 `GET /im/v1/messages` 拉取会话新消息。SHALL 提供 `listMessages(chatId, sinceCursor)` 供 CommentBridge 的 Sweep 兜底清扫轮询绑定话题与 intake 群（主收路径为事件通道，见 `feishu-event-ingress` 能力）。富文本/卡片/文件/图片消息在 v1 范围外，SHALL 被忽略或记录后跳过。`@mention` SHALL NOT 再作为接入条件（绑定上下文 + `/` 命令前缀取代其作为相关性判据，由 CommentBridge 判定）。

#### Scenario: 轮询拉取会话消息
- **WHEN** CommentBridge 调用 `listMessages(chatId, sinceCursor)` 且 sinceCursor 非空
- **THEN** 返回该会话 sinceCursor 之后的新文本消息（含分页累积）

#### Scenario: 冷启动探测用带窗查询（取代无参数请求）
- **WHEN** intake 游标缺失时 CommentBridge 执行冷启动探测
- **THEN** 发送一次带 `start_time = now - 120s`、`end_time = now` 的窗口查询，取窗口内消息的 `max(create_time)`（窗口为空则取窗口起点）写入 `intake_cursor`，本轮不处理任何消息
- **WHEN** 存在早于窗口的历史消息
- **THEN** 它们不影响游标，也不会被回放（真实 API 无时间参数时返回最旧页——2026-09-01 实测，原"最新页"假设不成立）

#### Scenario: 非 text 忽略
- **WHEN** 拉取到富文本/卡片/图片消息
- **THEN** 忽略(v1)，可选记录

#### Scenario: 不接收 webhook
- **WHEN** feishu-source 启用
- **THEN** SHALL NOT 监听 webhook 入站端口

### Requirement: post 消息文本拍平
`parsePolledMessage` SHALL 对 `post` 消息把 content JSON 拍平成纯文本（行内文本块拼接、行间换行、图片块落 `[图片]` 占位、`at` 块落 `@{user_name}`、`title` 非空作为首行），结果写入消息 `text`。拍平失败或结果为空时 `text` SHALL 为空字符串，该消息 SHALL 被跳过（不桥接、不回执）。

#### Scenario: 多行富文本拍平成纯文本
- **WHEN** content 含多行、行内多文本块
- **THEN** 拍平结果保留换行与块文本顺序

#### Scenario: 含图片/at 的富文本
- **WHEN** content 含图片块与 at 块
- **THEN** 图片落 `[图片]`、at 落 `@{user_name}`，文本仍可桥接

#### Scenario: 拍平失败或无文本内容
- **WHEN** content 非预期结构、为空，或只含无文本块
- **THEN** `text` 为空字符串，消息被跳过（不桥接、不回执），不抛错

### Requirement: 桥接可读类型含 post
CommentBridge 的 intake 发现与话题桥接 SHALL 把 `text` 与 `post` 均视为可读文本（最终文本为空的除外——空文本消息 SHALL 跳过不桥接、不回执）：intake 群的 `post` 型 `/issue` 正常建 issue + 回执；话题内 `post` 型自由文本正常桥成带 sentinel 的 Jira comment、命令正常处理。

#### Scenario: post 型 /issue 在 intake 建 issue
- **WHEN** intake 群出现一条 `post` 类型、文本以 `/issue` 开头的多行消息
- **THEN** 正常解析并创建 issue（summary 取标题、description 按 API 版本落库），回复已创建回执，且不额外写入首条 comment

#### Scenario: 话题内 post 型自由文本桥成 comment
- **WHEN** 话题内出现一条 `post` 类型的人自由文本
- **THEN** 该文本桥成带 sentinel 的 Jira comment

#### Scenario: 话题内 post 型命令正常处理
- **WHEN** 话题内出现一条 `post` 类型的 `/state` 等命令
- **THEN** 按命令分支处理并回复

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

### Requirement: 空游标不传 start_time
`resolveStartTime` SHALL 在游标为空时返回空（不生成时间值），`listMessages` / `listThreadReplies` SHALL 在该情况下不传 `start_time` 参数，SHALL NOT 回退到"现在减 24 小时"。传了游标时 SHALL 仍归一化后作为 `start_time`。

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

### Requirement: 飞书回复支持
适配器 SHALL 支持 `reply(chatId, text)`（顶层文本回复）与 `replyInThread(chatId, rootId, text)`（话题内回复，POST 带 `root_id`）。失败 SHALL 作为错误暴露。

#### Scenario: 话题内回复
- **WHEN** 调用 `replyInThread(chatId, rootId, text)`
- **THEN** 在该话题根下发一条文本回复

#### Scenario: 顶层回复
- **WHEN** 调用 `reply(chatId, text)`
- **THEN** 向该会话发一条顶层文本消息

### Requirement: 飞书认证与端点配置
适配器 SHALL 从配置读取飞书应用凭据(app id/secret 或 `$VAR` 间接引用)。SHALL 读 `feishu.intake_chat_id`（启用时必填）、`feishu.forward_interval_ms`（默认 5000）、`feishu.sweep_interval_ms`（默认 12h）、`feishu.create_issue_type`。旧键 `feishu.poll_interval_ms` SHALL 被忽略并发出弃用警告（见 comment-bridge spec 配置键迁移场景）。`feishu.verification_token`/`encrypt_key` 在事件通道模式下 SHALL NOT 被使用（保留供将来 webhook 模式）。飞书源启用时，缺失 app id/secret 或 `intake_chat_id` SHALL 为配置校验错误。

REST API base SHALL 由 `feishu.edition` 集中派生（`feishu` → `https://open.feishu.cn`，`lark` → `https://open.larksuite.com`），全部 REST 调用（含 token 获取）SHALL 使用派生值，SHALL NOT 在调用点硬编码域名。tenant_access_token 获取认证失败时 SHALL 在失败输出中附带跨区域提示（条件句文案，指出另一版的 `feishu.edition` 设置写法）。daemon 启动时 SHALL 以 info 日志输出一行实际生效的 API base。

#### Scenario: 缺 intake_chat_id 校验失败
- **WHEN** feishu.enabled 但 `intake_chat_id` 缺失
- **THEN** 配置校验失败

#### Scenario: verification_token 不被使用
- **WHEN** REST 轮询模式运行
- **THEN** `verification_token`/`encrypt_key` 不参与任何校验/解密

#### Scenario: edition=lark 时 REST 走海外域名
- **WHEN** `feishu.edition: lark` 下发送消息/拉取话题/token 获取
- **THEN** 所有请求 URL 的主机为 `open.larksuite.com`，路径与请求结构不变

#### Scenario: 认证失败附跨区域提示
- **WHEN** `feishu.edition: feishu` 下 tenant_access_token 获取返回认证失败
- **THEN** 失败日志/输出含指向 `feishu.edition: lark` 的条件句提示

#### Scenario: 启动日志透出实际域名
- **WHEN** daemon 以 `feishu.edition: lark` 启动
- **THEN** 启动日志含一行 `https://open.larksuite.com` 的 API base 信息
### Requirement: mock 与真实飞书 API 形状一致
测试 mock SHALL 以真实飞书 IM API 形状构造响应：`reply_in_thread` 响应含 `thread_id`；消息 `create_time` 为 13 位毫秒并由 `toSecondsStr` 归一化为秒；`listMessages` 与 `listThreadReplies` 分别使用 `container_id_type=chat` 与 `container_id_type=thread` 且按容器区分返回；消息 sender 含 `sender_id.open_id`、`sender_name`、`sender_type` 真实字段。

#### Scenario: reply_in_thread 响应返回 thread_id
- **WHEN** 测试 mock 响应 `replyInThread` 请求
- **THEN** 响应含 `thread_id`，bridge 可将之持久化到 binding

#### Scenario: create_time 毫秒归一化为秒
- **WHEN** mock 消息 `create_time` 为 13 位毫秒字符串
- **THEN** `toSecondsStr` 输出 10 位秒字符串，用于 cursor 比较

#### Scenario: 容器类型区分 chat 与 thread
- **WHEN** mock 收到 `listMessages`（chat）与 `listThreadReplies`（thread）请求
- **THEN** 分别以 `container_id_type=chat` 与 `container_id_type=thread` 返回对应容器消息

#### Scenario: 消息 sender 含真实字段
- **WHEN** mock 构造消息对象
- **THEN** 含 `sender_id.open_id`、`sender_name`、`sender_type`，可被完整解析

### Requirement: intake 非命令根消息回执
CommentBridge SHALL 在 intake 群发现一条非命令、非 `/help`、非 `/state`、非 `/issue` 的根消息（自由文本）时，回复一条友好回执（含 `/issue`、`/help` 用法提示）。该回执 SHALL 不桥成 Jira comment、不创建 binding、不影响 intake 游标推进。未知 `/` 前缀命令 SHALL 维持现有"未知命令"回复，不并入本回执。

#### Scenario: 自由文本根消息收到回执
- **WHEN** intake 群出现一条非 `/` 前缀的自由文本根消息
- **THEN** 以该消息为根回复"已收到"类文本（含 /issue、/help 提示），游标照常推进

#### Scenario: 回执不进 Jira 不建 binding
- **WHEN** 上述回执已发送
- **THEN** 该消息不被桥成 Jira comment、也不建立任何 issue↔话题 binding

#### Scenario: 命令消息不回执
- **WHEN** intake 群根消息为 `/help`、`/state`、`/issue` 或其它 `/` 命令
- **THEN** 按各自现有分支处理，不触发自由文本回执

### Requirement: /issue 建 issue 后首条 comment
`executeIssue` 建 issue 成功后 SHALL 把原始 `/issue` 消息全文（标题 + 多行描述）作为该 issue 的**第一条 comment** 写入，且该 comment 带飞书 sentinel（`via 飞书`），使 Jira→飞书转发器按 sentinel 跳过、不回投。comment 作者名取消息 sender_name，缺失用默认。

#### Scenario: 建后写入首条 sentinel comment
- **WHEN** `/issue 标题\n第一行\n第二行` 创建成功
- **THEN** 新 issue 出现首条 comment，内容含 `via 飞书` sentinel 与原文（标题+多行描述）

#### Scenario: sentinel 防回投
- **WHEN** 该首条 comment 存在
- **THEN** `forwardComments` 因 sentinel 跳过它，不转发回飞书话题

### Requirement: /issue 多行 description 按 API 版本落库
`executeIssue` 构造的 `description` 字段 SHALL 保留多行：v2（wiki 文本）用原始换行字符串；v3 转 ADF doc（按换行分段落）。任一 API 版本都不得丢失换行或拒绝请求。

#### Scenario: v2 多行描述
- **WHEN** 经 `/rest/api/2` 端点 `createIssue` 且描述含换行
- **THEN** `description` 字段为含原始换行的字符串

#### Scenario: v3 多行描述
- **WHEN** 经 `/rest/api/3` 端点 `createIssue` 且描述含换行
- **THEN** `description` 字段为 ADF doc，按换行拆成段落节点

### Requirement: 话题桥接成功回执
`bridgeMessages` 把话题内用户非命令自由文本成功桥成 Jira comment 后，SHALL 在该条消息下（`reply_in_thread`）回复成功回执 `✅ 已收到，已同步到 {issue_key}`（`issue_key` 为该绑定对应的 Jira issue）。该回执 SHALL 由 bot 发出，SHALL NOT 被桥回 Jira、SHALL NOT 改变绑定与游标语义；回执发送失败 SHALL 不影响游标推进，仅记日志。命令消息（`/issue`、`/state`、`/help` 及未知 `/` 命令）SHALL 按各自现有分支处理，不触发本回执。

#### Scenario: 桥接成功收到回执
- **WHEN** 话题内出现一条用户非命令自由文本且已成功桥成 Jira comment
- **THEN** 该条消息下回复 `✅ 已收到，已同步到 {issue_key}`

#### Scenario: 回执不回投不重桥
- **WHEN** 上述成功回执已发出
- **THEN** 下一轮轮询中该回执（bot 消息）被跳过，不桥回 Jira、不重复回执

#### Scenario: 命令消息不回执
- **WHEN** 话题内消息为 `/issue`、`/state`、`/help` 或未知 `/` 命令
- **THEN** 按各自命令分支处理并回复，不触发成功回执

### Requirement: 话题桥接失败回执
`bridgeMessages` 尝试把话题内用户自由文本写入 Jira comment 失败时（Jira 404 绑定清理场景除外），SHALL 在该条消息下回复失败回执 `⚠️ 同步失败，请稍后重试`，让用户立即知道未同步成功。游标推进行为维持现状（失败消息不重试）。回执发送失败 SHALL 不影响游标推进，仅记日志。

#### Scenario: 写入失败收到失败回执
- **WHEN** 话题内自由文本尝试写入 Jira comment 失败（非 404）
- **THEN** 该条消息下回复 `⚠️ 同步失败，请稍后重试`，游标照常推进

#### Scenario: 404 绑定清理不回执
- **WHEN** 写入 Jira comment 返回 404（issue 不存在）
- **THEN** 维持绑定清理（markTerminal）行为，不发送失败回执

### Requirement: 发送与更新交互卡片
适配器 SHALL 支持在话题内发送交互卡片（`msg_type: interactive`，`reply_in_thread: true`），内容为卡片 JSON 2.0 序列化后的字符串，并 SHALL 从响应中返回 message_id/thread_id 以便后续更新。适配器 SHALL 支持按 message_id 更新已发送的卡片（`PATCH /im/v1/messages/:id`，请求体 `content` 为卡片 JSON 字符串），且发送与更新使用同一应用身份与 `config.update_multi: true` 的共享卡片。发送或更新失败 SHALL 以 `TaskingError` 抛出，由调用方决定降级。

#### Scenario: 话题内发送卡片
- **WHEN** 调用方请求在话题内发送一张卡片
- **THEN** 适配器以 `POST /im/v1/messages/:root_id/reply`、`msg_type: interactive`、`reply_in_thread: true` 发送，并返回新卡片的 message_id 与 thread_id

#### Scenario: 更新已发送卡片
- **WHEN** 调用方以 message_id 请求更新卡片
- **THEN** 适配器以 `PATCH /im/v1/messages/:message_id`、请求体 `content` 为卡片 JSON 字符串发出请求

#### Scenario: 发送失败向上抛出
- **WHEN** 卡片发送或更新返回非 0 code（如限流、消息已撤回、超过 14 天更新窗口）
- **THEN** 适配器抛出 `TaskingError`，不静默吞掉

### Requirement: 上传并发送文件
适配器 SHALL 支持上传文件资源（`POST /im/v1/files`，multipart，`file_type: stream`，`file_name` 为文件名）取得 `file_key`，并以文件消息（`msg_type: file`，`reply_in_thread: true`）发送到指定话题。上传或发送失败 SHALL 以 `TaskingError` 抛出，由调用方降级。

#### Scenario: 上传后以文件消息发送
- **WHEN** 调用方请求把一段 Markdown 内容作为文件发到话题
- **THEN** 适配器先上传取得 file_key，再以 `msg_type: file` 的回复发送到该话题

#### Scenario: 缺少上传权限时抛出
- **WHEN** 应用未开通上传资源权限，上传返回权限错误（如 99991672）
- **THEN** 适配器抛出 `TaskingError`，调用方据此降级为文本投递

### Requirement: 消息附件解析
适配器 SHALL 在解析消息时同时提取附件信息：`post`（富文本）内联的图片、独立的 `image` 消息、以及独立的 `file`/`audio`/`video` 消息 SHALL 解析为 `attachments: [{ kind: "image"|"file", key, name }]`（`key` 为 `image_key`/`file_key`，`name` 缺失时由 kind 与序号兜底）；文本解析行为 SHALL 保持不变。事件通道与 REST 轮询两条入站路径 SHALL 使用同一解析逻辑。

#### Scenario: 文字+截图的富文本
- **WHEN** 收到 `msg_type: post` 且内容同时含 `text` 与 `img`
- **THEN** `text` 为该段文字，`attachments` 含该图片的 `image_key`

#### Scenario: 独立图片消息
- **WHEN** 收到 `msg_type: image`
- **THEN** `text` 为空，`attachments` 含一个 `kind: "image"` 的项

#### Scenario: 独立文件消息
- **WHEN** 收到 `msg_type: file`（含 `file_name`）
- **THEN** `attachments` 含该文件项的 `file_key` 与文件名

### Requirement: 下载消息资源
适配器 SHALL 提供按消息 id 与资源 key 下载资源的方法（`GET /im/v1/messages/:message_id/resources/:file_key`，`type` 取 `image`|`file`），返回二进制内容与响应头 `Content-Type`；失败 SHALL 抛 `TaskingError`。

#### Scenario: 下载成功
- **WHEN** 请求下载某图片资源
- **THEN** 返回其字节内容与 `Content-Type`

#### Scenario: 下载失败可见
- **WHEN** 资源超过 100MB、消息为保密模式或消息已删除
- **THEN** 抛出 `TaskingError`，由调用方在话题内提示

### Requirement: 群聊平铺发送交互卡片
适配器 SHALL 支持向群聊平铺发送交互卡片（以 `POST /im/v1/messages/:rootId/reply`、`msg_type: interactive`，且**不设** `reply_in_thread`），内容为卡片 JSON 2.0 序列化后的字符串，并 SHALL 从响应中返回 message_id。发送失败 SHALL 以 `TaskingError` 抛出，由调用方决定降级为纯文本。适配器 SHALL 复用与话题内卡片相同的序列化与错误处理路径。

#### Scenario: 群聊平铺发卡
- **WHEN** 调用方请求在群聊中平铺发送一张卡片（如 intake 群里的 `/help` 回执）
- **THEN** 适配器以 `POST /im/v1/messages/:rootId/reply`、`msg_type: interactive`、不设 `reply_in_thread` 发送，并返回新卡片的 message_id

#### Scenario: 平铺发卡失败抛出
- **WHEN** 平铺发卡返回非 0 code（如限流、权限不足）
- **THEN** 适配器抛出 `TaskingError`，调用方回落为纯文本投递

### Requirement: 删除自己发送的消息
适配器 SHALL 支持按 message_id 删除消息（`DELETE /im/v1/messages/:message_id`），用于回收旧的桥卡片（如召回式状态卡重发）。删除失败 SHALL 以 `TaskingError` 抛出，由调用方决定是否忽略（best-effort 回收）。

#### Scenario: 删除旧状态卡
- **WHEN** 调用方请求删除一条自己发出的卡片消息
- **THEN** 适配器以 `DELETE /im/v1/messages/:message_id` 发出请求

#### Scenario: 删除失败抛出
- **WHEN** 删除返回非 0 code（如消息已不存在、无权限）
- **THEN** 适配器抛出 `TaskingError`，调用方可忽略并继续

