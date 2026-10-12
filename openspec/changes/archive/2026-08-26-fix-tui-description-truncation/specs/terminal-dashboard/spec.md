## MODIFIED Requirements

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
