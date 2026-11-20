## MODIFIED Requirements

### Requirement: 轮询循环取进度与终态
驱动器 SHALL 以 `opencode.poll_interval_ms`（默认 2000）为间隔轮询：`session.get`（`outcome` ∈ succeeded/failed/interrupted 三态 + tokens + `time.idle`）、`session.permission.list`（pending 审批单）、`session.message.list`（diff 新增 assistant 消息的 `content[]`，其中 `type:"tool"` 条目的 `state.input`/`state.metadata.exit`/`state.time` 为工具调用详情来源）。终态判定 SHALL 以完成信号 + 产出护栏为准。ActivityStore/卡片数据 SHALL 由 message diff 喂入。

`session.message.list` 默认只返回最新 50 条（`limit` 上限 200，`cursor.next` 指向更旧），因此完成判定 SHALL NOT 以「本轮 prompt 消息仍在当页」为前提。完成信号 SHALL 依次取用：

- **会话级 idle（权威）**：`session.get` 的 `time.idle`（= 最新 `idle` 记录的 `created`）相对 prompt 提交时的基线前进；
- **页内 idle（精确）**：prompt 锚点在当前页内时，只取锚点之上（更新）的 `idle` 记录的 `outcome`；
- **基线 idle（回退）**：锚点不在页内时，取消息页中 id 不在基线快照内的 `idle` 记录的 `outcome`。

任一完成通道给出终态后，结算 SHALL 同时满足**产出护栏**：基线快照之外至少存在一条 `assistant` 消息，且不存在未 settle（缺 `time.completed`）的 `assistant`。护栏不满足时 SHALL NOT 结算，继续轮询。锚点因分页或 compaction 消失 SHALL NOT 阻止结算。

#### Scenario: 终态以 outcome 为准
- **WHEN** 轮询到 `outcome: "succeeded"`
- **THEN** turn 结算为成功，tokens 取自会话与消息级数据

#### Scenario: message diff 喂活动数据
- **WHEN** 两次轮询之间新增一条含 `type:"tool"` 的 assistant 消息（exit=0、耗时可算）
- **THEN** ActivityStore 新增对应工具调用条目，字段含命令、退出码与耗时

#### Scenario: 轮询失败可恢复
- **WHEN** 单次轮询调用失败（进程错误/网络抖动）
- **THEN** 记录警告并按原间隔继续下一轮轮询，不判失败

#### Scenario: 锚点掉出分页窗口后仍能结算
- **WHEN** 一轮产生了超过 50 条新消息，prompt 消息已不在 `session.message.list` 返回的页内，随后该轮结束（`time.idle` 前进且页内出现新的 `idle`）
- **THEN** turn SHALL 正常结算，不得因锚点缺失而继续轮询

#### Scenario: 会话 idle 前进但没有本轮产出时不结算
- **WHEN** `time.idle` 前进，但基线之外没有任何新的 `assistant` 消息（例如上一轮僵尸 turn 的迟到 idle）
- **THEN** 本轮 SHALL NOT 被结算，继续等待本轮的产出或超时兜底

#### Scenario: 存在未 settle 的 assistant 时不结算
- **WHEN** 完成信号已出现，但基线之外仍有 `assistant` 消息缺少 `time.completed`
- **THEN** 本轮 SHALL NOT 结算，直到该消息 settle

#### Scenario: 消息接口不可用时不误判完成
- **WHEN** `session.message.list` 持续失败，无法满足产出护栏
- **THEN** 本轮 SHALL NOT 判完成，由不活跃/墙钟超时兜底收口

### Requirement: 审批等待预算与计时器矩阵
存在 pending 审批单期间：`turn_timeout_ms` 与 `inactivity_timeout_ms` SHALL 暂停；`permission_timeout_ms`（默认 1800000）SHALL 接管计时，TUI 与卡片 SHALL 显示等待审批与剩余时间。到期 SHALL 自动 `reject` 该审批单（卡片盖章"超时已拒绝"）并恢复执行计时，turn 继续正常结算；pending 的存在 SHALL NOT 被计为本轮进度。自动 `reject` 后若连续 15 个轮询周期无任何进展，turn SHALL 以失败结算。单轮**累计**审批等待（各段等待之和）达到 `2 × permission_timeout_ms` 时，SHALL 以 `permission_timeout` 原因结算为超时（管理面文案「审批超时」），覆盖服务端不理会 reject、模型反复申请同一权限等情况。`inactivity_timeout_ms` SHALL 自 prompt 提交起计时（不再要求先观察到 prompt 消息登记），等待审批期间暂停。调度器停滞检测 SHALL 感知等待审批状态（不判停滞）。`/stop` 撞挂起审批 SHALL 连带作废 pending 单（服务端未自动取消时补发 reject）。

#### Scenario: 等待期间执行计时暂停
- **WHEN** 审批单挂起 20 分钟后获准，turn 总执行时长预算 30 分钟
- **THEN** 结算时执行计时只含非等待时间，不因等待触发 turn_timeout

#### Scenario: 审批超时自动拒绝
- **WHEN** 审批单挂起达 `permission_timeout_ms`
- **THEN** 自动 reject、卡片盖章、turn 继续运行（工具被拒）

#### Scenario: 拒绝后无进展收尾
- **WHEN** 自动 reject 后 pending 单仍未消失，且连续 15 个轮询周期没有任何新消息或状态变化
- **THEN** turn SHALL 以失败结算，而不是无限挂起

#### Scenario: 累计审批等待达到硬上限
- **WHEN** 同一轮内各段审批等待累计达到 `2 × permission_timeout_ms`（例如模型反复申请同一权限）
- **THEN** turn SHALL 以 `permission_timeout` 结算为超时，卡片与回复文案显示「审批超时」

#### Scenario: 无输出超时不依赖 prompt 登记
- **WHEN** prompt 已提交但从未在消息页中观察到对应消息，且此后会话没有任何活动超过 `inactivity_timeout_ms`
- **THEN** turn SHALL 以 `inactivity_timeout` 结算，而不是无限轮询

#### Scenario: stall 不误杀等待中的任务
- **WHEN** 任务挂起等审批超过 `stall_timeout_ms`
- **THEN** 调度器不将其判为停滞清理
