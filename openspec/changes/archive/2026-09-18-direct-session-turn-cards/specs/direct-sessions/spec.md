## MODIFIED Requirements

### Requirement: 每 turn 一条总结消息（verbosity 可选）
用户消息入队时系统 SHALL 立即给出可见反馈；turn 结束后系统 SHALL 在话题内发送恰好一条结果：最后一刻 assistant 文本 + 一行统计（耗时、工具调用次数、token 用量）。`summary`（默认）与 `quiet` 下结果 SHALL 为文本消息（quiet 省略统计行、仅正文 + 权限拒绝提示），超长时截断。`feishu.direct.verbosity: detailed` 下系统 SHALL 为该 turn 创建并原地更新一张轮次卡片（见"每 turn 一张轮次卡片"），结果 SHALL 以**结果卡片**投递：完整 assistant 文本按 markdown 渲染（标题/粗体/表格/代码块）+ 统计行；结果超出卡片预算时 SHALL 改为把完整文本作为 `.md` 文件附件发到话题，附件不可用则降级为长文本，仍装不下则提示去 TUI 活动视图。任何 verbosity 下系统 SHALL NOT 再为单个工具调用单独发送文本消息；detailed 下轮次卡片 SHALL NOT 复述最终 assistant 文本（它由结果卡片承载），只保留中间步骤文本。

#### Scenario: summary 模式的交付形状
- **WHEN** verbosity=summary 的会话完成一次成功的 turn
- **THEN** 话题内只新增一条 bot 消息，含 assistant 最终文本与一行统计

#### Scenario: detailed 模式的交付形状
- **WHEN** verbosity=detailed 的会话完成一次含 3 个工具调用的 turn
- **THEN** 话题内新增一张承载这 3 个工具明细的轮次卡片与一张 markdown 结果卡片，且不存在逐个工具的单条文本消息

#### Scenario: 超长回答改为文件投递
- **WHEN** detailed 下某轮的回答超出卡片预算
- **THEN** 完整回答以 `.md` 文件附件发到话题；附件不可用时降级为长文本

#### Scenario: turn 超时
- **WHEN** 某 turn 触发 wall_clock 或 inactivity 超时
- **THEN** 系统在话题内报告中断原因，会话转入可继续追问状态

### Requirement: /done 与 /stop 生命周期命令
直连话题内 `/done` SHALL 将会话标记为 done 并回复累计统计（turn 数、token 总量）；之后话题内消息 SHALL 收到一次性终结提示后静默。`/done` SHALL 同时删除该 opencode 磁盘会话（`opencode session delete <session_id>`）、清空其 `direct:<root_id>` ActivityStore 缓冲并清理内存 runtime/totals；`direct_sessions` 行 SHALL 保留（以便终结提示仍生效）。`/done` SHALL 同时把该会话最近的轮次卡片收尾为"已结束"（去掉全部按钮）。`/stop` SHALL 中断当前正在执行的 turn（通过 AbortSignal 终止子进程）、回复已中断说明，并将会话转回 idle；无 turn 在跑时 `/stop` SHALL 回复无运行中任务，且 SHALL NOT 删除会话。`/stop` SHALL 同时把正在运行那轮的卡片收尾为"已中断"。

#### Scenario: /done 结束会话并清理
- **WHEN** 直连话题内发送 `/done`
- **THEN** 会话状态变为 done，bot 回复累计统计，后续追问收到一次性提示
- **AND** 该会话的 opencode session 被删除，`direct:<root_id>` 活动缓冲被清空，最近的轮次卡片收尾为已结束

#### Scenario: /stop 中断运行中 turn
- **WHEN** turn 运行中话题内发送 `/stop`
- **THEN** 子进程被终止，bot 回复中断说明，会话回到 idle 可继续追问
- **AND** 该轮卡片收尾为已中断

