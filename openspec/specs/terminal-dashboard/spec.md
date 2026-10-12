# terminal-dashboard Specification

## Purpose
TBD - created by archiving change document-symphony-gaps. Update Purpose after archive.
## Requirements
### Requirement: 终端 TUI 状态面板
daemon SHALL 提供可选的终端 TUI 状态面板,通过 ANSI 转义码在 stderr 上渲染只读状态画面。TUI SHALL 定时(默认 1s)拉取运行时快照并重绘。TUI SHALL 在 overview 底部渲染 Logs 区块,显示最近日志条目并按 level 着色。TUI SHALL NOT 接收键盘输入——它是纯只读显示面。TUI SHALL NOT 参与编排器正确性。

#### Scenario: TUI 渲染运行中任务
- **WHEN** TUI 启用且有任务运行
- **THEN** 渲染运行中任务表格,含标识符、状态、运行时长、turn 计数、token 总量、session ID、最近事件

#### Scenario: TUI 渲染退避队列
- **WHEN** TUI 启用且有 retry 队列
- **THEN** 渲染退避队列,含标识符、attempt、倒计时、错误摘要

#### Scenario: TUI 渲染汇总栏
- **WHEN** TUI 启用
- **THEN** 渲染汇总:agent 数量/上限、吞吐量 tps、运行时长、token in/out/total

#### Scenario: TUI 渲染日志尾部
- **WHEN** TUI 启用且 LogRingBuffer 有日志条目
- **THEN** overview 底部渲染 `├─ Logs` 区块,显示最近 6 条日志,按 level 着色(error 红、warn 黄、info 默认、debug 暗灰),每条显示时间戳(短格式)、level、消息(截断至终端宽度)

#### Scenario: TUI 无日志缓冲时跳过 Logs 区块
- **WHEN** TUI 启用但未注入 LogRingBuffer
- **THEN** overview 不渲染 Logs 区块

#### Scenario: 内容无变化不重绘
- **WHEN** 快照内容与前次渲染相同且未超过周期性重绘间隔
- **THEN** 不重绘(节流去重)

#### Scenario: TUI 不参与正确性
- **WHEN** TUI 不可用或渲染出错
- **THEN** 编排不受影响地继续

### Requirement: TUI 吞吐量 sparkline
TUI SHALL 在汇总栏渲染一个 sparkline 吞吐量趋势图(最近 10 分钟),使用块字符 `▁▂▃▄▅▆▇█`。sparkline SHALL 按时间窗口分桶计算平均 tps。

#### Scenario: sparkline 反映趋势
- **WHEN** 有 token 消耗历史
- **THEN** sparkline 显示 24 列桶状图,高度与各桶 tps 成正比

### Requirement: TUI 与日志互不干扰
TUI 启用时,结构化日志 SHALL NOT 写入 stderr(避免被 TUI 清屏覆盖),SHALL 仅写入文件 sink。TUI 未启用时,日志 SHALL 继续写入 stderr。

#### Scenario: TUI 启用时日志走文件
- **WHEN** TUI 启用
- **THEN** stderr 仅用于 TUI 渲染,日志行写入文件 sink

#### Scenario: TUI 未启用时日志走 stderr
- **WHEN** TUI 未启用
- **THEN** 日志行写入 stderr

### Requirement: TUI 配置视图

TUI SHALL 提供配置视图模式，按 `c` 从 overview 进入、按 `Esc`/`q` 返回 overview。配置视图 SHALL 展示 daemon 当前有效配置（EffectiveConfig，即原始 WORKFLOW.md 前文经默认值补齐、环境变量展开、路径解析后的实际运行值）与运行时属性：workflow 路径、pid、启动时长、workspace 根、tasking.log 路径、daemon host:port，以及 tracker / polling / agent / opencode / router / feishu / server / hooks / env 各配置分组。配置视图 SHALL 对密钥字段（tracker.api_key、feishu.app_secret、feishu.verification_token、feishu.encrypt_key、env 段值）脱敏显示 `****`（值为空时显示未配置）。进程内 TUI SHALL 从 ConfigManager 的当前配置实时取数，配置热重载后视图随之更新；附加 TUI（`tasking tui`）SHALL 经 `GET /api/v1/config` 拉取同一份脱敏数据。

#### Scenario: 进入配置视图
- **WHEN** 用户在 TUI overview 按 `c`
- **THEN** 渲染配置视图，显示运行时属性（workflow 路径、pid、启动时长、workspace 根、日志路径、host:port）与有效配置分组

#### Scenario: 密钥脱敏
- **WHEN** 配置中存在 tracker.api_key / feishu.app_secret / env 段密钥
- **THEN** 配置视图显示 `****` 而非明文

