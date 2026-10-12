## MODIFIED Requirements

### Requirement: 控制台深链
系统 SHALL 集中提供飞书开发者后台深链生成：应用根、权限页、事件页、版本页。所有深链 MUST 内嵌当前 app_id。深链域名 SHALL 按 `feishu.edition` 派生（`feishu` → `https://open.feishu.cn`，`lark` → `https://open.larksuite.com`）。具体子路径无法保证稳定时 SHALL 退回应用根链 `{console_base}/app/{app_id}`。

#### Scenario: 深链内嵌 app_id
- **WHEN** 以 `cli_xxx` 生成权限页深链
- **THEN** URL 含 `cli_xxx` 且指向该应用的控制台页面

#### Scenario: lark 深链走海外域名
- **WHEN** `feishu.edition: lark` 下以 `cli_xxx` 生成应用根深链
- **THEN** 退回链为 `https://open.larksuite.com/app/cli_xxx`
