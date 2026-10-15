## MODIFIED Requirements

### Requirement: 每 turn 子进程执行复用 worker 原语
直连 turn SHALL 经 opencode-v2-driver 驱动（与 worker 层同一驱动器实例语义）：首 turn `session.create`（`location.directory`=固定目录、model/variant 映射、直连 `auto_approve` 生效时全放 ruleset）→ `session.prompt`；后续轮对同一 session 继续 prompt。超时/不活跃/审批等待语义 SHALL 与 worker 层一致（复用 `opencode.turn_timeout_ms` / `opencode.inactivity_timeout_ms` / `opencode.permission_timeout_ms`）。直连路径 SHALL 不执行 workspace 创建、hooks、MCP 注入或 Liquid 模板渲染，SHALL NOT 写入目标目录任何 `.opencode/` 配置。

#### Scenario: 首 turn 命令语义
- **WHEN** 新会话首 turn 以消息 `跑测试` 在 `/repos/tasking` 执行（auto_approve=false）
- **THEN** `session.create` 携带 location.directory=`/repos/tasking`，`session.prompt` 投递 `跑测试`，会话不带全放 ruleset

#### Scenario: 继承 tasking 的 agent/model/variant
- **WHEN** `opencode.agent=review`、`opencode.model=deepseek/deepseek-v4-flash`、`opencode.variant=high`
- **THEN** 创建参数携带 agent=review 与 model ref `{id:"deepseek-v4-flash", providerID:"deepseek", variant:"high"}`
- **AND** 任一字段为空/null 时对应参数省略

#### Scenario: 续跑 turn 同一 session
- **WHEN** 既有会话以 session_id `ses_x` 续跑
- **THEN** 对 `ses_x` 继续 `session.prompt`

### Requirement: 权限姿态由目标项目配置治理，auto 可指定
直连 turn 默认 SHALL 不带全放 ruleset；此时权限姿态完全由目标目录自身的 opencode permission 配置决定，`ask` 项 SHALL 挂起等待审批卡（见 permission-approval 能力）。`feishu.direct.auto_approve: true`（可被 projects 条目中的同名键按项目覆盖）时系统 SHALL 在会话创建时携带全放 ruleset。系统 SHALL 不写入、不修改目标目录的任何 `.opencode/` 配置。

#### Scenario: 默认不裸奔
- **WHEN** 未配置 auto_approve（或为 false）
- **THEN** 会话不带全放 ruleset，目录 ask 规则触发审批卡

#### Scenario: 项目级覆盖
- **WHEN** projects 中该项目条目设 `auto_approve: true` 而全局为 false
- **THEN** 该项目的会话带全放 ruleset，其他项目仍不带

### Requirement: /auto 权限姿态切换
`/auto` SHALL 支持 `on`（本会话后续所有轮放开，经 `session.update` 注入全放 ruleset，立即生效）、`off`/`reset`（清空会话 ruleset 回到配置默认）、`once`（放开至下一 turn 边界自动收回）与无参数（回显当前姿态及其来源：会话覆盖 / 项目条目 / 全局）。`on` SHALL 落库（重启后仍生效），`once` SHALL 只存在于内存。姿态操作 SHALL NOT 改变目标项目自身的 `deny` 类规则与文件。

#### Scenario: auto on 后续轮放开
- **WHEN** 执行 `/auto on` 并继续几轮
- **THEN** 这些轮不再因 ask 挂起，直到 `/auto off`、`reset` 或会话结束

#### Scenario: auto on 立即生效
- **WHEN** turn 运行中执行 `/auto on`
- **THEN** session.update 即刻生效，不等待 turn 边界

#### Scenario: auto once 只作用于下一轮
- **WHEN** 执行 `/auto once` 后有新一轮
- **THEN** 该轮结束后 ruleset 自动收回，其后各轮回到配置默认

#### Scenario: 无参数回显姿态与来源
- **WHEN** 执行 `/auto`
- **THEN** 回复当前姿态，并说明它来自会话覆盖、项目条目还是全局配置

### Requirement: 卡片上的权限按钮与姿态显示
最新一轮卡片的控制行 SHALL 提供 `🔐 权限` 按钮；点击时若当前未放开，SHALL 以同一张卡片返回确认行（`[✅ 本会话放开] [⚡ 仅下一轮] [✖ 取消]` 与"目标仓库 deny 仍生效"说明），放开 SHALL 在确认后才生效（经 `session.update`）；若当前已 `on` 或 `once`，同一点击 SHALL 立即收回（清空 ruleset）。卡片头部 SHALL 持续显示当前姿态（`🔓 auto` / `⚡ 下轮放开`，默认态不显示或显示 `🔒`）。审批挂起期间卡片 SHALL 显示等待审批与剩余时间。

#### Scenario: 打开需要确认
- **WHEN** 在默认态点击 `🔐 权限`
- **THEN** 卡片原地变为确认行，姿态此时尚未改变
- **AND** 点击 `✅ 本会话放开` 后姿态变为会话级放开且头部显示 `🔓 auto`

#### Scenario: 取消后可再次打开
- **WHEN** 点击 `🔐 权限` 后在确认行选择 `✖ 取消`，随后再次点击 `🔐 权限`
- **THEN** 再次出现确认行（重投去重以**该次渲染的按钮 value**为单位，重新渲染后的点击不会被误判为重投）

#### Scenario: 收回立即生效
- **WHEN** 已 `🔓 auto` 时点击同一按钮
- **THEN** 会话 ruleset 立即清空，头部不再显示 `🔓 auto`

#### Scenario: 仅下一轮
- **WHEN** 在确认行选择 `⚡ 仅下一轮`
- **THEN** 头部显示 `⚡ 下轮放开`，下一轮结束后该标记消失

#### Scenario: 封存卡片不带该按钮
- **WHEN** 查看已封存的轮次卡片
- **THEN** 其中不出现 `🔐 权限` 按钮

### Requirement: 每轮启动记录生效命令与姿态
每轮启动时系统 SHALL 以 info 级记录一行 `direct turn starting`，字段包含 `root_id`、`dir`、生效的 `agent`/`model`、`auto_approve`（本轮会话是否放开姿态）、`continuation` 与**生效的驱动参数摘要**（sessionID、model ref、ruleset 姿态；超长截断，保证参数可见）。以便逐轮核对"这一轮到底带了哪些参数"。

#### Scenario: 命令与姿态可逐轮核对
- **WHEN** 任意一轮启动
- **THEN** 日志出现含 `dir`、`auto_approve` 与该轮 agent 的 `direct turn starting` 记录
- **AND** `/auto once` 之后的下一轮记录 `auto_approve: true`，再下一轮恢复 `false`

## ADDED Requirements

### Requirement: 审批卡投放到会话话题
直连 turn 挂起等审批时，审批卡（见 permission-approval 能力）SHALL 投放到该会话话题，与轮次卡片并存；审批结果 SHALL 反映到轮次卡片状态（等待审批 → 恢复运行）。

#### Scenario: 直连审批卡在会话话题出现
- **WHEN** 直连 turn 因 ask 规则挂起
- **THEN** 会话话题出现审批卡，允许/拒绝后轮次卡片恢复运行状态
