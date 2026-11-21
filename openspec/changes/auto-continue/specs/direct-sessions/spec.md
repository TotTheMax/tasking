## ADDED Requirements

### Requirement: Auto-continue 命令面

直连会话 SHALL 支持以下 `/loop` 命令，且仅在直连话题内生效：

- `/loop`：返回状态信息卡。
- `/loop on [N]`：为**当前或下一条用户任务**开启/恢复 Auto-continue；SHALL NOT 自己提交 turn。若已有用户轮在跑，则在该轮结束后继续。带 N SHALL 设置会话预算偏好并把已用计数归零；不带 N SHALL 沿用会话偏好，否则用配置默认。
- `/loop start [N]`：立即提交一个 Auto-continue turn；当前有 turn 在跑时 SHALL 等该 turn 结束后开始。带 N SHALL 重置预算；不带 N SHALL 在 armed/paused 时使用剩余预算，否则使用会话偏好/配置默认。会话还没有任何任务（`turns === 0` 且 `last_prompt == null`）时 SHALL 拒绝并提示先发任务。
- `/loop off`：软关闭；SHALL NOT 中断当前 turn，当前 turn 结束后不再续。
- `/loop prompt`：显示当前生效提示词与来源。
- `/loop prompt <文本>`：设置会话级提示词覆盖，下一轮 Auto-continue turn 生效；SHALL 持久化且长度 ≤ 2000 字，空值拒绝。
- `/loop prompt reset`：清除会话覆盖，回到配置默认。

`/loop` 及其子命令的回复 SHALL 使用无按钮信息卡（`buildInfoCard`），卡片发送失败时回落为纯文本。`/loop` 在 intake 群 SHALL 回复“请在 /chat 话题内使用”；在 Jira 绑定话题 SHALL 由 comment-bridge 回复“仅直连会话支持”且不桥接；在 done/expired 会话 SHALL 提示重新 `/chat`。

#### Scenario: on 只 arm，下一条任务才开始

- **WHEN** 用户在空闲直连话题发送 `/loop on`
- **THEN** 系统返回开启信息卡，不提交任何 opencode turn；用户随后发送任务消息时，该轮作为用户轮执行，结束后才开始 `自动 1/N`

#### Scenario: start 立即开干

- **WHEN** 已有任务的直连会话空闲，用户发送 `/loop start`
- **THEN** 系统立即用当前续跑提示词提交一个 Auto-continue turn，卡片头部显示 `自动 1/N`

#### Scenario: start 在当前轮之后开始

- **WHEN** 某 turn 运行中，用户发送 `/loop start`
- **THEN** 系统不中断当前 turn，并在该 turn 结束后提交 Auto-continue turn

#### Scenario: start 无任务时拒绝

- **WHEN** 直连会话还没有执行过任何任务，用户发送 `/loop start`
- **THEN** 系统拒绝并提示先发送任务消息，不提交 turn

#### Scenario: off 是软关闭

- **WHEN** 某 turn 运行中，用户发送 `/loop off`
- **THEN** 当前 turn 继续跑完，系统不再提交后续 Auto-continue turn

#### Scenario: prompt 设置与重置

- **WHEN** 用户发送 `/loop prompt 继续实现并跑测试`，随后发送 `/loop prompt reset`
- **THEN** 第一次返回信息卡并将会话覆盖持久化，下一次 Auto-continue turn 使用该文本；第二次清除覆盖并回到配置默认

#### Scenario: 非直连话题的提示

- **WHEN** 用户在 intake 群发送 `/loop on`
- **THEN** 系统回复“请在 /chat 话题内使用 `/loop`”，不创建会话、不执行 turn

#### Scenario: 终态会话的提示

- **WHEN** 用户在 done 或 expired 的直连话题发送 `/loop`
- **THEN** 系统提示会话已结束/过期，并提示重新 `/chat`

### Requirement: Auto-continue 生命周期与停止规则

当 Auto-continue 处于 armed 且未暂停时，每个 turn 结束后系统 SHALL 使用当前 Auto-continue prompt 提交下一轮；只有 Auto-continue turn 消耗预算，用户轮 SHALL NOT 消耗预算。

系统 SHALL 区分软暂停与硬停：

- **软暂停**：连续低产出、连续重复、最后文本像提问。SHALL 保持 armed，不提交下一轮；用户下一次“会启动用户轮”的动作（普通文本/附件、`/send`、卡片重试）执行完后 SHALL 自动恢复；纯查看/控制命令（`/status`、`/help`、`/loop prompt`、`/loop` 查看、`/collect` 仅收集）SHALL NOT 恢复；`/loop start` SHALL 立即恢复。
- **硬停**：`/stop`、`/loop off`、预算用完、会话结束、本轮 `failed`、`permission_timeout`、用户或 daemon 触发的 `interrupted`。硬停 SHALL 清空 Auto-continue 状态并发送原因文本。

