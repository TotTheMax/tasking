# generated-config-trimming

## ADDED Requirements

### Requirement: 生成物只保留必需段 active

`tasking init` 生成 `WORKFLOW.md` 时 SHALL 只把该变体必需/已采集/非默认的顶层段保持 active，其余段 SHALL 整段以 `# ` 前缀注释（保留缩进与原注释文本，默认值可见），并在注释段首插入一行 `# —— 可选：以下为默认值，改动才解注释 ——`。注释文本 SHALL 直接取自模板（apply 注释，不从注释重建 YAML）。交互与非交互两条路径 SHALL 共用同一实现。

active 段集合：`feishu-direct` → `tracker`、`feishu`（含 `direct`）；`minimal` → `tracker`、`hooks`、`feishu`（启用时）；`code-mr` / `grill-openspec` → `tracker`、`hooks`、`env`、`feishu`（启用时）。

#### Scenario: feishu-direct 生成物只活跃 tracker 与 feishu
- **WHEN** 以 feishu-direct 变体完成 init
- **THEN** 生成的 WORKFLOW.md 中 `tracker:` 与 `feishu:` 段为活配置，`polling`/`workspace`/`hooks`/`agent`/`opencode`/`env`/`server`/`logging` 各段整段为注释且段首带「可选」提示

#### Scenario: minimal 生成物活跃 tracker/hooks/feishu
- **WHEN** 以 minimal 变体完成 init
- **THEN** `tracker`/`hooks`/`feishu` 为活配置，`polling`/`workspace`/`agent`/`opencode`/`env`/`server`/`logging` 为注释段

#### Scenario: MR 变体额外活跃 env
- **WHEN** 以 code-mr 或 grill-openspec 完成 init
- **THEN** `env` 段为活配置（GITLAB 凭据入口），其余非必需段为注释

#### Scenario: 非交互产物同风格
- **WHEN** 运行 `tasking init --non-interactive`
- **THEN** 产物与交互路径同风格：必需段 active（占位凭证）、可选段注释，而非模板逐字节副本

#### Scenario: 注释内容保留默认值
- **WHEN** 查看生成物中被注释的可选段
- **THEN** 每行以 `# ` 开头且保留模板中的默认值与说明文本

### Requirement: 未启用的 feishu 段只保 enabled 行

Jira 变体下用户未启用飞书桥时，生成物的 `feishu:` 段 SHALL 只保留 `enabled: false` 一行 active，段内其余行 SHALL 按同法注释。

#### Scenario: 未启用飞书
- **WHEN** 接 Jira 且在 Feishu Setup 选择不启用
- **THEN** 生成物 `feishu:` 段仅 `enabled: false` 为活行，`app_id`/`app_secret`/`intake_chat_id`/`direct` 等为注释

### Requirement: 死配置在生成物中注释并标注

生成物 SHALL 将无运行时消费方的配置整段/逐行注释并标注原因：`router` 段（标注「未实现：当前仅解析，无运行时代码」）、`feishu.verification_token` / `feishu.encrypt_key`（标注「webhook 模式预留，REST 轮询下不用」）。

#### Scenario: router 段被注释并标注未实现
- **WHEN** 查看任意变体的生成物
- **THEN** `router:` 段全部为注释行且含「未实现」标注

#### Scenario: webhook 预留字段被注释
- **WHEN** 查看 feishu 段的生成物
- **THEN** `verification_token` 与 `encrypt_key` 为注释行并含「预留」说明

### Requirement: 分段护栏

生成器的分段实现 SHALL 以顶层键（`^[a-z_]+:`）切段，且 SHALL 有测试断言「切段得到的顶层键集合 == 该变体的期望集合（active ∪ 注释）」，使模板新增顶层段而未同步生成器时失败可见。

#### Scenario: 模板新增段未跟进时测试失败
- **WHEN** 模板新增一个顶层段而生成器的期望键集合未包含它
- **THEN** 分段护栏测试失败