#### Scenario: 返回 overview
- **WHEN** 用户在配置视图按 `Esc` 或 `q`
- **THEN** 返回 overview 模式，daemon 不受影响

#### Scenario: 配置热重载实时反映
- **WHEN** daemon 运行中 WORKFLOW.md 被修改且重新加载成功
- **THEN** 配置视图随后刷新显示新配置

#### Scenario: 附加 TUI 经 HTTP 拉取配置
- **WHEN** `tasking tui` 附加到运行中 daemon 并按 `c`
- **THEN** 配置视图渲染 `GET /api/v1/config` 返回的脱敏配置与运行时属性

### Requirement: 运行中详情视图默认折叠显示描述

TUI running 任务详情视图（进程内 state 源渲染 `formatRunningDetailFromState`）SHALL 默认折叠显示任务描述 `task.description`：先按盒宽折行（内容区宽 48 列），最多显示前 6 个折行后的行；若折行总数超过 6，SHALL 在折叠末尾追加 `… (N more lines)` 标记（N 为被省略的折行行数）。折叠态 SHALL 提示可用 `e` 键展开。描述为空字符串或 `null` 时 SHALL 不渲染 Description 区块。该行为仅限 state 源的详情视图，overview 列表与快照源渲染（不展示描述）不受影响。

#### Scenario: 长描述默认折叠
- **WHEN** 进入某任务的详情视图且其 `task.description` 折行后超过 6 行
- **THEN** 详情视图默认只渲染前 6 个折行行，并显示 `… (N more lines)` 标记

#### Scenario: 短描述不折叠
- **WHEN** 进入某任务的详情视图且其 `task.description` 折行后不超过 6 行
- **THEN** 详情视图渲染描述的全部折行行，不显示折叠标记

#### Scenario: 超长行按盒宽折行
- **WHEN** 描述某行超过盒宽（48 列）
- **THEN** 该行被折为多行渲染，每行带 `│  ` 前缀，盒边框不被破坏，且折叠计数按折行后的行计算

#### Scenario: 描述末尾换行不多渲染空行
- **WHEN** 描述以换行结尾
- **THEN** 详情视图不额外渲染该末尾换行对应的空行

#### Scenario: 无描述不渲染区块
- **WHEN** `task.description` 为空字符串或 `null`
- **THEN** 详情视图不渲染 Description 区块

### Requirement: 详情页 e 键展开收起描述

`detail-running` 模式 SHALL 支持 `e` 键在描述的折叠态与展开态之间切换。展开态 SHALL 渲染描述的全部折行行（不显示折叠标记）；再按 `e` SHALL 回到默认折叠态。每次进入详情页 SHALL 从折叠态开始渲染——展开状态在进入详情时重置，不跨任务、不跨详情会话记忆。折叠态与展开态 footer SHALL 分别提示可用的 `e` 键操作（折叠态 `e expand`，展开态 `e collapse`）。

#### Scenario: e 键展开描述
- **WHEN** 在 `detail-running` 按 `e` 且描述折叠态显示不足
- **THEN** 详情视图切换为展开态，渲染描述全部折行行，不再显示折叠标记

#### Scenario: e 键收起描述
- **WHEN** 在 `detail-running` 展开态再按 `e`
- **THEN** 详情视图回到折叠态，重新显示前 6 行与折叠标记

#### Scenario: 重新进入详情默认折叠
- **WHEN** 展开描述后退出详情再重新进入同一任务
- **THEN** 详情视图从折叠态开始渲染，不记忆上一次展开状态

#### Scenario: 无描述时 e 键无效果
- **WHEN** `task.description` 为空或 `null` 时在 `detail-running` 按 `e`
- **THEN** 视图不变，不渲染 Description 区块

### Requirement: 任务详情视图显示 model 与活动入口

`detail-running` 模式 SHALL 显示当前 turn 解析的 `Agent` / `Model` / `Variant`（来自 `RunningEntry`，进程内直读；远端经 `RuntimeSnapshot` running 行）。`detail-running` footer SHALL 提示 `a` 进入活动视图（在原 `Esc/q back` 旁）。`detail-running` SHALL 支持 `a` 键进入 `activity` 模式。

#### Scenario: 详情页显示 model 行

- **WHEN** 进入 `detail-running` 且当前 turn 解析得 model/agent/variant
- **THEN** 详情页渲染 `Agent` / `Model` / `Variant` 行

#### Scenario: 详情页提示 a 键

- **WHEN** 进入 `detail-running`
- **THEN** footer 显示 `Esc/q back · a activity`（或等价提示）

#### Scenario: a 键进入活动视图

- **WHEN** 在 `detail-running` 按 `a`
- **THEN** 模式切换为 `activity`，渲染活动事件

### Requirement: 模式键绑定