`turn_timeout` 与 `inactivity_timeout` SHALL 作为普通 Auto-continue turn 重试：使用同一份续跑提示词，消耗一个预算名额；不新增专用提示词或独立重试计数器。若用户轮在 Auto-continue armed 状态下以这两种超时结束，也 SHALL 按普通自动轮重试（消耗预算）。`permission_timeout`、`failed`、用户/daemon 中断 SHALL NOT 重试。

优先级 SHALL 为：用户硬停 > 失败/审批超时/用户中断 > 超时重试（预算允许） > 预算用完 > 提问 > 重复 > 低产出 > 继续。预算用完 SHALL 优先于暂停信号：预算为 0 时即使最后文本像提问也 SHALL 硬停。

用户消息在 Auto-continue turn 运行中到达时 SHALL 排队；当前 turn 结束后 SHALL 先执行用户轮，再恢复 Auto-continue；用户轮 SHALL 重置低产出/重复计数。

#### Scenario: 成功轮后自动继续

- **WHEN** Auto-continue armed，某 Auto-continue turn 成功结束且未命中停止规则
- **THEN** 系统提交下一轮，卡片显示递增的 `自动 n/N`

#### Scenario: 低产出暂停与用户恢复

- **WHEN** 连续 2 轮低产出触发暂停，随后用户发送“先修 lint”
- **THEN** 系统暂停并发送原因文本；用户轮执行完后自动恢复 Auto-continue

#### Scenario: 纯命令不恢复暂停

- **WHEN** Auto-continue 暂停中，用户发送 `/status`
- **THEN** 系统只返回状态卡，不提交 turn，也不恢复 Auto-continue

#### Scenario: 用户消息抢占自动轮

- **WHEN** Auto-continue turn 运行中，用户发送一条任务消息
- **THEN** 该消息排在当前 turn 之后；它作为用户轮执行，不消耗预算；执行完后若仍 armed 则继续自动轮

#### Scenario: /stop 硬停

- **WHEN** Auto-continue 运行中或暂停中，用户发送 `/stop`
- **THEN** 系统中断当前 turn（若有）、清空队列、关闭 Auto-continue，并发送中断说明

#### Scenario: 失败硬停

- **WHEN** 某 Auto-continue turn 以 `failed` 或 `permission_timeout` 结束
- **THEN** 系统不重试，关闭 Auto-continue 并发送原因文本

#### Scenario: 超时重试

- **WHEN** 某 Auto-continue turn 以 `turn_timeout` 或 `inactivity_timeout` 结束且预算还有剩余
- **THEN** 系统用同一份 Auto-continue prompt 提交下一轮，并把它计入预算

#### Scenario: 超时且预算用完

- **WHEN** 某 Auto-continue turn 超时且预算已用完
- **THEN** 系统硬停并发送“超时 + 预算用完”的原因文本，不再重试

#### Scenario: 预算用完优先于提问

- **WHEN** 最后一个预算轮结束时模型在提问
- **THEN** 系统硬停并发送预算用完的原因（文本中带出问题），不进入暂停

#### Scenario: 会话结束后不再续

- **WHEN** 用户 `/done`、`/new` 或会话 TTL 过期
- **THEN** 系统关闭 Auto-continue，不提交任何后续 turn

### Requirement: Auto-continue 判定规则

系统 SHALL 使用以下行为信号判定暂停：

- **低产出**：`toolCalls === 0` 且 `outputTokens < 500` 且 `textChars < 600`；连续 `no_progress_streak` 轮 → 暂停。`textChars` SHALL 为本轮所有可见 assistant text 的总字符数（不是只取最后一段）；`outputTokens` SHALL 为 turn usage 的 output（不含 input/context、不含 reasoning）；任意 ≥1 个工具调用的 turn SHALL NOT 判为低产出。
- **重复**：当前 Auto-continue turn 的最后一段文本与上一个 Auto-continue turn 的最后一段文本，归一化（NFKC、小写、去代码块、去空白与标点）后字符 3-gram Sørensen–Dice ≥ 0.9；且两轮 `fileMutations === 0`（`write`/`edit`/`patch`/`apply_patch`/`multiedit`；`bash` 不算文件写操作）；连续 `no_progress_streak` 轮 → 暂停。空文本 SHALL NOT 参与重复判定。
- **提问**：最后一段文本以 `?` 或 `？` 结尾，或最后一句/分句含“请确认 / 需要你 / 是否 / 要不要 / 等你确认”或英文 `confirm` / `should I` / `do you want` → 暂停。

