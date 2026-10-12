## Purpose

feishu-event-ingress：飞书入站事件通道能力。以官方 SDK `WSClient` 长连接订阅 `im.message.receive_v1`（事件推送为平台豁免通道、不计 API 额度），将 SDK 事件 payload 归一化为内部 `FeishuPolledMessage` 后经 `CommentBridge.ingestMessage()` 进入站队列（单一入队口、msg_id claim 去重、单消费者串行）；事件路由边界与既有轮询可见性完全对齐；桥接失败做进程内退避重试；残余 REST 调用受 429 冷却保护；WS 不可用时自动降级为 Sweep 慢轮询稳态，无 `receive_mode` 开关。
## Requirements
### Requirement: 事件通道接入
启用飞书桥时，daemon SHALL 通过官方 SDK `WSClient` 建立一条长连接（`FeishuEventListener`，唯一 import SDK 的位置）订阅 `im.message.receive_v1`，将 SDK 事件 payload 归一化为内部 `FeishuPolledMessage` 形状（含 `msg_type` 字段名映射与 `create_time` 毫秒→秒归一）后交由 `CommentBridge.ingestMessage()` 入队。事件通道 SHALL NOT 消耗飞书 API 调用额度（平台推送为豁免通道），发送类调用 SHALL 仍走 REST。

长连接 SHALL 按 `feishu.edition` 选择 SDK `domain` 端点（`lark` → `Domain.Lark` 海外区域，`feishu` → 默认国内），edition 取自生效配置并在监听器依赖中显式传递。

#### Scenario: 配额耗尽时事件照常接收
- **WHEN** 飞书月度 API 额度已耗尽（REST 调用返回 429 99991403）
- **THEN** WS 长连接照常建连，新消息事件照常实时送达并进入入站队列

#### Scenario: 话题回复事件携带路由字段
- **WHEN** 用户在绑定话题内回复一条消息
- **THEN** 事件 payload 经归一化后携带 `root_id`/`parent_id`/`thread_id`，可按 `root_id` 查到对应 binding

#### Scenario: lark 部署连海外端点
- **WHEN** `feishu.edition: lark` 下事件通道建连
- **THEN** `WSClient` 以 `Domain.Lark` 构造，连接海外区域端点
### Requirement: 入站队列单一入队口与 claim 去重
`CommentBridge` SHALL 暴露公开入口 `ingestMessage(msg)`，内部维护单一无界 FIFO 与单一消费者：事件与 Sweep 两个来源 SHALL 只做"取消息→归一化→入队"，处理 SHALL 全部经由此队列串行执行（保留同话题消息按到达序进 Jira）。入队时 SHALL 先做 msg_id claim（查+加 processed 集合，原子），重复消息 SHALL 在入队口被丢弃；intake 根消息（`root_id === null`）的 claim SHALL 叠加持久 seen-id（跨重启生效，处理完成后写入，见 comment-bridge 能力"intake 根消息重投持久去重"），事件 handler SHALL 在归一化入队后立即返回（满足平台 3 秒 ack 约束），不得在 handler 内做 Jira/飞书调用。

#### Scenario: 事件与 Sweep 竞态不双投
- **WHEN** 同一条消息同时被事件送达与 Sweep 拉取
- **THEN** 仅先入队的一份被处理，后到者在入队口因 msg_id 已 claim 被丢弃，Jira 只收到一条评论

#### Scenario: handler 快速返回
- **WHEN** 事件到达
- **THEN** handler 在归一化并入队后立即返回（不阻塞等待处理结果），平台侧不触发超时重推

#### Scenario: daemon 重启后 Sweep 重投已处理根消息被持久去重
- **WHEN** 一条 intake 根消息已被处理（seen-id 已持久写入）、游标尚未推进过它时 daemon 重启，启动 Sweep 重投该消息
- **THEN** 该消息在入队口因持久 seen-id 命中被静默丢弃，不重复执行命令分支、不重发回复

