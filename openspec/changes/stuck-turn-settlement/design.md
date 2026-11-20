## Context

`runTurn`（`src/driver/turn-driver.ts`）是 worker 与直连共用的 turn 驱动：每 `poll_interval_ms` 调 `session.get`、`session.permission.list`，按需调 `session.message.list`（默认最新 50 条、忽略 `cursor`），然后用 `promptAnchoredSignals()` 以 `session.prompt` 返回的 user 消息 id（锚点）为界，判断 `registered / produced / streaming / idleOutcome`，四者齐备才结算。

事故现场（2026-11-18，直连 turn 20，171 次工具调用）：

- opencode 侧正常结束（TUI 有最终总结、`session.get` 的 `outcome=succeeded`、`time.idle` 已前进）；
- 驱动侧：锚点在第 ~50 条新消息后掉出分页窗口 → `sawOurPrompt=false` → `registered=false / produced=false / streaming=true` → idle 与 outcome 两条通道全部无法结算；
- 同一 poll 中 `turnStarted`（依赖 `sawOurPrompt`）变 false → 30 分钟 `inactivity_timeout_ms` 被解除；`turn_timeout_ms` 现场为 50 小时；
- 结果：12+ 小时「运行中」，卡片靠 5s 心跳持续重绘。

同一份驱动还有两条独立的无限挂起路径：pending 审批期间墙钟与不活跃都暂停，且「有 pending」被算作 progress，使 `REJECT_QUIESCENT_POLLS` 收尾永远够不到；卡片一次可重试失败后整轮 `cardsAvailable=false`，终态那次失败后再无人重绘。

约束：

- opencode v2 的 `session.get` 携带 `time = {created, updated, idle, viewed}`，其中 `time.idle` 等于最新 `idle` 记录的 `created`（捕获载荷已验证；`session-get-running.json` 目前名不副实，需重采集）。
- `session.message.list` 的 `limit` 上限 200；`cursor.next` 才是往旧翻（`previous` 返回空页）；客户端当前两者都不用。
- 仓库纪律：v2 字段读取必须有真机捕获（fixture 先行）；mock 一律经 `tests/helpers/opencode-fixtures.ts` 派生。

## Goals / Non-Goals

**Goals:**

- opencode 已结束的 turn 必然在有限时间内结算，且一小时内不依赖人工干预。
- 任何「结算通道全部失效」的情况下，仍有一个与消息分页无关的兜底把 turn 收口。
- 审批挂起不再能无限拖住一个 turn。
- 一次飞书 REST 抖动不再让本轮卡片永久停在「运行中」。
- 下次同类事故能从日志一眼定位（哪个信号结算、锚点是否丢失、错误原因）。

**Non-Goals:**

- 不改分段卡片显示语义（封段卡仍是不回刷的快照；不加封段时刻）。
- 不引入 `limit=200`、不翻页、不新增配置键、不 bump 版本。
- 不处理 Jira 侧 stall 语义；不解决「同一 opencode session 被外部并发 prompt」的归属歧义。
- 不改 `WORKFLOW.md` 模板的 prompt body（只修 YAML 注释）。

## Decisions

### D1 完成判定：会话级 idle 权威 + 消息基线护栏

`session.get` 增加 `idleAt`（解析 `time.idle`）。结算条件（任一完成通道命中后仍需通过护栏）：

```
terminal = 页内 idle outcome（锚点可用时）
         | 基线之外的新 idle outcome（锚点丢失时）
         | session.time.idle 前进时的当前 outcome（锚点丢失时，不要求 outcome 值变化）
         | permission_cap / permission_stalled / abort / 超时类
guard    = 基线之外至少一条 assistant 且没有未 settle 的 assistant
```

`outcome` 不能用来判断「变没变」：真机捕获（`session-get-running.json`）显示 turn 进行中它仍是上一轮的 `succeeded`，收尾时才前进的是 `time.idle`。因此会话级通道以 `time.idle` 为触发器、以当前 `outcome` 为终态值。

- `settled_by` 取值：`anchor | baseline_idle | outcome | permission_cap | permission_stalled | abort | turn_timeout | inactivity_timeout`（`permission_stalled` 专指「自动 reject 后 15 个静默周期收尾」，与累计预算 `permission_cap` 区分）。
- 锚点仍然保留：页内可用时，idle/assistant 只取「锚点之上（更新）」的，精度更高；**它不再决定能否结算**。
- 被否决：
  - **粘性锚点（A1）**：只在「曾经见过锚点」时才允许回退。挡得住僵尸迟到 idle，但锚点从未出现（更肥的会话 / compaction）时仍然失明，且多一份状态。
  - **时间戳比较（A3）**：要求 `time.idle > prompt 提交时刻`。理论最准，但 `server_url` 允许远端服务，时钟偏移会让判定非确定。
  - **`limit=200`（L2）**：按 1.15 条消息/工具计算只够 ~170 次工具，本次事故正好 171 次——属于压线巧合，不能作为依赖；且每 2s 载荷翻 4 倍。
  - **cursor 翻页（L3）**：每轮最多 20+ 次 140KB 请求，compaction 后照样找不到；为一个我们决定不再依赖的对象付出代价。

### D2 无输出超时：从 prompt 提交起无条件计时

删除 `turnStarted` 门禁，`lastActivityAt` 初始值就是 prompt 提交时刻；等待审批期间仍暂停。

- 被否决：
  - **有上限的登记宽限（I2）**：`grace = max(2min, 10×poll)` 会被 10~30 分钟的 `inactivity` 完全吸收，实际行为与无条件计时一致，只多一个状态。
  - **按 `delivery` 区分（I3）**：`session.prompt` 返回的 `Session.Inbox.User` 带 `delivery: steer|queue`，最精确；但目前连 prompt 响应的真机 fixture 都没有（测试是手写的），暂不引入。