低产出、重复计数 SHALL 在用户轮、文件写操作、非重复文本、`/loop on N`、`/loop start`、超时重试时重置。`prevLastText` SHALL 只跨连续的 Auto-continue turns 保留，用户轮或重新 arm 时清空。轮次时长 SHALL 只记录、不参与判定。

判定优先级 SHALL 遵循生命周期要求的顺序；多个暂停信号同时命中时，原因 SHALL 按“提问 > 重复 > 低产出”选择。

#### Scenario: 连续低产出暂停

- **WHEN** 两个连续 Auto-continue turn 都是 0 工具调用、output 180/210 tokens、文本 320/280 字
- **THEN** 第二个 turn 结束后暂停，原因文本包含低产出指标

#### Scenario: 只读文件不算低产出

- **WHEN** 某 Auto-continue turn 调用了 `read` 或 `git status`，但没有写文件
- **THEN** 该 turn 不算低产出，不增加低产出计数

#### Scenario: 重复文本暂停

- **WHEN** 两个连续 Auto-continue turn 的最后文本归一化后 3-gram Dice ≥ 0.9，且两轮都没有文件写操作
- **THEN** 第二个 turn 结束后暂停，原因为重复

#### Scenario: 有文件写入不判重复

- **WHEN** 两个连续 turn 的最后文本相似，但其中任一轮有 `edit` / `write` / `patch` 等文件写操作
- **THEN** 不因重复暂停

#### Scenario: 提问暂停

- **WHEN** 某 Auto-continue turn 的最后文本以 `？` 结尾，或包含“需要你确认”
- **THEN** 该 turn 结束后立即暂停，原因为模型在提问

#### Scenario: 用户轮重置计数

- **WHEN** 低产出计数为 1，用户发送一条任务消息并执行
- **THEN** 低产出与重复计数归零，用户轮结束后重新开始计数

#### Scenario: 超时重试重置计数

- **WHEN** 某 Auto-continue turn 超时并触发重试
- **THEN** 低产出、重复计数与 `prevLastText` 重置，重试轮重新开始判定

### Requirement: Auto-continue 预算与提示词

Auto-continue budget SHALL 默认 5，允许范围 1–20；只计 Auto-continue turns，用户轮不消耗、不改变 `n/N`。`/loop on N` 与 `/loop start N` SHALL 设置会话级预算偏好（runtime）；不带 N 时 SHALL 沿用该偏好，否则使用 `feishu.direct.auto_continue.budget`。daemon 重启 SHALL 将预算偏好恢复为配置默认。暂停 SHALL 保留剩余预算；预算用完 SHALL 硬停。

Auto-continue prompt SHALL 默认取 `feishu.direct.auto_continue.prompt`（默认“继续未完成的部分。不要重复已完成的内容，也不要总结。”）；`/loop prompt <文本>` SHALL 设置会话覆盖并持久化到 `direct_sessions.loop_prompt`，最大 2000 字、空值拒绝；`/loop prompt reset` SHALL 清除覆盖。`/new` SHALL NOT 清除提示词覆盖；daemon 重启 SHALL 保留提示词覆盖。`agent.max_turns` SHALL 保持 Jira worker 专属语义，不受本变更影响。

#### Scenario: 默认预算

- **WHEN** 配置缺省，用户 `/loop on` 后执行任务
- **THEN** 自动轮依次显示 `自动 1/5`、`自动 2/5`，最多 5 轮

#### Scenario: on N 设置会话预算

- **WHEN** 用户先 `/loop on 8`，随后 `/loop start`
- **THEN** 本次 Auto-continue 使用 8 轮预算，卡片显示 `自动 1/8`

#### Scenario: 用户轮不消耗预算

- **WHEN** 已执行 `自动 1/5`，用户插入一条消息并执行
- **THEN** 下一条自动轮仍为 `自动 2/5`

#### Scenario: 重启回配置默认

- **WHEN** 用户设置 `/loop on 8` 后 daemon 重启
- **THEN** Auto-continue 关闭；下一次 `/loop start` 使用配置默认 5，而不是 8

#### Scenario: 提示词覆盖持久化

- **WHEN** 用户 `/loop prompt 继续写报告` 后 daemon 重启
- **THEN** 覆盖仍生效；下一次 Auto-continue turn 使用“继续写报告”

#### Scenario: prompt reset

- **WHEN** 用户 `/loop prompt reset`
- **THEN** 覆盖清除，下一次 Auto-continue turn 使用配置默认提示词

#### Scenario: /new 保留提示词覆盖

- **WHEN** 用户设置会话提示词后发送 `/new`
- **THEN** opencode 上下文清空、Auto-continue 关闭，但会话提示词覆盖保留

#### Scenario: agent.max_turns 不受影响

- **WHEN** 用户修改或使用 `/loop` 的预算
- **THEN** Jira worker 的 `agent.max_turns` 取值与语义保持不变

