## ADDED Requirements

### Requirement: Feishu edition 首问
交互式 init 的两条飞书配置流程（feishu-direct 分支与接 Jira 分支的 Feishu Setup）SHALL 在采集 app_id 之前先问飞书版本：选项 `国内版（飞书）（默认）` 与 `海外版（Lark）`，默认项按模板语言预选（中文→国内版，English→海外版；askSelect 首项即回车默认）。回答后：现场凭据验证（tenant_access_token）与后续体检 SHALL 立即使用所选 edition 的 API 域名；生成的 WORKFLOW.md `feishu:` 块 SHALL 写入 `edition` 明文值。凭据验证失败输出 SHALL 附跨区域提示（指向另一版的 edition 写法）。不配置飞书（Jira-only / 桥接流程选择不启用）时 SHALL NOT 出现此问、SHALL NOT 写 `edition` 键。SHALL NOT 纯按语言推断跳过提问（语言≠区域）。

#### Scenario: 首问位置与默认预选
- **WHEN** 中文模板语言下进入飞书配置流程
- **THEN** app_id 问答之前出现版本选择，首项（回车默认）为 `国内版（飞书）`

#### Scenario: English 预选海外版
- **WHEN** English 模板语言下进入飞书配置流程
- **THEN** 版本选择首项（回车默认）为 `海外版（Lark）`

#### Scenario: 验证走所选域名
- **WHEN** 用户选择 `海外版（Lark）` 后输入 app_id/secret
- **THEN** init 凭据验证请求发往 `open.larksuite.com`

#### Scenario: 写入 WORKFLOW.md
- **WHEN** 飞书配置完成且用户选择了 `海外版（Lark）`
- **THEN** 生成的 WORKFLOW.md `feishu:` 块含 `edition: lark`

#### Scenario: 不配飞书不问
- **WHEN** 接 Jira 分支中用户选择不启用飞书桥
- **THEN** 不出现版本问答，生成的配置不含 `edition` 键

#### Scenario: 验证失败附跨区域提示
- **WHEN** 所选 edition 下凭据验证失败
- **THEN** 失败输出含"若应用创建于另一版，设置 feishu.edition"的条件句提示
