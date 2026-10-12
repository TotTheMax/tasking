## ADDED Requirements

### Requirement: /chat 在 intake 群发起直连会话
`CommentBridge.discoverIntake` SHALL 把以 `/chat` 开头的 intake 群根消息交给 `DirectSessionManager` 处理（而非当作未知命令）。`/chat <project> <消息>` SHALL 按 `feishu.direct.projects` 名称映射（大小写不敏感）解析目录；`/chat /绝对路径 <消息>` SHALL 使用该绝对路径（ad-hoc path 模式）。两者均 SHALL 以首条消息内容作为第一 turn 的 prompt 创建直连会话，并立即在原消息的话题回复中 ACK（`✅ 会话已创建 …`）。`/chat` 根消息 SHALL 幂等：若 `direct_sessions` 中已存在该 root_id（daemon 重启/断线导致的 intake sweep 重投、或 WS 重放），系统 SHALL NOT 重建会话或重跑首 turn，SHALL 回复提示（活跃会话提示直接在话题内回复；done/expired 提示重新发起新 `/chat`）。该持久去重与 `/issue` 的 `hasRootId` 守卫同理。

#### Scenario: 按项目名创建会话
- **WHEN** intake 群收到根消息 `/chat tasking 帮我跑一下测试`，且 `feishu.direct.projects` 含 `tasking: /repos/tasking`
- **THEN** 系统在 `/repos/tasking` 创建直连会话，首 turn prompt 为 `帮我跑一下测试`，并在该消息的话题内回复创建 ACK

#### Scenario: 重投的 /chat 根消息不重建会话
- **WHEN** 同一条 `/chat` 根消息在 daemon 重启后被 intake sweep 再次投递（该 root_id 已有会话）
- **THEN** 系统不再新建会话、不重跑首 turn、不覆盖既有 session_id，回复“会话已存在/已结束”提示

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
用户消息入队时系统 SHALL 立即 ACK；turn 结束后系统 SHALL 在话题内发送恰好一条总结消息：最后一刻 assistant 文本 + 一行统计（耗时、工具调用次数、token 用量）。`feishu.direct.verbosity: detailed` 时 SHALL 为每个已完成的工具调用额外发送一条精简消息（工具标题，截断）；`summary`（默认）时不发送逐工具消息但保留统计行；`quiet` 时统计行也省略（仅最终回复正文 + 权限拒绝提示）。总结文本超长时 SHALL 截断。turn 失败/超时/被打断 SHALL 以明确失败说明告知话题。

#### Scenario: summary 模式的交付形状
- **WHEN** verbosity=summary 的会话完成一次成功的 turn
- **THEN** 话题内只新增一条 bot 消息，含 assistant 最终文本与一行统计

#### Scenario: detailed 模式镜像工具调用
- **WHEN** verbosity=detailed 的会话完成一次含 3 个工具调用的 turn
- **THEN** 话题内新增 3 条工具消息与 1 条总结消息

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
直连话题内 `/done` SHALL 将会话标记为 done 并回复累计统计（turn 数、token 总量）；之后话题内消息 SHALL 收到一次性终结提示后静默。`/done` SHALL 同时删除该 opencode 磁盘会话（`opencode session delete <session_id>`）、清空其 `direct:<root_id>` ActivityStore 缓冲并清理内存 runtime/totals；`direct_sessions` 行 SHALL 保留（以便终结提示仍生效）。`/stop` SHALL 中断当前正在执行的 turn（通过 AbortSignal 终止子进程）、回复已中断说明，并将会话转回 idle；无 turn 在跑时 `/stop` SHALL 回复无运行中任务，且 SHALL NOT 删除会话。

#### Scenario: /done 结束会话并清理
- **WHEN** 直连话题内发送 `/done`
- **THEN** 会话状态变为 done，bot 回复累计统计，后续追问收到一次性提示
- **AND** 该会话的 opencode session 被删除，`direct:<root_id>` 活动缓冲被清空

