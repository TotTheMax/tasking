## ADDED Requirements

### Requirement: opencode 配置段（v2）
`opencode` 配置段 SHALL 包含：`command`（默认 `"opencode"`，按空白拆分为命令与参数）、`agent`、`agents`、`model`（`provider/model` 形态或 null）、`variant`（独立配置或 null，映射 Model.Ref 的 variant）、`turn_timeout_ms`、`inactivity_timeout_ms`、`stall_timeout_ms`、`auto_approve`（Jira 路径会话是否全放）及新键 `poll_interval_ms`（默认 2000，轮询间隔，最小 1）、`permission_timeout_ms`（默认 1800000，审批等待预算）、`server_url`（默认 null=自动发现共享服务，非空透传 `--server`）。model 与 variant SHALL 彼此独立，可只配其一。

#### Scenario: 新键默认值
- **WHEN** WORKFLOW.md 未配置新键
- **THEN** 生效配置为 `poll_interval_ms=2000`、`permission_timeout_ms=1800000`、`server_url=null`

#### Scenario: variant 独立于 model
- **WHEN** 仅配置 `opencode.variant: high`
- **THEN** 会话创建仅携带 variant 语义（model 用服务端默认），配置校验通过

#### Scenario: command 支持自定义二进制
- **WHEN** `opencode.command` 配置为 `/usr/local/bin/opencode`
- **THEN** api 调用以该路径为命令前缀执行