`processKey` SHALL 在 `logs` 与 `activity` 模式下处理 `Space`/`f` 作为暂停/恢复跟随的开关；两种模式 SHALL 表现一致：暂停时视口 SHALL 冻结在当前可见的条目窗口上（锚定视口顶行条目的身份），此后新到达的日志/事件 SHALL NOT 顶走画面上的旧条目，直到用户滚动或再次按 `Space`/`f` 恢复跟随；恢复跟随 SHALL 清除锚点并回到最新条目。`activity` 模式下 `j/k`/`↑`/`↓` SHALL 移动事件选中光标（光标移动退出跟随并锚定视口保证选中行可见），`Enter` 打开选中事件的全文浮层（`activity-detail`），`Esc/q` 返回 `detail-running`。`activity-detail` 模式下 `j/k`/`↑`/`↓` 滚动全文、`Esc/q` 返回 `activity`。`activity`/`activity-detail` 模式 SHALL NOT 影响 `overview`/`logs`/`config` 既存键绑定。

#### Scenario: logs 模式 Space/f 暂停冻结视口

- **WHEN** 在 `logs` 模式跟随最新日志时按 `Space` 或 `f`
- **THEN** 标签显示 `[paused]`，且此后新日志到达时画面保持静止——新行不出现、不把旧行顶走

#### Scenario: activity 模式 Space/f 暂停冻结视口

- **WHEN** 在 `activity` 模式跟随最新事件时按 `Space` 或 `f`
- **THEN** 标签显示 `[paused]`，且此后新事件到达时画面保持静止——新行不出现、不把旧行顶走

#### Scenario: 暂停期间缓冲滑动不漂移

- **WHEN** 暂停时缓冲内已有超过 200 条日志（渲染窗口 `recent(200)` 持续滑动）且新日志持续到达
- **THEN** 画面仍锚定在暂停时可见的条目上不漂移；若锚定条目已滚出可用窗口，则停在仍可见的最旧条目处而非跳回最新

#### Scenario: 再次 Space/f 恢复跟随

- **WHEN** 暂停中再次按 `Space` 或 `f`
- **THEN** 清除锚点、回到跟随最新，视口显示最新到达的条目

#### Scenario: 暂停后手动滚动

- **WHEN** `logs`/`activity` 处于暂停且用户按 `j/k`/`↑`/`↓` 手动滚动
- **THEN** 视口从锚点位置上下移动，不因新条目到达而自动跳回最新

#### Scenario: activity 模式移动光标

- **WHEN** 在 `activity` 模式按 `j` 或 `↓`
- **THEN** 事件选中光标向下移动一行，退出跟随，视口锚定保证选中行可见

#### Scenario: activity 模式 Enter 展开

- **WHEN** 在 `activity` 模式按 `Enter`
- **THEN** 进入 `activity-detail` 浮层显示选中事件全文

#### Scenario: activity-detail 滚动与返回

- **WHEN** 在 `activity-detail` 按 `↑`/`↓` 或 `Esc`
- **THEN** `↑`/`↓` 滚动全文、`Esc`/`q` 返回 `activity` 列表

#### Scenario: activity 模式 Esc 返回

- **WHEN** 在 `activity` 模式按 `Esc` 或 `q`
- **THEN** 返回 `detail-running`

#### Scenario: overview 键不受影响

- **WHEN** 在 `overview` 按 `j`/`Enter`/`L`/`c`
- **THEN** 行为与引入 activity 模式前完全一致（零回归）

### Requirement: overview 页脚帮助文案准确

overview 页脚 SHALL 只提示在 overview 模式有实际作用的按键；SHALL NOT 宣称 `Space pause`（空格在 overview 模式无任何绑定动作）。`Space/f pause` 提示 SHALL 仅出现在确实支持暂停的 Log view 与 Activity view 页脚。

#### Scenario: overview 页脚不含 Space pause

- **WHEN** overview 渲染页脚
- **THEN** 页脚不出现 `Space pause` 或等价声称空格可暂停的文案

#### Scenario: Log/Activity 页脚保留 Space/f pause

- **WHEN** `logs` 或 `activity` 模式渲染页脚
- **THEN** 页脚继续提示 `Space/f pause`

### Requirement: overview 选中按任务 id 跟踪

TUI overview 模式 SHALL 以稳定任务 id（而非列表下标）跟踪当前选中行。当运行/退避列表因任务派发、续跑重排、完成移除而改变顺序或长度时，选中 SHALL 跟随所选任务移动；仅当所选任务离开当前列表时，选中 SHALL 回退到夹取后的最近下标位置。

#### Scenario: 列表重排时选中跟随任务
- **WHEN** overview 选中任务 A（非首行），随后另一任务 B 完成一次续跑被移除并追加到列表末尾（列表顺序改变）
- **THEN** 游标仍位于任务 A 上，回车进入的是任务 A 的详情

