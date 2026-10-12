## MODIFIED Requirements

### Requirement: fresh start 以新机器方式重置本地桥状态
`CommentBridge.freshStartReset()` SHALL 在 `tasking start --fresh` 时、桥首次 Sweep 之前执行：(1) 删除 `bridge_meta.intake_cursor`，使下一次 `discoverIntake` 走既有冷启动探测（ADR 0016/0018 语义，游标锚定到当前时刻），SHALL NOT 回放停机窗口内 intake 群的历史根消息；(2) 将本地 active bindings 与 Jira 现状对账——issue 已处 `terminal_states` 或未出现在 `fetchIssueStatesByIds` 返回集（已删/不可见）的 binding SHALL `markTerminal`（停止镜像），仍处 active/review 态的 binding SHALL 保留；(3) 对账查询抛错时 SHALL 保守保留全部 binding（不标 terminal），仅输出 WARN 日志。

#### Scenario: 清除游标后下轮探测锚定当前时刻
- **WHEN** `tasking start --fresh` 执行 `freshStartReset()`
- **THEN** `bridge_meta.intake_cursor` 被删除；下一次 Sweep 的 `discoverIntake` 走冷启动探测（只记不处理），不回放停机窗口内的历史根消息

#### Scenario: 终态 issue 的 binding 被标 terminal
- **WHEN** 对账时某 active binding 的 issue 状态属于 `terminal_states`
- **THEN** 该 binding 被 `markTerminal`，不再被 `listActive` 返回、停止镜像

#### Scenario: 缺失(404/不可见) issue 的 binding 被标 terminal
- **WHEN** 对账时某 active binding 的 issue 未出现在 `fetchIssueStatesByIds` 返回集中
- **THEN** 该 binding 被 `markTerminal`（等同既有 JiraNotFound「binding cleaned」语义）

#### Scenario: 仍 active/review 的 binding 保留
- **WHEN** 对账时某 active binding 的 issue 仍处 active_states 或 review 态
- **THEN** 该 binding 保持 active，线程镜像继续

#### Scenario: 对账查询失败保守保留
- **WHEN** 对账的 `fetchIssueStatesByIds` 抛错
- **THEN** 无任何 binding 被 `markTerminal`，输出 WARN 日志，`freshStartReset` 正常结束
