## ADDED Requirements

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
