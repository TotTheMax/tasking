## ADDED Requirements

### Requirement: 桥命令回执以卡片呈现
桥的信息类命令回执（`/help`、`/agent` 列表、`/issue` 列表、`/state` 查看）SHALL 以飞书交互卡片呈现，而非纯文本；适配器不具备发卡能力或发卡失败时 SHALL 回落为纯文本，命令语义不变。转瞬即逝的回执（intake `已收到 ✓`、话题 `✅ 已同步到 <key>`、参数错误/失败提示）SHALL 保持纯文本。`/help` 与 `/agent` 列表卡 SHALL 可带操作按钮（点击后在话题内触发对应查询）。

#### Scenario: /help 回卡片
- **WHEN** 人在群聊或话题内发 `/help`
- **THEN** 回一张列出 `/issue`、`/state`、`/agent`、`/help` 语法与适用上下文的卡片

#### Scenario: /agent 列表回卡片
- **WHEN** 人在任务话题内发 `/agent`（无参）
- **THEN** 回一张列出可用 agent 与当前值的卡片

#### Scenario: 从 /agent 卡直接切换 agent
- **WHEN** 人在任务话题内的 `/agent` 卡上点击某个 agent 按钮（或"↩️ 默认"）
- **THEN** 该任务的 `agent:<name>` 标签被更新（下一 turn 生效），与文本 `/agent <name>` 共用同一逻辑

#### Scenario: 卡片不可用时回落纯文本
- **WHEN** 适配器没有卡片发送能力，或发卡抛出 `TaskingError`
- **THEN** 同一命令以纯文本回执，命令行为不变

#### Scenario: 一次性回执保持纯文本
- **WHEN** intake 群收到非命令根消息并回 `已收到 ✓`
- **THEN** 该回执为纯文本消息，不是卡片

### Requirement: Jira 评论镜像为卡片
绑定的 Jira 评论同步到飞书话题时 SHALL 以交互卡片呈现，卡片 SHALL 含作者名与正文（正文按卡片预算截断），并 SHALL 提供 `打开 Jira` 的 `open_url` 按钮与 `📋 状态` 召唤按钮（点击 SHALL 异步在话题底部发布一张实时状态卡，不替换评论卡本身）（指向 `${baseUrl}/browse/${issueKey}`）；正文被截断时 SHALL 额外提供 `📄 完整输出` 按钮，点击 SHALL 把该评论全文作为 `.md` 文件发到话题（失败 SHALL 在话题内可见，而非静默）。评论数量、顺序与 sentinel 防环语义 SHALL 保持不变。机器人自身发出的卡片 SHALL NOT 被当作话题回复回灌 Jira。

#### Scenario: 短评论镜像为卡片
- **WHEN** Jira 上出现一条新评论
- **THEN** 话题内出现一张含作者与正文的卡片，且不产生纯文本镜像消息

#### Scenario: 长评论截断并可按需展开
- **WHEN** Jira 评论正文超过卡片预算
- **THEN** 镜像卡正文被截断并出现 `📄 完整输出` 按钮；点击后把全文作为 `.md` 文件发到话题

#### Scenario: 未截断的评论不出现完整输出按钮
- **WHEN** 评论正文在卡片预算内
- **THEN** 镜像卡不渲染 `📄 完整输出` 按钮（正文已在卡上，按钮无意义）

#### Scenario: 打开 Jira 按钮指向该 issue
- **WHEN** 点击镜像卡上的 `打开 Jira`
- **THEN** 浏览器打开 `${baseUrl}/browse/${issueKey}`

#### Scenario: 从评论卡召唤状态卡
- **WHEN** 用户点击评论镜像卡上的 `📋 状态`
- **THEN** 一张按实时状态构建的任务状态卡出现在话题底部（评论卡保持不变）

#### Scenario: 镜像卡不被回灌
- **WHEN** 桥下一跳读取话题回复
- **THEN** 机器人自己发的镜像卡（`sender_type: app`）被跳过，不产生新的 Jira 评论

### Requirement: 任务状态卡
每个 issue↔话题绑定 SHALL 维护一张**独立的任务状态卡**：绑定时发出，状态卡 SHALL 显示 issue key、当前状态与负责人，并 SHALL 提供 `🔀 转状态` 与 `🔄 刷新` 按钮。状态卡 SHALL 采用**拉取式刷新**：只在飞书侧动作发生时更新（转状态成功后、或用户查看时按实时查询重建），SHALL NOT 为同步 Jira 侧变更而周期性轮询并 PATCH。issue 消失（404）时 SHALL 被动地把卡片 PATCH 为已完结。状态卡消息 id SHALL 持久化于绑定记录；重新发布状态卡（`/state` 无参或 `📋 状态` 召唤）SHALL 为**召回式**：先删除旧状态卡消息（best-effort，失败不阻断）再在话题底部发送新卡并更新记录，避免旧卡残留堆积；PATCH 失败（卡片被删除、话题归档等）SHALL 重新发送一张状态卡并更新记录（自愈）。