### Requirement: 直连会话状态持久化与重启恢复
直连会话映射 SHALL 持久化于 `bindings.db` 的 `direct_sessions` 表（root_id 主键；chat_id、project、name、path、session_id、thread_id、status（`running`|`idle`|`done`|`expired`）、last_msg_id、turns、input_tokens、output_tokens、total_tokens、updated_at，以及轮次卡片所需的 card_message_id 与 last_prompt）；`name` 为创建时首条 prompt 的可读摘要，`turns`/token 列为累计用量；缺失列 SHALL 通过 `ALTER TABLE` 迁移补齐。opencode session 的标题 SHALL 保持 opencode 原生按内容自动生成（tasking 不传 `--title`）。daemon 重启后 SHALL 从表恢复：`running` 状态的会话（进程已随重启消失）SHALL 被标记为 idle、向话题说明中断，并把该会话 card_message_id 指向的轮次卡片收尾为"已中断（daemon 重启）"，按钮收缩为 `🔁 重试` 与 `🛑 结束`（卡片更新为整卡替换，且本轮工具明细只存在于内存累积器，故重启后**不保留**已累积的工具面板；历史仍可在 TUI 活动视图查看）；`idle` 会话 SHALL 可继续追问，`done/expired` 会话保持终结。新消息去重 SHALL 按会话游标（create_time 秒）+ 会话内已见消息 id 集合（持久化于 direct_sessions.seen_ids，有界）进行：同一秒内到达的不同消息 SHALL 各自被处理，已处理消息的重复投递 SHALL 被跳过（含 daemon 重启后的 sweep 重投）。Sweep SHALL 覆盖直连话题：按持久化的 thread_id 补拉停机/断线窗口内的线程消息，游标保证不重复处理。

#### Scenario: 重启后 idle 会话可继续
- **WHEN** daemon 重启，表中有 idle 会话，其话题内到达新消息
- **THEN** 系统以持久化的 session_id 续跑，上下文不丢失

#### Scenario: 重启时运行中会话被标记中断
- **WHEN** daemon 在 turn 执行中重启，表中有 running 会话
- **THEN** 恢复逻辑将该会话标记 idle、向话题发送中断说明，并把该轮卡片收尾为已中断（工具面板不保留，仅保留 `🔁 重试` 与 `🛑 结束`）

#### Scenario: 重启后消息不重复消费
- **WHEN** 同一消息在重启前后被事件通道与 sweep 各投递一次
- **THEN** 该消息只被处理一次（按会话游标去重）

#### Scenario: 同一秒内到达的不同消息都被处理
- **WHEN** 两条不同消息的 create_time 处于同一秒且先后到达
- **THEN** 两条消息各自触发处理（合并或先后续跑），后者不被游标吞掉

### Requirement: 空闲 TTL 过期
直连会话空闲超过 `feishu.direct.idle_ttl_ms`（默认 30 天）SHALL 在管理器慢速定时器上被标记为 expired，并把该会话最近的轮次卡片收尾为"已过期"（去掉全部按钮）；过期 SHALL 同时删除该 opencode 磁盘会话并清空其 `direct:<root_id>` ActivityStore 缓冲与内存 runtime/totals（`direct_sessions` 行保留），仅停止该话题的后续处理。项目移除不影响既有会话（路径在创建时冻结）。

#### Scenario: 超过 TTL 的会话过期
- **WHEN** 某 idle 会话的 updated_at 距今超过 idle_ttl_ms
- **THEN** 其状态变为 expired，话题内新消息收到终结提示，opencode session 被删除，最近的轮次卡片被收尾为已过期

## ADDED Requirements

