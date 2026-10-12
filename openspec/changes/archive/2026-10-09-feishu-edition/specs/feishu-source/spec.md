## MODIFIED Requirements

### Requirement: 飞书认证与端点配置
适配器 SHALL 从配置读取飞书应用凭据(app id/secret 或 `$VAR` 间接引用)。SHALL 读 `feishu.intake_chat_id`（启用时必填）、`feishu.forward_interval_ms`（默认 5000）、`feishu.sweep_interval_ms`（默认 12h）、`feishu.create_issue_type`。旧键 `feishu.poll_interval_ms` SHALL 被忽略并发出弃用警告（见 comment-bridge spec 配置键迁移场景）。`feishu.verification_token`/`encrypt_key` 在事件通道模式下 SHALL NOT 被使用（保留供将来 webhook 模式）。飞书源启用时，缺失 app id/secret 或 `intake_chat_id` SHALL 为配置校验错误。

REST API base SHALL 由 `feishu.edition` 集中派生（`feishu` → `https://open.feishu.cn`，`lark` → `https://open.larksuite.com`），全部 REST 调用（含 token 获取）SHALL 使用派生值，SHALL NOT 在调用点硬编码域名。tenant_access_token 获取认证失败时 SHALL 在失败输出中附带跨区域提示（条件句文案，指出另一版的 `feishu.edition` 设置写法）。daemon 启动时 SHALL 以 info 日志输出一行实际生效的 API base。

#### Scenario: 缺 intake_chat_id 校验失败
- **WHEN** feishu.enabled 但 `intake_chat_id` 缺失
- **THEN** 配置校验失败

#### Scenario: verification_token 不被使用
- **WHEN** REST 轮询模式运行
- **THEN** `verification_token`/`encrypt_key` 不参与任何校验/解密

#### Scenario: edition=lark 时 REST 走海外域名
- **WHEN** `feishu.edition: lark` 下发送消息/拉取话题/token 获取
- **THEN** 所有请求 URL 的主机为 `open.larksuite.com`，路径与请求结构不变

#### Scenario: 认证失败附跨区域提示
- **WHEN** `feishu.edition: feishu` 下 tenant_access_token 获取返回认证失败
- **THEN** 失败日志/输出含指向 `feishu.edition: lark` 的条件句提示

#### Scenario: 启动日志透出实际域名
- **WHEN** daemon 以 `feishu.edition: lark` 启动
- **THEN** 启动日志含一行 `https://open.larksuite.com` 的 API base 信息
