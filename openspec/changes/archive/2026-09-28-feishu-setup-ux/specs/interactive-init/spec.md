# interactive-init — delta

## ADDED Requirements

### Requirement: init 飞书体检输出
交互式 init 在飞书凭据验证通过后 SHALL 运行 scope 探针并逐项输出结果；缺失项 MUST 附补救指引（控制台搜索词 + 深链）。缺失权限 SHALL 只警告不阻断，init 的硬门槛保持为凭据正确性。直连路径与接 Jira 路径 SHALL 共用同一体检逻辑。

#### Scenario: 直连路径体检
- **WHEN** 直连 init 中凭据验证通过且 `im:resource` 未开通
- **THEN** 体检输出中该项为 ✗ 并附 `im:resource` 搜索指引与权限页深链，流程继续

#### Scenario: 接 Jira 路径体检
- **WHEN** 接 Jira init 中启用飞书桥且所有探针通过
- **THEN** 体检输出各项为 ✓，继续后续采集

### Requirement: 群选择器新建 intake 群选项
交互式 init 的飞书群选择器顶部 SHALL 提供「新建 intake 群」选项：选中后询问群名（默认 `tasking-intake`），调用建群 API，成功后以新群 chat_id 完成选择。建群失败（如缺 `im:chat` 权限）SHALL 输出缺失说明与深链，并降级回群选择器手选已有群。非交互模式 SHALL 不提供此选项。

#### Scenario: 新建成功
- **WHEN** 用户选择新建并接受默认群名，且 `im:chat` 已开通
- **THEN** 建群成功，生成的 WORKFLOW.md `intake_chat_id` 为新群 chat_id

#### Scenario: 缺权限降级
- **WHEN** 用户选择新建但建群 API 报权限错误
- **THEN** 输出缺 `im:chat` 说明与权限页深链，返回群选择器可手选已有群

#### Scenario: 非交互跳过
- **WHEN** 以 `--non-interactive` 运行 init
- **THEN** 不发起任何建群请求

#### Scenario: 新建并拉创建者进群
- **WHEN** 用户选择新建并填写飞书邮箱或手机号，且 `contact:user.id:readonly` 已开通
- **THEN** 建群请求的成员列表包含该用户的 open_id，生成的 WORKFLOW.md `intake_chat_id` 为新群 chat_id，输出提示用户已在群里

#### Scenario: 只有机器人的群不选用
- **WHEN** 新建成功但未拉入任何人类成员（邀请被跳过或用户查询失败）
- **THEN** 输出明确警告该群只有机器人成员、用户在飞书不可见，不将其写为 intake_chat_id，并引导手动建群后通过「⟳ 刷新群列表」重选
