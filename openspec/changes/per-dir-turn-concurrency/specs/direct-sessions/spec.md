## RENAMED Requirements

- FROM: `### Requirement: 运行中追问排队、同目录串行`
- TO: `### Requirement: 运行中追问排队、同目录并发预算`

## MODIFIED Requirements

### Requirement: 运行中追问排队、同目录并发预算
同一会话同时最多一个在跑 turn；turn 运行期间到达的追问 SHALL 进入该会话的内存队列并在当前 turn 结束后按 FIFO 合并续跑（多条合并为一个 prompt，以 `\n---\n` 分隔）；同一目录同时执行的 turn 数 SHALL 不超过 `feishu.direct.max_concurrent_turns_per_dir`（整数 ≥1，默认 1；1 表示串行，2+ 表示用户显式放开同目录并行）；daemon 全局同时执行的直连 turn 数 SHALL 不超过 `feishu.direct.max_concurrent`（默认 5，独立于 Jira 的 `max_concurrent_agents`）；实际并发 SHALL 取两者更严者。超出目录上限的 turn SHALL 按 FIFO 排队，SHALL NOT 抢占正在执行的 turn；等待权限审批的 turn SHALL 继续占用其目录槽位。`max_concurrent_turns_per_dir > 1` 时 daemon SHALL 记一条 WARN（含 `auto_approve` 提醒），热重载把值从 ≤1 变为 >1 时 SHALL 再记一次；每轮 `direct turn starting` 日志 SHALL 携带生效的 `max_concurrent_turns_per_dir`。

#### Scenario: 运行中到达的追问被排队
- **WHEN** 会话 turn 运行中话题内又到达两条消息
- **THEN** 系统立即回复排队 ACK，当前 turn 结束后将两条消息合并为一个 prompt 续跑一次

#### Scenario: 超出并发预算时等待
- **WHEN** 已有 `max_concurrent` 个直连 turn 在跑，另一会话的新消息到达
- **THEN** 该会话的 turn 等待有空位后执行，且不占用 Jira dispatch 的并发额度

#### Scenario: 默认同目录串行
- **WHEN** 未配置 `max_concurrent_turns_per_dir`（默认 1），同一目录已有 turn 在跑，另一会话在同一目录发起 turn
- **THEN** 后一个 turn 等待前一个结束后开始，其轮次卡片显示排队中

#### Scenario: 显式放开同目录并行
- **WHEN** `max_concurrent_turns_per_dir: 2`，同一目录有三个会话同时发起 turn
- **THEN** 前两个 turn 并行执行，第三个按 FIFO 等待；任一 turn 结束后第三个开始

#### Scenario: 全局并发上限仍生效
- **WHEN** `max_concurrent_turns_per_dir: 5` 且 `max_concurrent: 1`
- **THEN** 同一目录的 turn 仍串行执行（取更严的全局预算）

#### Scenario: 审批等待继续占槽
- **WHEN** 某目录的 turn 因权限 `ask` 挂起等待审批，同时该目录又到达新 turn 且已无目录槽位
- **THEN** 新 turn 排队等待，不因审批挂起而释放槽位

#### Scenario: 放开同目录并发时告警
- **WHEN** 启动或热重载后生效的 `max_concurrent_turns_per_dir` 从 ≤1 变为 >1
- **THEN** daemon 记录一条 WARN，包含生效值与共享工作树的竞态提醒

#### Scenario: 热重载只影响之后进入的 turn
- **WHEN** turn 运行中把 `max_concurrent_turns_per_dir` 从 1 改为 2
- **THEN** 正在跑的 turn 不受影响，之后在同一目录发起的新 turn 可按新上限并行

### Requirement: feishu.direct 零配置默认可用
`feishu.enabled` 为 true 时直连功能 SHALL 默认启用（`feishu.direct` 段缺失 = 全默认值；段内显式 `enabled: false` 关闭）。`projects` 可为空（path 模式即可用）。所有其他项 SHALL 有合理默认值：`path_roots: []`、`auto_approve: false`、`verbosity: detailed`、`max_concurrent: 5`、`max_concurrent_turns_per_dir: 1`、`idle_ttl_ms: 30 天`。

#### Scenario: 零配置 path 模式可用
- **WHEN** WORKFLOW.md 的 feishu 段不含 `direct` 子块（feishu.enabled: true）
- **THEN** 直连默认启用，`/chat /绝对路径 <消息>` 直接可用，无需任何新增配置

#### Scenario: 两行配置启用项目名模式
- **WHEN** WORKFLOW.md 的 feishu 段仅含 `direct: { projects: { tasking: /repos/tasking } }`
- **THEN** 解析后的配置填满所有默认值，`/chat tasking …` 可用

#### Scenario: 显式关闭
- **WHEN** `feishu.direct.enabled: false`
- **THEN** 直连不激活，`/chat` 按未知命令处理

## ADDED Requirements

### Requirement: 直连目录占用可观测
`GET /api/v1/state` 的快照 SHALL 始终包含顶层数组 `direct_dirs`（无活动目录时为 `[]`），每个元素为 `{ path, active, limit, waiters }`：`path` 为该目录的 realpath；`active` 为已占用该目录槽位的 turn 数（包含已占槽但在等待全局 `max_concurrent` 名额的 turn）；`waiters` 为因该目录上限已满而排队等待槽位的 turn 数（不含等待全局名额的）；`limit` 为该目录生效的 `max_concurrent_turns_per_dir`。数组 SHALL 只包含有活动的目录（`active > 0` 或 `waiters > 0`），按 `path` 升序输出；无活动的目录 SHALL 从内部占用表中清理。TUI SHALL NOT 被要求消费该字段；`tasking status` 的行为不变。

#### Scenario: 目录占用出现在快照中
- **WHEN** 某目录有 2 个 turn 正在执行、1 个因目录上限排队
- **THEN** `/api/v1/state` 的 `direct_dirs` 含该目录，`active: 2`、`waiters: 1`、`limit` 等于生效配置

#### Scenario: 等待全局名额仍计入 active
- **WHEN** 某 turn 已占用目录槽位但正在等待全局 `max_concurrent` 名额
- **THEN** 该 turn 计入对应目录的 `active`，不计入 `waiters`

#### Scenario: 空闲目录不出现
- **WHEN** 某目录的 turn 已全部结束且无排队者
- **THEN** 该目录不出现在 `direct_dirs`，内部占用表中被清理

#### Scenario: 无任何活动目录
- **WHEN** 当前没有正在执行或排队的直连 turn
- **THEN** 快照仍输出 `"direct_dirs": []`
