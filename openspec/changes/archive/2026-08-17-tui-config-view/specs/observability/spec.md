## ADDED Requirements

### Requirement: 有效配置与运行时属性端点

HTTP dashboard SHALL 在 `GET /api/v1/config` 上返回 daemon 当前有效配置（EffectiveConfig）与运行时属性。响应 SHALL 含 `config`（脱敏后的有效配置，分组：tracker / polling / workspace / hooks / agent / opencode / router / feishu / server / logging / env）与 `runtime`（pid、started_at、workflow_path、workspace_root、log_path、host、port）。密钥字段（tracker.api_key、feishu.app_secret、feishu.verification_token、feishu.encrypt_key、env 段值）SHALL 在响应中脱敏为 `****`。`started_at` SHALL 使用 ISO 8601 格式。该端点 SHALL 仅为可观测/控制面，不参与正确性。

#### Scenario: 返回有效配置
- **WHEN** 请求 `GET /api/v1/config`
- **THEN** 返回 200，含脱敏后的 config 与运行时属性

#### Scenario: 密钥脱敏
- **WHEN** 请求 `GET /api/v1/config` 且配置含 api_key 等密钥
- **THEN** 响应中对应字段为 `****`

#### Scenario: 运行时属性
- **WHEN** 请求 `GET /api/v1/config`
- **THEN** runtime 含 pid、started_at（ISO 8601）、workflow_path、workspace_root、log_path、host、port

#### Scenario: 不支持的方法返回 405
- **WHEN** 对 `/api/v1/config` 发送 POST
- **THEN** 返回 405
