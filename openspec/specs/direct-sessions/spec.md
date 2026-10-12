# direct-sessions Specification

## Purpose
Feishu intake 群 `/chat` 直连 opencode 会话：绕过 Jira，在固定目录直接跑 `opencode run`，一话题一 session、多 turn 续聊、运行中排队与并发预算、生命周期（`/done`、`/stop`、TTL）与状态持久化。
## Requirements
### Requirement: /chat 在 intake 群发起直连会话
`CommentBridge.discoverIntake` SHALL 把以 `/chat` 开头的 intake 群根消息交给 `DirectSessionManager` 处理（而非当作未知命令）。`/chat <project> <消息>` SHALL 按 `feishu.direct.projects` 名称映射（大小写不敏感）解析目录；`/chat /绝对路径 <消息>` SHALL 使用该绝对路径（ad-hoc path 模式）。两者均 SHALL 以首条消息内容作为第一 turn 的 prompt 创建直连会话，并立即在原消息的话题回复中 ACK（`✅ 会话已创建 …`）。`/chat` 根消息 SHALL 幂等：若 `direct_sessions` 中已存在该 root_id（daemon 重启/断线导致的 intake sweep 重投、或 WS 重放），系统 SHALL NOT 重建会话或重跑首 turn；由于该分支只可能由重投触发（新 `/chat` 必然是新 message_id → 新建会话），系统 SHALL NOT 回复任何消息，仅记 debug（避免与用户动作无关的随机回执）。该持久去重与 `/issue` 的 `hasRootId` 守卫同理。

#### Scenario: 按项目名创建会话
- **WHEN** intake 群收到根消息 `/chat tasking 帮我跑一下测试`，且 `feishu.direct.projects` 含 `tasking: /repos/tasking`
- **THEN** 系统在 `/repos/tasking` 创建直连会话，首 turn prompt 为 `帮我跑一下测试`，并在该消息的话题内回复创建 ACK

#### Scenario: 重投的 /chat 根消息静默跳过
- **WHEN** 同一条 `/chat` 根消息在 daemon 重启后被 intake sweep 再次投递（该 root_id 已有会话）
- **THEN** 系统不再新建会话、不重跑首 turn、不覆盖既有 session_id，且不发送任何回执（静默跳过并记 debug）

#### Scenario: 按 path 创建会话
- **WHEN** intake 群收到根消息 `/chat /home/me/notes 整理一下这个目录`，且 `feishu.direct.path_roots` 为空（不限制）
- **THEN** 系统在 `/home/me/notes` 创建直连会话并以 `整理一下这个目录` 为首 turn

#### Scenario: path 模式受 path_roots 白名单约束
- **WHEN** `feishu.direct.path_roots` 非空且收到的 ad-hoc path 不在任何前缀之下
- **THEN** 系统 SHALL 拒绝创建并回复提示（列出可用的前缀与项目名），不产生任何会话记录

#### Scenario: 未知项目名与不存在的路径
- **WHEN** `/chat <project>` 的 project 不在配置映射中，或 ad-hoc path 不存在/不是目录
- **THEN** 系统 SHALL 回复友好错误（含 `/chat` 用法与可用项目列表），不创建会话

#### Scenario: /chat 无参数
- **WHEN** 收到 `/chat` 或 `/chat list`
- **THEN** 系统 SHALL 回复已配置的项目清单（名字 → 路径）及 path 模式用法提示

### Requirement: 一个话题对应一个 opencode 会话
每个直连会话 SHALL 严格对应一个飞书话题（root message）与一个 opencode session；话题内后续可读文本消息 SHALL 作为同一 opencode session 的续跑 turn（`-s <session_id>`）执行。直连话题的消息 SHALL 不进入 Jira 桥的评论镜像路径。

#### Scenario: 话题内追问续跑同一会话
- **WHEN** 直连话题收到第二条用户文本消息，且该会话空闲
- **THEN** 系统以既有 session_id 追加一次 `opencode run -s <sid>` turn，而非新建会话

#### Scenario: 直连话题消息不镜像到 Jira
- **WHEN** 直连话题内收到用户消息
- **THEN** 系统不向任何 Jira issue 发评论，也不查找 Jira binding

