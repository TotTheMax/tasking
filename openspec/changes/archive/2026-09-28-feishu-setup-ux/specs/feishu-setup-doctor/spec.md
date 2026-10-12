# feishu-setup-doctor — 飞书配置体检与运行时诊断

## ADDED Requirements

### Requirement: 飞书 scope 探针
系统 SHALL 提供三个只读飞书探针，供 init 流程与 doctor 命令共用：列群（验证 `im:chat:readonly`）、读指定群消息（验证 `im:message.group_msg` 与 `im:message:readonly`）、上传 10 字节探针文件（验证 `im:resource`）。每个探针 SHALL 将失败归类为 `missing`（可归因到具体权限/配置缺失）或 `unknown`（网络异常等不可归因），`missing` MUST 附带补救指引（控制台搜索词或缺失项说明）。发消息权限（`im:message:send_as_bot`）SHALL 不探测，输出中如实标注未探测。

#### Scenario: 全部权限就绪
- **WHEN** 三个探针请求全部成功
- **THEN** 每项报告 `ok`，无补救指引

#### Scenario: 缺读群消息权限
- **WHEN** 读群消息探针返回错误码 230027
- **THEN** 该项报告 `missing`，指引包含 `im:message.group_msg` 与控制台权限页深链

#### Scenario: 缺文件上传权限
- **WHEN** 上传探针文件返回错误码 99991672
- **THEN** 该项报告 `missing`，指引包含 `im:resource` 与控制台权限页深链

#### Scenario: 网络不可达
- **WHEN** 探针请求因网络异常失败（无 HTTP 状态码）
- **THEN** 该项报告 `unknown`，不声称任何权限缺失

### Requirement: 控制台深链
系统 SHALL 集中提供飞书开发者后台深链生成：应用根、权限页、事件页、版本页。所有深链 MUST 内嵌当前 app_id。具体子路径无法保证稳定时 SHALL 退回应用根链 `https://open.feishu.cn/app/{app_id}`。

#### Scenario: 深链内嵌 app_id
- **WHEN** 以 `cli_xxx` 生成权限页深链
- **THEN** URL 含 `cli_xxx` 且指向该应用的控制台页面

### Requirement: 运行时错误诊断与降噪
飞书 API 调用失败时，系统 SHALL 将已知错误映射为人话提示并附对应深链：403 → 版本未发布/未审批或权限缺失（版本页深链）、230027 → 缺 `im:message.group_msg`（权限页深链）、99991672 → 缺 `im:resource`（权限页深链）。同一错误签名（方法+状态）在 daemon 一次运行内 SHALL 只完整提示一次，后续同类失败 SHALL 仅输出单行简短记录。

#### Scenario: 首次 403 完整提示
- **WHEN** 飞书发送消息返回 403 且为本运行内首次
- **THEN** 日志含人话原因说明与版本页深链

#### Scenario: 重复 403 降噪
- **WHEN** 同一方法再次返回 403
- **THEN** 日志仅单行记录，不重复人话提示与深链

### Requirement: doctor 全链路只读体检
`tasking doctor` SHALL 依序执行只读检查：WORKFLOW.md 解析、飞书（token、三探针、intake 群可达）、Jira 连接（仅当配置了 Jira）、opencode 在 PATH。输出 SHALL 为中文、逐项 ✓/✗/− 与补救提示，末尾汇总表；全部通过退出码 `0`，任一失败退出码 `1`。doctor SHALL 不执行任何写操作。

#### Scenario: 全部通过
- **WHEN** 配置与外部依赖全部正常时运行 `tasking doctor`
- **THEN** 各项标 ✓，汇总表列出通过项，退出码 `0`

#### Scenario: WORKFLOW.md 损坏
- **WHEN** WORKFLOW.md 无法解析时运行 `tasking doctor`
- **THEN** 飞书/Jira 检查项标 −（跳过），WORKFLOW 项标 ✗ 并给出错误位置，退出码 `1`

#### Scenario: 缺 opencode
- **WHEN** opencode 不在 PATH 时运行 `tasking doctor`
- **THEN** opencode 项标 ✗ 并附安装指引，退出码 `1`