### Requirement: 事件路由边界与轮询可见性一致
事件路由 SHALL 与既有轮询可见性完全对齐：`chat_id` 不等于 `feishu.intake_chat_id` 的消息、私聊消息、`sender_type === "app"` 的消息（含机器人自身与其它 bot）、非 text/post 类型、空文本消息 SHALL 全部丢弃（debug 日志）；intake 群 root 消息 SHALL 走 intake 路径（命令/`/issue`/ack）；`root_id` 命中 active binding 的回复 SHALL 走话题桥接路径；`root_id` 无 binding 或对应 terminal binding 的回复 SHALL 丢弃。

#### Scenario: 其它群消息不处理
- **WHEN** 机器人在非 intake 群收到群消息事件
- **THEN** 该消息被 debug 日志记录后丢弃，不产生任何 Jira 写入或回复

#### Scenario: 野话题回复不桥接
- **WHEN** intake 群内某个话题的回复找不到对应 active binding
- **THEN** 该消息被 debug 日志记录后丢弃，不桥接、不 ack

#### Scenario: terminal 话题回复给一次性提示
- **WHEN** 用户在 root 对应 terminal binding 的话题内回复
- **THEN** 每个话题（每 daemon 生命周期）收到一次可见提示（issue key + 用 /state 恢复或重新 /issue 的指引），同话题后续回复不再重复提示；也不桥接进 Jira

### Requirement: 桥接失败进程内退避重试
话题消息桥接（Jira postComment）或 intake 处理失败时，SHALL 先做进程内退避重试至多 3 次（30s/2m/10m；重试仅打 Jira，不消耗飞书额度）；3 次仍失败 SHALL 维持既有终态语义：发可见失败 ack、游标照常推进。Jira 404（issue 已删）SHALL 立即 markTerminal，不重试。

#### Scenario: 瞬时失败自动恢复
- **WHEN** Jira 短暂不可用导致 postComment 失败，随后恢复
- **THEN** 该消息在退避重试中成功桥接为 Jira 评论，无需人工重发

#### Scenario: 终态失败可见
- **WHEN** 3 次重试全部失败
- **THEN** 用户在话题内看到失败 ack，游标推进，后续消息不被阻塞

### Requirement: 429 冷却保护残余 REST 调用
任一飞书 REST 调用收到 HTTP 429 时，SHALL 进入冷却态：时长 60s 起、逐次翻倍、封顶 10 分钟，任一飞书 REST 调用成功即复位。冷却期内：forward 快循环 SHALL 跳过发送（Jira 侧游标 hold，冷却结束自动补发）、Sweep SHALL 跳过本轮、thread/intake ack SHALL 跳过（best-effort）；事件接收与入队 SHALL 不受影响。

#### Scenario: 冷却期游标 hold 自动补发
- **WHEN** forward 循环在冷却期内有待发评论
- **THEN** 本轮跳过发送且 Jira 游标不推进，冷却结束后的下一轮自动补发成功

#### Scenario: 冷却不影响事件接收
- **WHEN** 冷却期内有新消息事件到达
- **THEN** 事件照常入队并处理（Jira 侧操作不受冷却影响），仅飞书 REST 发送被跳过

### Requirement: WS 不可用降级稳态
WS 建连失败时 daemon SHALL 照常启动并 WARN 一条含可操作提示的日志（覆盖：订阅方式未改长连接、事件未添加、应用版本未发布三类误配），此后每 60s 静默重试（debug 级日志）；WS 运行中断线由 SDK 自动重连，重连成功 SHALL 立即触发一次 Sweep。系统 SHALL 不提供 receive_mode 开关：WS 长期不可用时系统自动退化为"慢轮询稳态"（飞书→Jira 延迟 = Sweep 间隔），scheduler/Jira/forward 不受影响。

#### Scenario: 建连失败不阻塞启动
- **WHEN** daemon 启动时 WS 无法建连（网络或误配）
- **THEN** 输出一条 WARN 后 daemon 正常运行，scheduler 与 forward 快循环照常工作

