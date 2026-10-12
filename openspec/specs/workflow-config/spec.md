## Purpose

WORKFLOW.md（运行时 workflow 配置文件）的 `opencode:` 块中 model 配置示例的状态约束。
## Requirements
### Requirement: WORKFLOW.md opencode block does not reference glm-5.2

The `opencode:` block of `WORKFLOW.md` SHALL NOT contain a commented-out `model: alibaba-token-plan-cn/glm-5.2` line. The active `model: opencode-go/deepseek-v4-flash` line and the other commented example line SHALL remain present and unchanged.

#### Scenario: glm-5.2 example line removed
- **WHEN** inspecting the `opencode:` block of `WORKFLOW.md`
- **THEN** the line `# model: alibaba-token-plan-cn/glm-5.2` is absent, while the active `model: opencode-go/deepseek-v4-flash` line and the `# model: deepseek/deepseek-v4-flash` comment remain.

### Requirement: feishu.direct 配置段
配置 SHALL 支持 `feishu.direct` 段：`projects`（名称→路径映射，值可为纯路径字符串或 `{ path, auto_approve }` 对象）、`path_roots`（字符串数组，默认 `[]`）、`auto_approve`（布尔，默认 `false`）、`verbosity`（`quiet`|`summary`|`detailed`，默认 `detailed`）、`max_concurrent`（正整数，默认 `5`）、`idle_ttl_ms`（正整数，默认 30 天）。resolver SHALL 填充全部默认值并校验类型（未知 verbosity、非正数并发/_ttl、projects 值既非字符串又非对象时报验证错误；`quiet` 与 `summary` 合法）。`feishu.direct` 段缺失时 SHALL 默认启用（可用性优先，人工决策）；段内 `enabled: false` 显式关闭。`detailed` 默认值附带客户端版本要求（见 direct-sessions「每 turn 一条总结消息」）：折叠面板需飞书/Lark 客户端 ≥ V7.9。

#### Scenario: 缺省填充
- **WHEN** 配置仅含 `feishu: { direct: { projects: { tasking: /repos/tasking } } }`
- **THEN** 解析结果含默认 `path_roots: []`、`auto_approve: false`、`verbosity: "detailed"`、`max_concurrent: 5`、约 30 天的 `idle_ttl_ms`

#### Scenario: 非法值被拒绝
- **WHEN** `verbosity: "loud"` 或 `max_concurrent: 0`
- **THEN** 校验报错并指明字段

#### Scenario: 段缺失时默认启用
- **WHEN** 配置无 `feishu.direct` 段且 feishu.enabled 为 true
- **THEN** effective config 的 direct.enabled 为 true，全部字段取默认值

#### Scenario: 显式 summary 回到纯文本
- **WHEN** `verbosity: "summary"`
- **THEN** 解析结果为 `summary`，交付回到纯文本 + 统计行（老客户端环境的显式回退路径）

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