#### Scenario: /stop 中断运行中 turn
- **WHEN** turn 运行中话题内发送 `/stop`
- **THEN** 子进程被终止，bot 回复中断说明，会话回到 idle 可继续追问

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
直连会话映射 SHALL 持久化于 `bindings.db` 的 `direct_sessions` 表（root_id 主键；chat_id、project、name、path、session_id、thread_id、status（`running`|`idle`|`done`|`expired`）、last_msg_id、turns、input_tokens、output_tokens、total_tokens、updated_at）；`name` 为创建时首条 prompt 的可读摘要，`turns`/token 列为累计用量；缺失列 SHALL 通过 `ALTER TABLE` 迁移补齐。opencode session 的标题 SHALL 保持 opencode 原生按内容自动生成（tasking 不传 `--title`）。daemon 重启后 SHALL 从表恢复：`running` 状态的会话（进程已随重启消失）SHALL 被标记为 idle 并向话题说明中断，`idle` 会话 SHALL 可继续追问，`done/expired` 会话保持终结。新消息去重 SHALL 按会话游标（create_time 秒）+ 会话内已见消息 id 集合（持久化于 direct_sessions.seen_ids，有界）进行：同一秒内到达的不同消息 SHALL 各自被处理，已处理消息的重复投递 SHALL 被跳过（含 daemon 重启后的 sweep 重投）。Sweep SHALL 覆盖直连话题：按持久化的 thread_id 补拉停机/断线窗口内的线程消息，游标保证不重复处理。

#### Scenario: 重启后 idle 会话可继续
- **WHEN** daemon 重启，表中有 idle 会话，其话题内到达新消息
- **THEN** 系统以持久化的 session_id 续跑，上下文不丢失

#### Scenario: 重启时运行中会话被标记中断
- **WHEN** daemon 在 turn 执行中重启，表中有 running 会话
- **THEN** 恢复逻辑将该会话标记 idle 并向话题发送中断说明

#### Scenario: 重启后消息不重复消费
- **WHEN** 同一消息在重启前后被事件通道与 sweep 各投递一次
- **THEN** 该消息只被处理一次（按会话游标去重）

#### Scenario: 同一秒内到达的不同消息都被处理
- **WHEN** 两条不同消息的 create_time 处于同一秒且先后到达
- **THEN** 两条消息各自触发处理（合并或先后续跑），后者不被游标吞掉

### Requirement: 空闲 TTL 过期
直连会话空闲超过 `feishu.direct.idle_ttl_ms`（默认 30 天）SHALL 在管理器慢速定时器上被标记为 expired；过期 SHALL 同时删除该 opencode 磁盘会话并清空其 `direct:<root_id>` ActivityStore 缓冲与内存 runtime/totals（`direct_sessions` 行保留），仅停止该话题的后续处理。项目移除不影响既有会话（路径在创建时冻结）。

#### Scenario: 超过 TTL 的会话过期
- **WHEN** 某 idle 会话的 updated_at 距今超过 idle_ttl_ms
- **THEN** 其状态变为 expired，话题内新消息收到终结提示，opencode session 被删除

### Requirement: feishu.direct 零配置默认可用
`feishu.enabled` 为 true 时直连功能 SHALL 默认启用（`feishu.direct` 段缺失 = 全默认值；段内显式 `enabled: false` 关闭）。`projects` 可为空（path 模式即可用）。所有其他项 SHALL 有合理默认值：`path_roots: []`、`auto_approve: false`、`verbosity: summary`、`max_concurrent: 5`、`idle_ttl_ms: 30 天`。

#### Scenario: 零配置 path 模式可用
- **WHEN** WORKFLOW.md 的 feishu 段不含 `direct` 子块（feishu.enabled: true）
- **THEN** 直连默认启用，`/chat /绝对路径 <消息>` 直接可用，无需任何新增配置

#### Scenario: 两行配置启用项目名模式
- **WHEN** WORKFLOW.md 的 feishu 段仅含 `direct: { projects: { tasking: /repos/tasking } }`
- **THEN** 解析后的配置填满所有默认值，`/chat tasking …` 可用

#### Scenario: 显式关闭
- **WHEN** `feishu.direct.enabled: false`
- **THEN** 直连不激活，`/chat` 按未知命令处理
