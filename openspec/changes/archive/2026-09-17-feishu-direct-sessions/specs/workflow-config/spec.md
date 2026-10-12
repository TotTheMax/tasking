## ADDED Requirements

### Requirement: feishu.direct 配置段
配置 SHALL 支持 `feishu.direct` 段：`projects`（名称→路径映射，值可为纯路径字符串或 `{ path, auto_approve }` 对象）、`path_roots`（字符串数组，默认 `[]`）、`auto_approve`（布尔，默认 `false`）、`verbosity`（`quiet`|`summary`|`detailed`，默认 `summary`）、`max_concurrent`（正整数，默认 `5`）、`idle_ttl_ms`（正整数，默认 30 天）。resolver SHALL 填充全部默认值并校验类型（未知 verbosity、非正数并发/_ttl、projects 值既非字符串又非对象时报验证错误；`quiet` 合法）。`feishu.direct` 段缺失时 SHALL 默认启用（可用性优先，人工决策）；段内 `enabled: false` 显式关闭。

#### Scenario: 缺省填充
- **WHEN** 配置仅含 `feishu: { direct: { projects: { tasking: /repos/tasking } } }`
- **THEN** 解析结果含默认 `path_roots: []`、`auto_approve: false`、`verbosity: "summary"`、`max_concurrent: 5`、约 30 天的 `idle_ttl_ms`

#### Scenario: 非法值被拒绝
- **WHEN** `verbosity: "loud"` 或 `max_concurrent: 0`
- **THEN** 校验报错并指明字段

#### Scenario: 段缺失时默认启用
- **WHEN** 配置无 `feishu.direct` 段且 feishu.enabled 为 true
- **THEN** effective config 的 direct.enabled 为 true，全部字段取默认值
