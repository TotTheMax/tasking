## ADDED Requirements

### Requirement: 运行中详情视图全量显示描述
TUI running 任务详情视图（进程内 state 源渲染 `formatRunningDetailFromState`）SHALL 完整渲染任务描述 `task.description`：不做字符数截断、不限制行数，逐行（按换行符）输出全部内容，且末尾换行产生的多余空行 SHALL 被去掉。空描述或 `null` 描述 SHALL 不渲染 Description 区块。该行为仅限 state 源的详情视图，overview 列表与快照源渲染（不展示描述）不受影响。

#### Scenario: 长描述全量显示
- **WHEN** 进入某任务的详情视图且其 `task.description` 超过 200 字符或超过 5 行
- **THEN** 详情视图渲染描述的全部行与全部字符，不出现 `...` 截断

#### Scenario: 多行描述逐行渲染
- **WHEN** 描述含换行
- **THEN** 每个换行对应详情视图的一行输出

#### Scenario: 描述末尾换行不多渲染空行
- **WHEN** 描述以换行结尾
- **THEN** 详情视图不额外渲染该末尾换行对应的空行

#### Scenario: 无描述不渲染区块
- **WHEN** `task.description` 为空字符串或 `null`
- **THEN** 详情视图不渲染 Description 区块
