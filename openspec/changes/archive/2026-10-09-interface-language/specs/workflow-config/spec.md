## ADDED Requirements

### Requirement: interface_language 字段
WORKFLOW.md front matter SHALL 支持顶层字段 `interface_language`，取值仅 `zh` 或 `en`，缺省为 `zh`（缺省行为与现状完全一致）。非法取值 SHALL 被配置校验拒绝。该字段 SHALL 支持热重载：值变更后无需重启，下一条外发消息/下一次渲染即使用新语言（区别于需要重启的 `tracker.kind`）。`tasking start` SHALL NOT 提供语言覆盖 flag，配置文件为唯一真相源。

#### Scenario: 缺省为 zh
- **WHEN** WORKFLOW.md 未声明 `interface_language`
- **THEN** 解析后 effective config 为 `zh`，行为与现状一致

#### Scenario: 非法值被拒绝
- **WHEN** `interface_language: fr`
- **THEN** 配置校验报错并列出合法取值

#### Scenario: 热重载即时生效
- **WHEN** daemon 运行中把 `interface_language` 从 `zh` 改为 `en` 并保存
- **THEN** 不重启，之后发出的第一条界面文案即为英文