### Requirement: 运行中追问排队、同目录串行
同一会话同时最多一个在跑 turn；turn 运行期间到达的追问 SHALL 进入该会话的内存队列并在当前 turn 结束后按 FIFO 合并续跑（多条合并为一个 prompt，以 `\n---\n` 分隔）；同一目录同时最多一个 turn 在执行（跨会话排队）；daemon 全局同时执行的直连 turn 数 SHALL 不超过 `feishu.direct.max_concurrent`（默认 5，独立于 Jira 的 `max_concurrent_agents`）。

#### Scenario: 运行中到达的追问被排队
- **WHEN** 会话 turn 运行中话题内又到达两条消息
- **THEN** 系统立即回复排队 ACK，当前 turn 结束后将两条消息合并为一个 prompt 续跑一次

#### Scenario: 超出并发预算时等待
- **WHEN** 已有 `max_concurrent` 个直连 turn 在跑，另一会话的新消息到达
- **THEN** 该会话的 turn 等待有空位后执行，且不占用 Jira dispatch 的并发额度

### Requirement: 每 turn 子进程执行复用 worker 原语
直连 turn SHALL 通过 `runDefaultSubprocess` 执行一条由 `opencode.command` 派生的命令：`--format json`、显式 `--dir <固定目录>`（永远显式传递）、`opencode.agent` 非空时附 `--agent <agent>`、`opencode.model` 非空时附 `--model <model>`、`opencode.variant` 非空时附 `--variant <variant>`、`feishu.direct.auto_approve`（全局默认 false，可按项目覆盖）为 true 时附 `--auto`、续跑附 `-s <session_id>`。直连 turn SHALL NOT 传 `--title`：opencode session 的标题交由 opencode 原生按内容自动生成（与原生行为一致），而非 tasking 固定的 `feishu:<rootId>` 标记。超时/不活动升级与 JSON 事件解析语义 SHALL 与 worker 层一致（复用 `opencode.turn_timeout_ms` / `opencode.inactivity_timeout_ms`）。直连路径 SHALL 不执行 workspace 创建、hooks、MCP 注入或 Liquid 模板渲染。

#### Scenario: 首 turn 命令形状
- **WHEN** 新会话首 turn 以消息 `跑测试` 在 `/repos/tasking` 执行（auto_approve=false）
- **THEN** 子进程命令包含 `--format json`、`--dir /repos/tasking`、`跑测试`，且不包含 `--auto`、`-s` 与 `--title`

#### Scenario: 继承 tasking 的 agent/model/variant
- **WHEN** `opencode.agent=review`、`opencode.model=deepseek/deepseek-v4-flash`、`opencode.variant=high`
- **THEN** 直连命令包含 `--agent review`、`--model deepseek/deepseek-v4-flash`、`--variant high`，且消息仍为最后一个位置参数
- **AND** 任一字段为空/null 时对应标志不追加

#### Scenario: 续跑 turn 命令形状
- **WHEN** 既有会话以 session_id `ses_x` 续跑
- **THEN** 子进程命令包含 `-s ses_x` 与显式 `--dir`

### Requirement: 每 turn 一条总结消息（verbosity 可选）
用户消息入队时系统 SHALL 立即给出可见反馈；turn 结束后系统 SHALL 在话题内发送恰好一条结果：最后一刻 assistant 文本 + 一行统计（耗时、工具调用次数、token 用量）。`summary` 与 `quiet` 下结果 SHALL 为文本消息（quiet 省略统计行、仅正文 + 权限拒绝提示），超长时截断。`feishu.direct.verbosity: detailed`（**默认**）下系统 SHALL 为该 turn 创建并原地更新一张轮次卡片（见"每 turn 一张轮次卡片"），结果 SHALL 以**结果卡片**投递：完整 assistant 文本按 markdown 渲染（标题/粗体/表格/代码块）+ 统计行；结果超出卡片预算时 SHALL 改为把完整文本作为 `.md` 文件附件发到话题，附件不可用则降级为长文本，仍装不下则提示去 TUI 活动视图。任何 verbosity 下系统 SHALL NOT 再为单个工具调用单独发送文本消息；detailed 下轮次卡片 SHALL NOT 复述最终 assistant 文本（它由结果卡片承载），只保留中间步骤文本。轮次卡片的折叠面板需飞书/Lark 客户端 ≥ V7.9 渲染；更低版本显示「请升级」占位符（ SHALL NOT 崩溃或影响结果投递），该版本要求 SHALL 写入模板注释与双语文档，`verbosity: summary` 是显式回退。