### Requirement: Auto-continue 过程卡与结果面

`verbosity: detailed` 时，Auto-continue turn 的每张分段卡片 SHALL 在会话状态头部追加 `· 🔄 自动 n/N`（n 为本次 arming 的第几个自动轮，N 为预算）；位置 SHALL 在 `ctx` 之后、`片段 N` 之前；同一 turn 的所有分段 SHALL 显示同一标记；用户轮 SHALL NOT 显示该标记。

轮次完成消息（结果面）SHALL 保持现状：每轮仍发送恰好一条纯回答 + 统计行，SHALL NOT 增加自动标记、暂停/停止原因或任何额外头部。

暂停/停止 SHALL 使用单独一条普通文本消息，包含原因与恢复/重新开启方式；SHALL NOT 重复上一轮答案；SHALL NOT 给最后一张过程卡盖停止章、改 footer 或移除按钮。

`/loop` 命令回执 SHALL 使用无按钮信息卡；SHALL NOT 新增卡片按钮。`quiet` / `summary` 下 SHALL NOT 有过程卡自动标记；结果仍为文本；暂停/停止文本 SHALL 照常发送。

#### Scenario: 自动轮头部标记

- **WHEN** detailed 模式执行 `自动 2/5`
- **THEN** 该轮每张分段卡片的头部包含 `· 🔄 自动 2/5`

#### Scenario: 用户轮无标记

- **WHEN** 用户发送任务消息并执行
- **THEN** 该轮过程卡头部不包含 `🔄 自动`

#### Scenario: 分段卡都带标记

- **WHEN** 一个 Auto-continue turn 被拆成 3 张分段卡片
- **THEN** 3 张卡片的头部都显示同一个 `· 🔄 自动 n/N`

#### Scenario: 结果消息不变

- **WHEN** 一个 Auto-continue turn 完成
- **THEN** 结果消息仍只有最后一轮回答与统计行，不出现自动标记或暂停/停止原因

#### Scenario: 暂停文本

- **WHEN** 连续低产出触发暂停
- **THEN** 系统在结果消息之后发送一条文本，说明低产出原因与“回复任意消息自动继续”

#### Scenario: 停止文本

- **WHEN** 预算用完触发硬停
- **THEN** 系统发送一条文本，说明预算用完并给出 `/loop start` / `/loop on N` 的恢复方式

#### Scenario: 最后一张卡片保留按钮

- **WHEN** Auto-continue 暂停或硬停
- **THEN** 最后一张过程卡不被封存、不盖停止章，原有 `🔁 重试` / `📄 完整输出` / `🛑 结束` 按钮保留

#### Scenario: quiet/summary 无自动标记

- **WHEN** `verbosity: summary` 或 `quiet` 的会话执行自动轮
- **THEN** 没有过程卡或自动标记；结果仍按原 verbosity 发送；暂停/停止文本照常发送

### Requirement: Auto-continue 会话状态与清理

Auto-continue turn SHALL NOT 覆盖 `direct_sessions.last_prompt`；卡片「🔁 重试」SHALL 继续重跑最近一次用户任务，而不是“继续”。`/new`、`/done`、TTL 过期、TUI 删除会话 SHALL 关闭 Auto-continue 并清除内存 runtime；`/stop` SHALL 关闭 Auto-continue；`/loop off` SHALL 关闭 Auto-continue 但保留会话预算偏好。daemon 重启 SHALL 关闭 Auto-continue，但保留 `loop_prompt` 覆盖。

#### Scenario: 自动轮后重试仍重跑原任务

- **WHEN** 自动轮执行过若干轮后，用户点击「🔁 重试」
- **THEN** 系统以 `last_prompt`（最近用户任务）发起新一轮，而不是以续跑提示词

#### Scenario: /new 关闭 Auto-continue

- **WHEN** Auto-continue armed 时用户发送 `/new`
- **THEN** 会话上下文清空、Auto-continue 关闭，后续不自动提交 turn

#### Scenario: TTL 过期关闭 Auto-continue

- **WHEN** Auto-continue armed 的会话超过 `idle_ttl_ms`
- **THEN** 会话标记 expired、runtime 清除，Auto-continue 不再提交 turn

#### Scenario: /loop off 保留预算偏好

- **WHEN** 用户 `/loop on 8` 后发送 `/loop off`，随后再 `/loop start`
- **THEN** 下一次 Auto-continue 仍使用 8 轮预算偏好（除非 daemon 重启或传新的 N）

#### Scenario: 重启关闭循环

- **WHEN** daemon 在 Auto-continue armed 时重启
- **THEN** 恢复逻辑将会话标 idle 并说明中断；Auto-continue 关闭，不自动提交 turn