#### Scenario: 重连成功补窗口
- **WHEN** WS 断线后重连成功
- **THEN** 立即执行一次 Sweep，用持久游标补齐断线窗口内的消息

### Requirement: 卡片动作入站走独立快路径
事件通道 SHALL 在同一条长连接上同时订阅消息事件与卡片动作回调（`card.action.trigger`），并把卡片动作归一化为"卡片消息 id、chat id、操作人 open_id、动作 value"的最小结构后转交直连会话管理器。卡片动作 SHALL NOT 进入消息入站队列（Ingest queue 的串行单消费者），SHALL 走独立快路径，以保证处理函数能在飞书要求的 3 秒内返回；该路径 SHALL NOT 因队列积压而延迟。归一化失败（缺 message_id 或缺 action value）的卡片动作 SHALL 被忽略并记 debug，SHALL NOT 影响消息事件的处理。

#### Scenario: 注册回调并转发卡片动作
- **WHEN** 用户在轮次卡片上点击按钮，事件通道收到 `card.action.trigger`
- **THEN** 适配层归一化出 message_id/chat_id/操作人/动作 value 并转交直连会话管理器

#### Scenario: 卡片动作不排入消息队列
- **WHEN** 消息入站队列正在处理其它消息（如 Jira 镜像）时收到卡片动作
- **THEN** 该卡片动作仍被立即转交处理，不等待队列

#### Scenario: 归一化失败被忽略
- **WHEN** 收到的卡片动作缺少 message_id 或 action value
- **THEN** 该事件被忽略并记 debug，不影响其它事件

### Requirement: 卡片动作按来源路由
事件通道 SHALL 依据卡片动作 value 中的来源标识（`kind`：`direct` | `bridge`）把归一化后的卡片动作路由到对应处理器：直连动作转交直连会话管理器，桥动作转交 CommentBridge。未带来源标识的动作 SHALL 默认按直连处理（保持既有行为）。桥侧 SHALL 对**写操作**（确认转状态、完整输出、召唤状态卡）按（卡片消息 id、操作人、动作值**含渲染序号**）去重，重投 SHALL 返回"已处理"而不重复执行；信息卡每次渲染 SHALL 在按钮 value 中盖入递增 `seq`，使重新渲染后的卡（新 seq）在窗口内仍可正常点击，而同一渲染的重投（同 seq）被去重。纯读取/渲染类动作（`🔄 刷新`、打开转状态列表、取消）SHALL NOT 因去重被拒，允许在窗口内重复点击。路由与去重 SHALL 保持卡片动作走独立快路径，SHALL NOT 排入消息入站队列。

#### Scenario: 桥动作路由到桥
- **WHEN** 用户点击任务状态卡上的按钮，事件通道收到带 `kind: bridge` 的 `card.action.trigger`
- **THEN** 该动作被转交 CommentBridge 处理，而非直连会话管理器

#### Scenario: 缺省来源按直连处理
- **WHEN** 收到未带 `kind` 的卡片动作
- **THEN** 仍按既有行为转交直连会话管理器

#### Scenario: 写操作重复回调被去重
- **WHEN** 同一确认转状态（或完整输出）动作被重投（相同 message id、操作人、动作值）
- **THEN** 桥只执行一次，重投返回"已处理"提示

#### Scenario: 重走流程后可再次确认
- **WHEN** 用户在去重窗口内重新走 `🔀 转状态 → 选状态 → 确认`
- **THEN** 新渲染的确认卡带新 seq，确认正常执行，不返回"已处理"

#### Scenario: 刷新可重复点击
- **WHEN** 用户在去重窗口内再次点击 `🔄 刷新`
- **THEN** 刷新照常执行并换卡，不返回"已处理"

#### Scenario: 路由不排入消息队列
- **WHEN** 消息入站队列正在处理其它消息时收到桥卡片动作
- **THEN** 该动作仍被立即转交处理，不等待队列