#### Scenario: summary 模式的交付形状
- **WHEN** verbosity=summary 的会话完成一次成功的 turn
- **THEN** 话题内只新增一条 bot 消息，含 assistant 最终文本与一行统计

#### Scenario: detailed 模式的交付形状（含默认）
- **WHEN** verbosity=detailed（含未配置 verbosity 的缺省情形）的会话完成一次含 3 个工具调用的 turn
- **THEN** 话题内新增一张承载这 3 个工具明细的轮次卡片与一张 markdown 结果卡片，且不存在逐个工具的单条文本消息

#### Scenario: 超长回答改为文件投递
- **WHEN** detailed 下某轮的回答超出卡片预算
- **THEN** 完整回答以 `.md` 文件附件发到话题；附件不可用时降级为长文本

#### Scenario: turn 超时
- **WHEN** 某 turn 触发 wall_clock 或 inactivity 超时
- **THEN** 系统在话题内报告中断原因，会话转入可继续追问状态

### Requirement: 权限姿态由目标项目配置治理，auto 可指定
直连 turn 默认 SHALL 不传 `--auto`；此时权限姿态完全由目标目录自身的 opencode permission 配置决定，`ask` 项被 opencode 安全自动拒绝并体现在总结中。`feishu.direct.auto_approve: true`（可被 projects 条目中的同名键按项目覆盖）时系统 SHALL 传 `--auto`。系统 SHALL 不写入、不修改目标目录的任何 `.opencode/` 配置。

#### Scenario: 默认不裸奔
- **WHEN** 未配置 auto_approve（或为 false）
- **THEN** 直连 turn 命令不含 `--auto`

#### Scenario: 项目级覆盖
- **WHEN** projects 中该项目条目设 `auto_approve: true` 而全局为 false
- **THEN** 该项目的直连 turn 命令含 `--auto`，其他项目仍不含

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

### Requirement: TUI 展示直连会话
TUI SHALL 以独立区块列出活跃（`running`/`idle`）直连会话，数据经 `buildSnapshot` → `/api/v1/state` 的 `direct` 数组传递，使 daemon 内嵌 TUI 与 `tasking tui`（HTTP 客户端）行为一致；该区块 SHALL NOT 影响 Jira 的 running/retry 列表、计数或 reconcile。区块仅在有活跃会话时渲染；焦点循环 SHALL 为 running → backoff → direct（direct 无会话时跳过）。区块行 SHALL 显示会话名称（`direct_sessions.name`，即首条 prompt 折叠空白、截断 80 字符）、状态、空闲时长、该会话累计 token 与该会话排队数；区块标题 SHALL 显示活跃会话数（如 `Direct sessions (1)`；有 turn 在跑时显示 `(1 · 1 running)`），与 Jira 的 `Agents` 计数相互独立（Jira 进度条是另一套并发额度）。直连会话的 turns/input/output/total token SHALL 持久化于 `direct_sessions` 行：`turns` SHALL 在每 turn **开始时** +1（使 TUI 在运行中即显示该 turn），token 在 turn 结束后累加；daemon 重启后恢复为累计值（与持久化的 session 本身一致）。首页 `Tokens:` 总额 SHALL 使用独立的 daemon 生命周期聚合（`/done` 不清零，重启清零，与 Jira 总量同语义）。两者均采用 `sessionAndUsage.usage` 单一来源，不得对 `step_finish` 与 usage 重复累加。选中直连会话进入 direct 详情（名称/目录/状态/session/agent/model/turns/排队数/token），按 `a` SHALL 复用既有 activity 视图（以 `direct:<root_id>` 为键），其表头 SHALL 显示该会话的 agent/model/turn/tokens；activity 明细 SHALL 保留工具事件的完整字段（input/output/error/status/exit/duration），`Esc` 返回 direct 详情；区块在动态刷新中消失时焦点 SHALL 回落到 running，不得留下悬空光标。

