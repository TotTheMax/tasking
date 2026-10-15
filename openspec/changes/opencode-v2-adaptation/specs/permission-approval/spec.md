## ADDED Requirements

### Requirement: ask 权限挂起并触发审批卡
当 turn 内出现 ask 权限请求（来自工作区/会话规则）时，opencode SHALL 挂起等待；tasking 轮询发现 pending 审批单后 SHALL 向对应话题投放审批卡：直连会话投放到该会话话题，Jira 任务投放到其绑定话题（经桥接管线）。审批卡 SHALL 提供三个按钮：`✅ 允许一次`（`decision:"once"`）、`♾️ 始终允许`（`decision:"always"`，由 opencode 服务端按命令模式持久保存）、`✖ 拒绝`（`decision:"reject"`）。点击后 tasking SHALL 调 `session.permission.reply`（携带 sessionID 与 requestID 双路径参数），turn 当场恢复。话题内所有人可点，不校验操作者身份。

#### Scenario: 直连审批闭环
- **WHEN** 直连 turn 的 agent 请求执行被 ask 规则覆盖的命令
- **THEN** 会话话题出现审批卡，点击"允许一次"后 turn 恢复并最终正常结算

#### Scenario: Jira 任务审批闭环
- **WHEN** auto_approve=false 的 Jira 任务 turn 挂起
- **THEN** 绑定话题出现审批卡，回复经 `session.permission.reply` 生效，turn 恢复

#### Scenario: 始终允许按模式持久
- **WHEN** 点击"始终允许"（审批单 save 建议为 `echo *`）
- **THEN** 本次放行且后续同模式命令不再挂起（规则存于 opencode 服务端）

### Requirement: 审批卡回访路径与终态盖章
审批卡 SHALL 常驻可重判（挂起期间每次轮询校验其状态）；已回复或超时后 SHALL 原位盖章（`✅ 已允许` / `❌ 已拒绝` / `⏰ 超时已拒绝` / `⛔ 已随任务中断`）而非删除。窗口内重复点击、换卡后再点、点击已盖章按钮 SHALL 回复"已处理"类提示且不产生第二次 reply。payload 缺失关键字段（如无 requestID）SHALL 安全忽略。审批卡 SHALL 覆盖卡片交互三场景并通过回路测试。

#### Scenario: 重复点击不二次回复
- **WHEN** 首次点击"允许一次"后 2 秒内再次点击同一按钮
- **THEN** 第二次回复"已处理"，不再次调用 reply

#### Scenario: 换卡后再点旧按钮
- **WHEN** 审批卡被重新渲染后点击旧渲染中的按钮
- **THEN** 按当前实际状态应答（已处理则提示，未处理则正常回复）

#### Scenario: payload 缺字段安全忽略
- **WHEN** 卡片动作 payload 缺失 requestID 或 sessionID
- **THEN** 记录警告并回复错误提示，不影响 turn 与卡片状态

### Requirement: 三层权限模型与 auto_approve 语义
权限 SHALL 分三层：① 工作区 `.opencode/opencode.json` 用户自有规则（tasking 只注入 `mcp.servers.jira`，SHALL NOT 写 permissions）；② 会话级 ruleset——`auto_approve: true`（Jira 路径 `opencode.auto_approve`，直连 `feishu.direct.auto_approve` 及项目覆盖）时 `session.create` 携带全放 ruleset（覆盖工作区 ask），false 时不携带、听工作区规则；③ 逐次审批卡。`auto_approve: false` 且工作区含 ask 规则时的行为 SHALL 为挂起等审批（v1 的"自动拒绝"语义废止）。

#### Scenario: auto_approve=true 覆盖工作区 ask
- **WHEN** 工作区含 `ask shell` 且 auto_approve=true
- **THEN** 会话创建携带全放 ruleset，命令直接执行、不挂起

#### Scenario: false 且无规则默认全放
- **WHEN** auto_approve=false 且工作区无任何 permission 规则
- **THEN** 会话不带 ruleset，命令默认放行（与 v1 行为一致）

### Requirement: 会话权限姿态操作
`perm_on`（本会话放开）SHALL 翻译为 `session.update` 注入全放 ruleset 并立即生效（不再等下一轮边界）；`perm_once`（仅下一轮）SHALL 放开并在下一 turn 边界自动收回；`perm` toggle 与 `/auto off|reset` SHALL 清空会话 ruleset 回到工作区规则；`/auto on|once|off` 命令语义与之一一对应，`on` 仍持久化、`once` 仍内存态。姿态操作 SHALL NOT 修改工作区文件。

#### Scenario: 本会话放开立即生效
- **WHEN** 挂起等审批期间点击"本会话放开"
- **THEN** session.update 后后续权限请求不再挂起（已挂起单子仍按卡面处理或按实现期验证结论处理）

#### Scenario: 仅下一轮自动收回
- **WHEN** 选择"仅下一轮"后完成一轮
- **THEN** 下一 turn 边界会话 ruleset 自动清空，回到工作区规则

#### Scenario: /auto on 持久化
- **WHEN** 执行 `/auto on` 后 daemon 重启并续聊
- **THEN** 会话仍处于放开姿态（覆盖已持久化）