### Requirement: 每 turn 一张轮次卡片
`verbosity: detailed` 时，每个 turn SHALL 创建一张独立的交互卡片（卡片 JSON 2.0、`config.update_multi: true`），作为该轮的可见反馈与过程面；卡片 SHALL 在占用目标目录与并发额度**之前**创建，使排队期间也有可见状态。卡片头部 SHALL 显示会话名、状态（排队中/运行中/空闲/已结束/已过期）、累计 turns 与 token、队列深度。正文 SHALL 包含本轮**中间步骤**的 assistant 文本（最终文本由结果卡片承载，见上），以及每个已完成工具调用一个折叠面板：状态与退出码、耗时、工具名、命令或参数、输出**末尾 15 行**与 `… (N more lines)`/`… (opencode truncated)` 标记；失败（退出码非 0 或有 error）的面板 SHALL 默认展开并带失败视觉标识，成功面板 SHALL 默认折叠，最新面板 SHALL NOT 自动展开。卡片 SHALL 只有一层折叠（折叠面板 SHALL NOT 嵌套折叠面板）。更新 SHALL 合并到最多每 1.5 秒一次，并在终态（完成/失败/超时/中断）、`/stop`、`/done` 与任一失败事件时立即刷新；单次更新失败 SHALL 退避重试一次，仍失败只记 WARN，由后续刷新自愈。下一轮开始时系统 SHALL 封存上一轮的卡片：把其按钮行替换为一行统计，卡片其余内容（工具面板、文本、展开状态）保持不变。卡片体积 SHALL 维持在工作预算 24KB 内；超预算时 SHALL 按"最旧面板输出降到 3 行 → 去掉其输出只留标题行 → 该面板替换为一行'还有 N 个工具调用未展示'"的顺序从最旧开始降级。

#### Scenario: detailed 新一轮创建卡片并充当 ACK
- **WHEN** verbosity=detailed 的会话开始新一轮
- **THEN** 话题内出现该轮卡片（头部含会话名与状态），且不再有独立的"会话已创建/已排队"文本消息

#### Scenario: 排队期间卡片已存在并显示状态
- **WHEN** 新一轮因目录占用或并发额度需等待
- **THEN** 该轮卡片已创建，头部显示排队中状态与队列深度

#### Scenario: 工具面板内容与折叠默认值
- **WHEN** 一轮内某工具成功完成
- **THEN** 其面板默认折叠，展开可见状态/退出码/耗时、工具名、命令或参数、输出末尾 15 行

#### Scenario: 失败工具默认展开
- **WHEN** 某工具以非 0 退出码完成
- **THEN** 其面板默认展开并带失败视觉标识

#### Scenario: 更新合并与终态立即刷新
- **WHEN** 1.5 秒内连续完成多个工具，随后该轮结束
- **THEN** 过程中的多次事件被合并为更少的卡片更新，且终态变化立即反映到卡片

#### Scenario: 下一轮开始封存上一轮
- **WHEN** 新一轮开始且上一轮卡片仍带按钮行
- **THEN** 上一轮卡片的按钮行被替换为一行统计，其工具面板与文本保持不变（仍可展开）

#### Scenario: 超预算时从最旧面板降级
- **WHEN** 单轮累积使卡片逼近 24KB
- **THEN** 系统从最旧的面板开始降级（输出降到 3 行 → 去掉输出 → 整面板压成一行提示），直到回到预算内

### Requirement: 轮次卡片按钮与卡片动作
轮次卡片 SHALL 提供控制按钮：`⏹ 中断`（仅出现在运行中的卡片）、`🔁 重试`（仅最近一轮）、`📄 完整输出`（仅最近一轮）、`🛑 结束`（运行中与最近一轮）。按钮 SHALL 与斜杠命令并存，权限模型 SHALL 与命令一致（群成员皆可操作）。`🛑 结束` SHALL 走两步确认：先返回同一个卡片、把按钮行替换为警告文案与 `确认结束`/`取消`，确认后才结束会话；`⏹ 中断` SHALL 一步即时。按钮 value SHALL 为对象，至少包含 root_id 与 turn。卡片动作 SHALL 经事件通道的 `card.action.trigger` 接收，SHALL NOT 进入消息入站队列，并 SHALL 在 3 秒内以 `toast + 新卡片` 响应；处理函数内 SHALL 只做快速内存状态变更，删除 opencode session、发送完成文本、上传文件等慢操作 SHALL 在响应之后异步执行。重复投递的同一动作（同一 message_id + 操作人 + 动作）SHALL 被去重，不重复执行。对已封存或非当前轮的卡片点击 `⏹ 中断`/`📄 完整输出` SHALL 只回 toast 提示、不改变会话状态。`🔁 重试` SHALL 以该轮 prompt（持久化于 `direct_sessions.last_prompt`）发起新一轮，并在新卡片头部标注重试来源。