#### Scenario: 绑定时发出状态卡
- **WHEN** `/issue` 建单并完成绑定
- **THEN** 话题内出现一张含 key/状态/负责人的任务状态卡

#### Scenario: 飞书侧转状态后原地更新
- **WHEN** 通过卡片按钮或 `/state <N|name>` 成功转状态
- **THEN** 已有状态卡被 PATCH 为新状态，不新增一条状态卡消息

#### Scenario: 刷新按钮按实时状态换卡
- **WHEN** 点击状态卡上的 `🔄 刷新`
- **THEN** 该卡被按实时查询到的当前状态与负责人原地替换

#### Scenario: 查看时按实时状态重建
- **WHEN** 点开 `🔀 转状态`（或发 `/state`）
- **THEN** 返回的卡片按**实时查询**到的当前状态与可用转换重建，不依赖卡面上可能已过期的旧值

#### Scenario: Jira 侧变更不主动同步
- **WHEN** issue 状态被直接在 Jira 侧变更（非飞书操作）
- **THEN** 飞书状态卡不主动更新，直到下一次查看或转状态（拉取式语义）

#### Scenario: issue 消失时被动收尾
- **WHEN** 轮询发现 issue 已不存在（404）
- **THEN** 绑定标为 terminal，且状态卡被 PATCH 为已完结

#### Scenario: 召回式重发不残留旧卡
- **WHEN** 再次发布状态卡（如再发一次 `/state`）
- **THEN** 旧状态卡消息被删除，新卡出现在话题底部，绑定记录指向新卡

#### Scenario: 状态卡失效后自愈
- **WHEN** PATCH 状态卡返回失败（如卡片已被删除）
- **THEN** 系统重新发送一张状态卡、更新绑定的 card message id，并记 WARN

### Requirement: 点击式转状态流程
`🔀 转状态` 按钮的语义 SHALL 是"现在就拉取该 issue 当前可用的转换"，而非执行卡片渲染时预置的转换。点击后 SHALL 实时查询 `GET /issue/{key}/transitions` 并把每个可用转换渲染成一个按钮；点选某个转换 SHALL 进入确认行（`确认`/`取消`），确认后才 SHALL 写入 Jira。转换成功后 SHALL 即时 nudge scheduler、PATCH 状态卡，并在话题内广播结果。取消 SHALL NOT 产生任何写操作。转换在确认时已不可用 SHALL 报错并刷新状态卡。

#### Scenario: 点击列出当前可用转换
- **WHEN** 人点击状态卡上的 `🔀 转状态`
- **THEN** 系统实时查询并回列出当前可用转换的按钮（不硬编码、不使用过期列表）

#### Scenario: 选中转换需二次确认
- **WHEN** 人点选其中一个转换
- **THEN** 出现确认行（确认/取消）；只有点"确认"才写入 Jira

#### Scenario: 取消不产生写操作
- **WHEN** 人在确认行点"取消"
- **THEN** 不调用任何 Jira 写接口，流程结束

#### Scenario: 确认后更新状态卡并 nudge
- **WHEN** 人确认转换且 Jira 接受
- **THEN** 状态卡被 PATCH 为新状态、scheduler 被即时 nudge、话题内广播转换结果

#### Scenario: 转换已不可用
- **WHEN** 确认时该转换已不在可用列表中
- **THEN** 系统返回错误提示并刷新状态卡，不写入 Jira

## MODIFIED Requirements

### Requirement: /state 命令转状态
`/state`（无参，在绑定话题内）SHALL 回/刷新任务状态卡（当前状态与负责人；可用转换经卡上 `🔀 转状态` 点击时**实时**列出，运行时发现、不硬编码状态名；卡片不可用时回落纯文本）。`/state <N|name>` SHALL 匹配可用转移、转状态；无/多义 SHALL 回列表。转状态 SHALL 与状态卡上的 `🔀 转状态` 流程共用同一份转换逻辑（文本命令与卡片按钮两条入口一致）。转完 SHALL 即时 nudge scheduler（复用 `requestRefresh`），不等下次轮询。

#### Scenario: 无参列可用转移
- **WHEN** 人在绑定话题发 `/state`
- **THEN** 回/刷新任务状态卡（当前状态与负责人），可用转换经 `🔀 转状态` 实时列出

#### Scenario: 编号转状态
- **WHEN** 人发 `/state 2`（2 对应一可用转移）
- **THEN** 转 issue 到该状态，并 PATCH 状态卡为新状态

#### Scenario: 转完即时 nudge
- **WHEN** `/state` 转完状态
- **THEN** 立即 nudge scheduler reconcile

#### Scenario: 不硬编码状态名
- **WHEN** `/state` 列转移
- **THEN** 状态名来自运行时 Jira 查询，非字面量硬编码

### Requirement: /help 命令
`/help` SHALL 列出 `/issue`/`/state`/`/agent`/`/help` 语法与各自适用上下文，并 SHALL 以交互卡片呈现（不可用时回落纯文本）。无 Jira 调用、无 LLM、`/` 前缀→不桥。

#### Scenario: help 列命令
- **WHEN** 人发 `/help`
- **THEN** 回命令列表与语法（卡片形式）
