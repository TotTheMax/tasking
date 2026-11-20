# 轮次完成以会话 idle 记录为准，不以 prompt 消息在分页窗口内的位置为准

`session.message.list` 默认只返回最新 50 条消息（`limit` 上限 200，`cursor.next` 才往旧翻），而 v2 的每个 step 基本对应一条 assistant 消息——实测真实会话约 1.15 条消息/工具调用。驱动器原先把「本轮完成」锚定在 `session.prompt` 返回的 prompt 消息必须仍在当前页内：一旦一轮产生超过 50 条消息，锚点被挤出窗口，`registered/produced/streaming` 全部失真，`idle` 与 `outcome` 两个完成信号都无法结算；同一个 poll 里 `turnStarted` 归零，还顺手解除了 `inactivity_timeout_ms` 的兜底。2026-11-18 一个跑了 171 次工具调用的直连 turn 因此在 opencode 早已结束（`outcome=succeeded`、`time.idle` 已前进）之后仍挂了 12 小时。

本 ADR 记录反转：**轮次完成以会话级 idle 记录为准——`session.get` 的 `time.idle`（等于最新 `idle` 记录的 `created`）相对 prompt 提交时的基线前进，且本轮确有产出（基线快照之外至少一条 assistant）、没有未 settle 的 assistant 时才结算；prompt 锚点在页内时仍作为更精确的归属依据，但不再决定能否结算。** `inactivity_timeout_ms` 改为自 prompt 提交起计时（等待审批期间暂停），不再要求先观察到 prompt 登记；审批挂起新增累计上限 `2 × permission_timeout_ms`。

被否决的方案：**粘性锚点**（锚点曾出现即可回退）能挡住僵尸迟到 idle，但锚点从未出现时仍然失明，且多一份状态；**时间戳比较**（`time.idle > prompt 提交时刻`）在 `server_url` 指向远端服务时依赖时钟一致；**`limit=200`** 只是压线巧合（1.15 条消息/工具 ≈ 只够 170 次工具，而事故正是 171 次）；**cursor 翻页**每轮最多 20+ 次 140KB 请求、compaction 后照样找不到，为一个不再需要依赖的对象付出代价。

**Consequences.** 消息页只承担内容、用量与「本轮确有产出」护栏，不再承担完成判定；`message.list` 完全不可用时由不活跃/墙钟兜底收口。`outcome` 不能按「值是否变化」判定（真机捕获显示运行中它仍是上一轮的值），会话级通道以 `time.idle` 前进为触发器、以当前 `outcome` 为终态值。残留风险是僵尸 turn 的最终 assistant 与 idle 一起迟到可能穿透护栏（概率低，且日志以 `settled_by` 留痕），不引入时钟比较。`settled_by`（`anchor`/`baseline_idle`/`outcome`/`permission_cap`/`permission_stalled`/超时类）写入 `direct turn finished`，配合 `anchor_seen` 可在下次一眼定位。卡片侧：可重试错误不再整轮禁用卡片，终态刷新失败时额外补一条文本结论——即使中途已降级过增量文本，终态结论仍然单独给出。需求见 OpenSpec `stuck-turn-settlement`；本 ADR 只记录决策与取舍。