#### Scenario: 直连会话出现在 TUI
- **WHEN** 存在活跃直连会话，daemon 内嵌 TUI 或 `tasking tui` 渲染 overview
- **THEN** 出现「Direct sessions」区块，含会话名称、状态、token 与排队数，标题含活跃会话数 `(N)`
- **AND** Jira 的 Running/Backoff 计数不变

#### Scenario: 直连 token 计入首页总额
- **WHEN** 有直连会话产生 token 消耗（含已 `/done` 的会话）
- **THEN** 首页 `Tokens:` 总额包含这些 token，且单个 turn 的 token 不被重复计算

#### Scenario: 复用 activity 视图
- **WHEN** 在 Direct sessions 区块选中一会话并进入详情后按 `a`
- **THEN** 展示该 `direct:<root_id>` 的活动流（表头含 agent/model/turn/tokens），工具事件明细含命令/输出，`Esc` 返回 direct 详情

#### Scenario: 区块动态消失不悬空
- **WHEN** 焦点位于 direct 且直连会话列表变为空
- **THEN** 焦点回落到 running，区块不再渲染，无异常

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

### Requirement: feishu.direct 零配置默认可用
`feishu.enabled` 为 true 时直连功能 SHALL 默认启用（`feishu.direct` 段缺失 = 全默认值；段内显式 `enabled: false` 关闭）。`projects` 可为空（path 模式即可用）。所有其他项 SHALL 有合理默认值：`path_roots: []`、`auto_approve: false`、`verbosity: detailed`、`max_concurrent: 5`、`idle_ttl_ms: 30 天`。

#### Scenario: 零配置 path 模式可用
- **WHEN** WORKFLOW.md 的 feishu 段不含 `direct` 子块（feishu.enabled: true）
- **THEN** 直连默认启用，`/chat /绝对路径 <消息>` 直接可用，无需任何新增配置

#### Scenario: 两行配置启用项目名模式
- **WHEN** WORKFLOW.md 的 feishu 段仅含 `direct: { projects: { tasking: /repos/tasking } }`
- **THEN** 解析后的配置填满所有默认值，`/chat tasking …` 可用

#### Scenario: 显式关闭
- **WHEN** `feishu.direct.enabled: false`
- **THEN** 直连不激活，`/chat` 按未知命令处理

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

### Requirement: 生命周期消息以显示名标注操作人
直连会话的生命周期消息（`/stop` 的中断说明、`/done` 的结束统计、卡片按钮触发的中断/结束）SHALL 以操作人的**显示名**标注；显示名 SHALL 按 `operator.name`（回调自带）→ 本次会话所在群（`chat_id`）的成员表缓存 → 群成员表实时查询 → open_id 的顺序解析。群成员表查询 SHALL 通过 `GET /im/v1/chats/:chat_id/members`（`member_id_type=open_id`，必要时分页）进行，结果 SHALL 按 chat_id 缓存（TTL 1 小时），并在会话创建时预取一次。解析 SHALL NOT 出现在卡片回调动画的响应路径上（回调 SHALL 仍然立即返回）；解析失败（非群成员、接口失败、缺权限）SHALL 记 debug 并回落显示 open_id，SHALL NOT 影响消息发送与会话状态。

#### Scenario: 能解析时显示姓名
- **WHEN** 群成员表能解析出点击者的姓名
- **THEN** 中断/结束消息里的操作人显示为该姓名（而非 open_id）

#### Scenario: 解析失败回落 open_id
- **WHEN** 成员表查询失败或点击者不在返回结果中
- **THEN** 消息仍正常发送，操作人显示为 open_id，并记 debug

#### Scenario: 回调不被解析拖慢
- **WHEN** 缓存未命中且成员表查询较慢
- **THEN** 卡片动作仍在 3 秒内返回（解析发生在响应之后的慢操作里）

#### Scenario: 成员表结果被复用
- **WHEN** 同一会话内第二次触发卡片动作
- **THEN** 不再重复请求成员表（命中缓存）

