# workflow-config

## ADDED Requirements

### Requirement: tracker 配置段

`tracker.kind` 枚举扩展为 `jira`（缺省）与 `none`。`none` 表达"无结构化任务源"：resolver 接受该值，不解析/不要求其余 Jira 字段；tracker 块在 `kind: none` 下仍残留其他字段（`endpoint`/`api_key`/`project_key` 等）时，配置解析 SHALL 产生一条 WARN 说明这些字段被忽略，防止"我配了怎么不生效"的困惑。未知 `kind` 值仍按 `unsupported_tracker_kind` 报错。

#### Scenario: kind none 解析通过
- **WHEN** WORKFLOW.md 写 `tracker: { kind: none }`
- **THEN** 配置解析成功，`EffectiveConfig.tracker.kind` 为 `"none"`

#### Scenario: 残留字段告警
- **WHEN** `kind: none` 且 tracker 块同时写了 `endpoint` 与 `api_key`
- **THEN** 解析成功并产生一条"tracker 其余字段在 kind:none 下被忽略"WARN

#### Scenario: 未知 kind 仍报错
- **WHEN** `tracker.kind: github`
- **THEN** 启动报 `unsupported_tracker_kind`（现状不变）