- 排队场景不会误杀：真正排队时同一 session 仍在产消息，`lastActivityAt` 会被重置；排队且全程无活动超过预算，本就应当收口。

### D3 审批挂起有界

- `pending > 0` 不再计入 `progressed`（恢复 `REJECT_QUIESCENT_POLLS` 的 reject 后收尾）。
- 累计等待（复用已有的 `waitAccumMs`，它本来用于从墙钟里剔除挂起时间）达到 `2 × permission_timeout_ms` 时，以 `permission_timeout` 结算；管理面文案为「审批超时」。
- 被否决：
  - **只修 progress（P1）**：模型反复申请同一权限时可以「30 分钟一循环」拖到无限。
  - **连续 pending 上限（P3）**：语义聚焦「一次挂死」，对反复申请无效，且要多维护 `pendingFirstSeenAt`。

### D4 卡片失败处置

- 可重试错误（`feishu_api_request` / 429 / 5xx / 230020 / 200810）不再把 `cardsAvailable` 置 false；保留现有「延迟一次重试 + 增量文本降级」，失败后交给下一次 5s 心跳继续尝试。
- 终态（`completed/failed/interrupted`）渲染单独做有界退避：首次失败后再刷新 2 次（2s/4s），每次刷新沿用「可重试错误延迟重试一次」的内部逻辑；因为心跳在 turn 结束时就停了。
- 终态更新最终失败（含不可重试错误导致当轮卡片被禁用）时补一条纯文本「本轮已结束（卡片更新失败）」（即使中途已降级过增量文本，也要给出终态结论）。
- 非可重试（4xx 载荷被拒）保持现有「当轮禁用 + 立即文本降级」，不浪费重试。
- 被否决：
  - **C1（只改禁用）**：终态落在抖动窗口里仍会永久停在「运行中」。
  - **C3（持久化待渲染状态）**：daemon 重启已有 `recover()` 重写「已中断」，额外持久化收益/成本比低。
  - **C4（独立渲染队列）**：超出本次范围。

### D5 分段卡片保持快照语义

封段卡片是**不可变快照**：头部/正文里的「运行中」代表封段那一刻的会话/轮状态，页脚代表段状态，三者同时为真；不因整轮结束而回刷，也不额外写封段时刻（飞书消息自身带发送时间）。

- 被否决：
  - **S1a（封段时把标签改成「本段已结束」）**：改动小，但把段状态与轮/会话状态混成一个词，反而丢失快照里「当时整轮在跑」的信息。
  - **S1b（终态回刷所有段）**：需要 `segmentIds[]` + N 次 `updateCard`，长轮次有触发限流的风险，且等于篡改历史卡片。
  - **页脚加封段时刻**：与飞书消息时间戳重复。

### D6 分页不改

结算不依赖页内锚点后，最新 50 条足以支撑事件、用量与护栏；保持默认取法，不传 `limit`、不翻页。仅在锚点从页内消失时记一次 WARN 作为诊断信号。

### D7 可观测

`direct turn finished` 增加 `error`、`duration_ms`、`tools`、`settled_by`、`anchor_seen`；`prompt_message_id` 落日志；锚点丢失每轮 WARN 一次。

### D8 契约证据先于实现

真机捕获成对的 `session.get`（同一 session 的 turn 中途 + 结束后），中途那份覆盖 `tests/fixtures/opencode-v2/rest/session-get-running.json`，并在 `provenance.md` 记录语义（`time.idle` 是否保持上一轮值/被清空）。实现与测试都以该捕获为准。

### D9 零新增配置 / 单一变更 / 版本不动

- 审批预算与卡片退避全部用常量（`2×` 与 3 次/2s/4s）；可调项仍是既有的 `permission_timeout_ms`。
- 驱动 + 审批 + 卡片放在同一变更，便于一个事故对应一个可回溯的决策单元。
- 版本留给既有 `chore: release` 流程。

## Risks / Trade-offs

- **僵尸 turn 的最终 assistant 与 idle 一起迟到** → 基线护栏会被穿透，误判本轮完成。缓解：概率低（既有僵尸记录为「无 outcome/idle」），且 `settled_by=baseline_idle` 会在日志里留下痕迹；不引入时钟比较来收紧。
- **`time.idle` 在更老的 2.x 上缺失或语义不同** → `getSession` 把缺失解析为 null，完成判定退回基线 idle 通道；`inactivity` 仍是无条件兜底。
- **`session.message.list` 完全不可用** → 护栏无法满足，会话级 idle 不触发；由 `inactivity` / `turn_timeout` 收口（这正是 D2 存在的意义）。
- **终态卡片重试撞限流** → 最多 3 次、指数间隔；非可重试错误不重试。若仍失败，纯文本兜底保证用户知道本轮已结束。
- **`inactivity` 无条件计时误杀慢登记** → 该计时至少要静默满 `inactivity_timeout_ms`（默认 10 分钟）才会触发，且排队中的会话仍有活动。
- **真机捕获依赖一次长 turn** → 捕获放在实现前执行；若暂时无法捕获，实现可先锁定「字段存在 + 缺失降级」的测试，捕获完成后补齐语义断言。

## Migration Plan

- 无数据/配置迁移；`direct_sessions`、`bindings.db` 结构不变。
- 部署：构建后重启 daemon（`tasking stop && tasking start`）。重启时 `recover()` 会把遗留的 `running` 会话标为 idle 并重写卡片为「已中断」。
- 回滚：revert 提交即可；无 schema/配置残留。
