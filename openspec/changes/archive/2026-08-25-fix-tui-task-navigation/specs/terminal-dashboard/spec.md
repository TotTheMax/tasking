## MODIFIED Requirements

### Requirement: 运行中详情视图全量显示描述
TUI running 任务详情视图（进程内 state 源渲染 `formatRunningDetailFromState`）SHALL 完整渲染任务描述 `task.description`：不做字符数截断、不限制行数，逐行（按换行符）输出全部内容，且超长行 SHALL 按盒宽折行（内容区宽 48 列）以保证盒边框完整，末尾换行产生的多余空行 SHALL 被去掉。空描述或 `null` 描述 SHALL 不渲染 Description 区块。该行为仅限 state 源的详情视图，overview 列表与快照源渲染（不展示描述）不受影响。

#### Scenario: 长描述全量显示
- **WHEN** 进入某任务的详情视图且其 `task.description` 超过 200 字符或超过 5 行
- **THEN** 详情视图渲染描述的全部行与全部字符，不出现 `...` 截断

#### Scenario: 超长行按盒宽折行
- **WHEN** 描述某行超过盒宽（48 列）
- **THEN** 该行被折为多行渲染，每行带 `│  ` 前缀，全部字符保留且盒边框不被破坏

#### Scenario: 多行描述逐行渲染
- **WHEN** 描述含换行
- **THEN** 每个换行对应详情视图的一行输出

#### Scenario: 描述末尾换行不多渲染空行
- **WHEN** 描述以换行结尾
- **THEN** 详情视图不额外渲染该末尾换行对应的空行

#### Scenario: 无描述不渲染区块
- **WHEN** `task.description` 为空字符串或 `null`
- **THEN** 详情视图不渲染 Description 区块

## ADDED Requirements

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