### Requirement: 会话级设置覆盖与优先级
系统 SHALL 在 `direct_sessions` 上保存每会话的覆盖项（`agent_override`、`model_override`、`auto_approve_override`），并在构建每一轮命令时按 **会话覆盖 > 项目条目 > 全局配置** 解析；生效时机 SHALL 为**轮边界**（正在跑的轮不受影响），每次切换的 ACK SHALL 说明"下一轮生效"。系统 SHALL NOT 因这些切换写入 WORKFLOW.md 或目标目录的任何 `.opencode`。

#### Scenario: agent/model 覆盖下一轮生效
- **WHEN** 会话内执行 `/agent review`（或 `/model X`）
- **THEN** 之后每一轮的 `opencode run` 命令带该 agent/model，当前正在跑的轮不变

#### Scenario: reset 回到配置默认
- **WHEN** 执行 `/agent reset`
- **THEN** 该会话不再覆盖 agent，回到 `opencode.agent`

#### Scenario: 不写任何配置文件
- **WHEN** 任意覆盖被设置
- **THEN** WORKFLOW.md 与目标目录的 `.opencode/` 内容不变

### Requirement: /auto 权限姿态切换
`/auto` SHALL 支持 `on`（本会话后续所有轮放开）、`off`/`reset`（回到配置默认）、`once`（仅下一轮放开，用完即弃）与无参数（回显当前姿态及其来源：会话覆盖 / 项目条目 / 全局）。`on` SHALL 落库（重启后仍生效），`once` SHALL 只存在于内存。放开 SHALL 只影响是否传 `--auto`，SHALL NOT 改变目标项目自身的 `deny` 规则。

#### Scenario: auto on 后续轮放开
- **WHEN** 执行 `/auto on` 并继续几轮
- **THEN** 这些轮的命令都带 `--auto`，直到 `/auto off`、`reset` 或会话结束

#### Scenario: auto once 只作用于下一轮
- **WHEN** 执行 `/auto once` 后有新一轮
- **THEN** 只有该轮带 `--auto`，其后各轮回到配置默认

#### Scenario: 无参数回显姿态与来源
- **WHEN** 执行 `/auto`
- **THEN** 回复当前姿态，并说明它来自会话覆盖、项目条目还是全局配置

### Requirement: 卡片上的权限按钮与姿态显示
最新一轮卡片的控制行 SHALL 提供 `🔐 权限` 按钮；点击时若当前未放开，SHALL 以同一张卡片返回确认行（`[✅ 本会话放开] [⚡ 仅下一轮] [✖ 取消]` 与"目标仓库 deny 仍生效"说明），放开 SHALL 在确认后才生效；若当前已 `on` 或 `once`，同一点击 SHALL 立即收回。卡片头部 SHALL 持续显示当前姿态（`🔓 auto` / `⚡ 下轮放开`，默认态不显示或显示 `🔒`）。

#### Scenario: 打开需要确认
- **WHEN** 在默认态点击 `🔐 权限`
- **THEN** 卡片原地变为确认行，姿态此时尚未改变
- **AND** 点击 `✅ 本会话放开` 后姿态变为会话级放开且头部显示 `🔓 auto`

#### Scenario: 取消后可再次打开
- **WHEN** 点击 `🔐 权限` 后在确认行选择 `✖ 取消`，随后再次点击 `🔐 权限`
- **THEN** 再次出现确认行（重投去重以**该次渲染的按钮 value**为单位，重新渲染后的点击不会被误判为重投）

#### Scenario: 收回立即生效
- **WHEN** 已 `🔓 auto` 时点击同一按钮
- **THEN** 姿态立即回到配置默认，头部不再显示 `🔓 auto`

#### Scenario: 仅下一轮
- **WHEN** 在确认行选择 `⚡ 仅下一轮`
- **THEN** 头部显示 `⚡ 下轮放开`，下一轮结束后该标记消失

#### Scenario: 封存卡片不带该按钮
- **WHEN** 查看已封存的轮次卡片
- **THEN** 其中不出现 `🔐 权限` 按钮

### Requirement: /name 会话改名
`/name <文本>` SHALL 把该会话的可读名（`direct_sessions.name`，卡片头部与 TUI 直连区块所用）改为给定文本（折叠空白、截断 80 字符），并在 ACK 回显新名；无参数的 `/name` SHALL 回显当前会话名与用法。改名 SHALL NOT 影响 session_id、目录或话题。