#### Scenario: 列表新增任务时选中不动
- **WHEN** overview 选中任务 A，随后新任务 C 被派发追加到列表末尾
- **THEN** 游标仍位于任务 A 上，`selectedIndex` 不漂移

#### Scenario: 所选任务离开列表时回退
- **WHEN** overview 选中的任务从当前列表移除（如转为退避队列）
- **THEN** 选中回退到夹取后的最近位置，`j/k` 继续从该位置正常移动

### Requirement: 活动视图只显示当前任务的事件

TUI `activity` 模式（远端 `fetchActivity` 数据源）SHALL 仅渲染当前详情任务（`detailId`）的活动事件。切换任务后，在新任务事件拉取完成之前 SHALL 显示空状态而非上一任务的残留事件；活动事件拉取失败时 SHALL NOT 回退渲染其他任务的事件。

#### Scenario: 切换任务后不残留上一任务事件
- **WHEN** 查看任务 A 的活动视图后返回并进入任务 B 的活动视图，任务 B 的事件尚未拉取完成
- **THEN** 视图显示任务 B 的空状态/占位，不渲染任务 A 的任何事件

#### Scenario: 活动事件归属当前任务
- **WHEN** 在任务 B 的活动视图且任务 B 事件已拉取
- **THEN** 渲染的事件全部属于任务 B

### Requirement: 详情页超长行折行显示

TUI 详情视图（`formatRunningDetailFromState` 与 `formatRunningDetailFromSnapshot`）的 `last_message` 行 SHALL 按盒宽折行（消息内容区宽 34 列，含 `│  Last message: ` 前缀共 51 列），内容 SHALL NOT 被截断。

#### Scenario: last_message 超长折行
- **WHEN** `last_message` 超过 34 列
- **THEN** 详情页将其折为多行渲染，全部字符保留且盒边框不被破坏

### Requirement: 活动视图宽度感知渲染与选中高亮

`formatActivity` SHALL 将事件文本按显示宽度换行（CJK 宽字符按 2 列计，见 activity-text-expand spec），每条最多 3 行、超出以 `…` 截断。选中事件行 SHALL 高亮（如加亮光标/颜色标记）。活动头部 SHALL 继续显示 agent/model/variant/turn/tokens（token 为会话累计，含跨重启恢复值）。

#### Scenario: 长文本换行不溢出

- **WHEN** 事件文本含中文且超过终端宽度
- **THEN** 按显示宽度换行渲染，任意渲染行不超出终端列宽

#### Scenario: 选中行高亮

- **WHEN** 在 activity 列表选中某事件
- **THEN** 该事件行以醒目标记（颜色/光标）区别于未选中行

#### Scenario: 头部显示会话累计 token

- **WHEN** 任务从 sidecar 恢复 token 后进入活动视图
- **THEN** 头部 tokens 显示恢复值加本次增量（非 0）

### Requirement: 日志视图滚动方向遵循终端惯例

`logs` 模式下，`↓`/`j`（以及替代屏下被终端翻译为方向键的鼠标滚轮向下）SHALL 使视口向更新（更晚）的日志条目移动，`↑`/`k`（滚轮向上）SHALL 向更旧（更早）的条目移动——即滚动方向与 Config、activity-detail 视图及终端回滚习惯一致（见 ADR 0021）。滚动 SHALL 退出 follow 并按 ADR 0019 以视口顶行条目身份锚定；方向修正 SHALL NOT 改变暂停冻结、恢复跟随、`n/N` 匹配跳转、level 过滤及 `↑↓ scroll` 提示文案等既存行为。TUI SHALL NOT 启用原生鼠标跟踪。

#### Scenario: 日志页按 ↓ 显示更新条目

- **WHEN** 日志页处于暂停态、视口可见 `entry 10`（其后存在更新的条目）且用户按 `↓`
- **THEN** 视口顶行变为 `entry 11`（更新的条目）

#### Scenario: 日志页按 ↑ 显示更旧条目

- **WHEN** 日志页处于暂停态、视口顶行为 `entry 11`（其前存在更旧的条目）且用户按 `↑`
- **THEN** 视口顶行变为 `entry 10`（更旧的条目）

#### Scenario: 滚轮与方向键同路径

- **WHEN** TUI 处于替代屏且用户滚动鼠标滚轮
- **THEN** 终端将其翻译为 ↑/↓ 方向键序列，日志页呈现与对应方向键相同的滚动方向（TUI 无原生鼠标跟踪代码路径）

#### Scenario: 顶部/底部边界钳制不变

- **WHEN** 在最新条目处按 `↓` 或在最旧条目处按 `↑`
- **THEN** 视口钳制在边界内（不越界、不跳回 follow 尾部），并退出 follow 显示 `[paused]`