#### Scenario: 运行中点击中断
- **WHEN** 某轮运行中用户点击 `⏹ 中断`
- **THEN** 该轮子进程被终止，卡片变为已中断，且该轮完成文本说明中断原因与操作人

#### Scenario: 结束需要两步确认
- **WHEN** 用户点击 `🛑 结束`
- **THEN** 卡片原地变为确认态（含"确认结束/取消"），会话尚未结束
- **AND** 点击"确认结束"后会话结束、卡片收尾为已结束，并发送带操作人的结束文本

#### Scenario: 重复点击只执行一次
- **WHEN** 同一按钮点击被事件通道重复投递
- **THEN** 该动作只被执行一次

#### Scenario: 旧卡片上的按钮只提示
- **WHEN** 用户在一张已封存（或非当前轮）的卡片上点击 `⏹ 中断`
- **THEN** 仅收到 toast 提示，会话状态与会话卡片均不改变

#### Scenario: 重试最近一轮
- **WHEN** 用户点击 `🔁 重试`
- **THEN** 系统以该轮 prompt 发起新一轮，新卡片头部标注重试来源

#### Scenario: 回调在 3 秒内返回
- **WHEN** 卡片动作触发会话结束（需删除 opencode session 与发送文本）
- **THEN** 响应在 3 秒内以 toast + 新卡片返回，删除与发送在其后异步完成

### Requirement: 完整输出按需投递
`📄 完整输出` SHALL 把最近一轮所有工具事件的完整明细（含命令/参数/完整输出，体积上限 1MB，超出时先丢弃最旧工具的明细并注明）打包为 Markdown 文件，上传后以文件消息发送到该话题。上传失败（缺 `im:resource` 权限、超限、网络等）SHALL 降级为一条长文本消息（截断到约 140KB）并在末尾说明降级原因；若连文本也装不下 SHALL 只回一条指向 TUI 活动视图的提示。任一降级 SHALL 记 WARN。该按钮 SHALL 只出现在最近一轮的卡片上。

#### Scenario: 正常以文件发送
- **WHEN** 用户对最近一轮点击 `📄 完整输出` 且上传可用
- **THEN** 话题内出现一个包含该轮完整工具明细的 Markdown 文件附件

#### Scenario: 上传失败降级为文本
- **WHEN** 上传因缺少权限而失败
- **THEN** 系统改为发送一条含完整明细的长文本消息，并在末尾说明文件上传不可用，同时记 WARN

#### Scenario: 体积过大只指向 TUI
- **WHEN** 该轮明细超过文本消息上限
- **THEN** 系统只回复一条提示，指向 TUI 活动视图查看完整明细

#### Scenario: 历史卡片不提供该按钮
- **WHEN** 查看一张已封存的轮次卡片
- **THEN** 其中不出现 `📄 完整输出` 按钮

### Requirement: 卡片不可用时的文本降级
当轮次卡片创建失败，或该轮卡片更新连续失败时，系统 SHALL 把该轮 flush 的输出改为合并文本消息（每次 flush 发送一条，SHALL NOT 退回"每个工具一条"），并记 WARN；SHALL NOT 因此中断 turn，完成文本 SHALL 照常发送。

#### Scenario: 建卡失败降级为合并文本
- **WHEN** 某轮卡片创建失败
- **THEN** 该轮的工具过程以合并文本消息呈现（每次刷新一条），turn 正常跑完并发送完成文本，日志有 WARN

#### Scenario: 中途更新失败切换为文本
- **WHEN** 卡片创建成功但该轮中途更新连续失败
- **THEN** 从失败点起该轮改以合并文本消息呈现，turn 不被中断