#### Scenario: 改名立即生效
- **WHEN** 在会话内执行 `/name 磁盘巡检`
- **THEN** ACK 回显新名，且随后刷新的卡片头部与 TUI 区块都显示「磁盘巡检」

#### Scenario: 无参数回显
- **WHEN** 执行 `/name`
- **THEN** 回复当前会话名与用法，不做修改

### Requirement: 每轮启动记录生效命令与姿态
每轮启动时系统 SHALL 以 info 级记录一行 `direct turn starting`，字段包含 `root_id`、`dir`、生效的 `agent`/`model`、`auto_approve`（本轮是否传 `--auto`）、`continuation` 与**完整的 spawn 命令**（超长时截断，保证参数可见）。以便逐轮核对"这一轮到底带了哪些参数"。

#### Scenario: 命令与姿态可逐轮核对
- **WHEN** 任意一轮启动
- **THEN** 日志出现含 `--dir`、`auto_approve` 与该轮 agent 的 `direct turn starting` 记录
- **AND** `/auto once` 之后的下一轮记录 `auto_approve: true`，再下一轮恢复 `false`

### Requirement: 会话命令 /new 与 /status
`/new` SHALL 在同一话题内清除当前 opencode 会话引用（`session_id`、`last_prompt`）并以清空的上下文开启后续轮次，SHALL 保留话题、目录与会话名，并 SHALL 删除被放弃的旧 opencode 会话（与 `/done` 相同的清理，避免孤儿会话永久累积——没有 `/resume`，旧上下文从话题侧本就不可达）；ACK SHALL 说明上下文已重置且旧会话已删除。`/status` SHALL 以一张 markdown 卡片回显：目录、session id、agent/model（含覆盖）、权限姿态、turns/tokens、队列深度与空闲时长。

#### Scenario: /new 清空上下文但保留话题
- **WHEN** 在话题内执行 `/new`
- **THEN** 后续轮不带 `-s`（新会话），话题、目录与名称不变，旧 opencode 会话被删除，ACK 说明上下文已重置

#### Scenario: /status 回显仪表盘
- **WHEN** 执行 `/status`
- **THEN** 回复一张卡片，含目录、session、agent/model、权限姿态、turns/tokens、队列与空闲时长

### Requirement: 运行中卡片心跳刷新
turn 运行期间系统 SHALL 至少每 5 秒刷新一次该轮卡片（复用既有 flush 路径），使头部与分隔行展示的运行时长持续更新；turn 结束 SHALL 停止心跳。

#### Scenario: 长轮时长持续走动
- **WHEN** 某轮持续运行超过 10 秒且期间没有工具事件
- **THEN** 卡片仍被周期刷新，运行时长随之增长

### Requirement: 附件进入本轮 prompt
直连会话收到带附件的消息时 SHALL 下载每个附件、写入 tasking 自有 inbox 目录（`<workspace.root>/direct-inbox/<root_id>/`，SHALL NOT 写入用户的目标仓库），并把**绝对路径**追加到该轮 prompt（用户原文在前，每个附件一行；无文字时补一句引导语）。单个附件 SHALL 有体积上限（默认 20MB），超限 SHALL 在话题内说明并跳过。附件下载失败 SHALL 在话题内可见；若该消息仍有文字，SHALL 继续执行该轮并带上失败说明。**仅含附件、没有文字**的消息 SHALL 正常开启一轮（不再回"暂仅支持文本消息"）。该会话的 inbox 目录 SHALL 在 `/done`、`/new` 与 TTL 过期时随会话一起清理。

#### Scenario: 文字+截图一条消息
- **WHEN** 收到 `post` 富文本（文字 + 图片）
- **THEN** 该轮 prompt 含用户原文与图片的绝对路径，agent 可按路径读取

#### Scenario: 仅附件也能起一轮
- **WHEN** 话题内收到一条只有图片（无文字）的消息
- **THEN** 系统开启一轮，prompt 含该图片路径与引导语，不再回"暂仅支持文本消息"

