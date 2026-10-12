## ADDED Requirements

### Requirement: feishu.edition 配置
配置 SHALL 支持 `feishu.edition` 字段：合法值 `feishu` 与 `lark`，缺省默认 `feishu`（与既有部署行为一致，零迁移）。resolver SHALL 填充默认值，并 SHALL 无条件做枚举校验（不按 `feishu.enabled` 条件化）——非法值 MUST 在配置解析阶段抛错导致启动阻断，报错文案列全合法值，SHALL NOT 警告后回退默认值（防止 lark 凭据被静默发往 cn 域名）。

#### Scenario: 缺省默认 feishu
- **WHEN** 配置的 `feishu:` 块不含 `edition` 键
- **THEN** 解析结果 `feishu.edition` 为 `"feishu"`

#### Scenario: 显式 lark 合法
- **WHEN** 配置含 `feishu.edition: lark`
- **THEN** 校验通过，`feishu.edition` 为 `"lark"`

#### Scenario: 非法值阻断启动
- **WHEN** 配置含 `feishu.edition: cn`（或任意非枚举值）
- **THEN** 启动校验失败，报错指明 `feishu.edition` 合法值为 `feishu`/`lark`