#### Scenario: 下载失败不静默
- **WHEN** 某附件超过体积上限或下载失败
- **THEN** 话题内出现说明；若仍有文字，该轮照常执行并注明该附件不可用

#### Scenario: 仅附件且全部失败则不开跑
- **WHEN** 消息仅含附件，且所有附件都下载失败或超限
- **THEN** 系统 SHALL NOT 以空 prompt 开跑，话题内说明附件未能读取

#### Scenario: 不污染目标仓库
- **WHEN** 任意附件被落盘
- **THEN** 文件位于 tasking 的 inbox 目录，目标仓库工作区不新增文件

#### Scenario: 会话结束清理附件
- **WHEN** 执行 `/done`（或 `/new`、TTL 过期）
- **THEN** 该会话的 inbox 目录被删除

### Requirement: 多消息收集模式（/collect、/send、/cancel）
系统 SHALL 支持手动收集模式：`/collect` 开启后，话题内的普通消息（含附件）SHALL 只被收集并回执（`📥 已收集 N 条`），SHALL NOT 立即开跑；`/send` SHALL 把缓冲合并为**一轮**提交（多条以 `\n---\n` 连接）；`/cancel` SHALL 丢弃缓冲并退出。收集模式 SHALL 有**空闲超时**（默认 10 分钟无新消息）并**自动提交**，避免"忘记提交"导致静默卡住。收集期间其它命令（`/status`、`/auto`、`/agent`…）SHALL 正常执行且不影响缓冲；`/done`、`/new`、TTL 过期 SHALL 丢弃缓冲。缓冲为内存态，daemon 重启即丢失（开启时的回执 SHALL 说明）。附件在收集时即下载落盘，路径随该条一起进缓冲。

#### Scenario: 收集多条（含附件）后一次提交
- **WHEN** `/collect` 后依次发"这是报错 + 截图"与"再补充一句"，然后 `/send`
- **THEN** 这些内容合并为**一轮**，prompt 同时含两段文字与图片的绝对路径

#### Scenario: 超时自动提交
- **WHEN** 收集模式下超过空闲超时没有新消息
- **THEN** 系统自动把缓冲提交为一轮，并在话题内说明是超时提交

#### Scenario: 取消丢弃
- **WHEN** 收集模式下执行 `/cancel`
- **THEN** 缓冲被丢弃、不产生任何轮次，回执说明丢弃条数

#### Scenario: 命令不受收集影响
- **WHEN** 收集模式下执行 `/status`
- **THEN** 状态卡正常返回，缓冲保持不变，随后 `/send` 仍能提交全部收集内容

### Requirement: 命令回执以卡片呈现
直连会话的**信息类**命令回执（`/help`、`/auto` 查看、`/collect` 状态、`/agent` 查看、`/model` 查看）SHALL 以飞书卡片呈现，而非纯文本；卡片不可用（无上传能力或发送失败）时 SHALL 回落为纯文本。`/auto` 查看卡与 `/collect` 状态卡 SHALL 提供操作按钮（`/auto on|once|off`、开始收集/提交/丢弃），点击 SHALL 执行与对应命令相同的动作，并就地刷新被点击的那张卡。转瞬即逝的回执（`📥 已收集 N 条`、附件超限/失败告警、未知命令提示、`/done` 确认等）SHALL 保持纯文本。

#### Scenario: /help 返回卡片
- **WHEN** 话题内执行 `/help`
- **THEN** 返回一张卡片（含续聊、富输入与命令清单），而非纯文本；卡片不可用时回落纯文本

#### Scenario: /auto 卡片按钮生效
- **WHEN** 点击 `/auto` 查看卡上的"本会话放开"按钮
- **THEN** 会话覆盖被置为 `on`（下一轮生效），返回 toast，且该卡就地刷新为新的姿态

#### Scenario: /collect 卡片按钮驱动收集
- **WHEN** 点击"开始收集"→ 发若干消息 → 点击"提交为一轮"
- **THEN** 缓冲内容合并为**一轮**执行，回执说明提交条数；点"丢弃"则缓冲被丢弃且不产生轮次

#### Scenario: 信息卡回落纯文本
- **WHEN** 适配器没有卡片发送能力（或发卡失败）
- **THEN** 同一命令以纯文本回执，命令语义不变

