# workflow-templates

## MODIFIED Requirements

### Requirement: 三个 workflow 变体与模板映射

starter 模板变体 SHALL 为四个：`default`、`code-mr`、`grill-openspec`、`feishu-direct`。`tasking init --workflow <variant>` 按变体×语言映射写模板：`feishu-direct` → `assets/workflows/WORKFLOW.feishu-direct.md.example`（zh）/ `assets/workflows/WORKFLOW.feishu-direct.en.md.example`（en）。`feishu-direct` 是唯一以**配置**（`tracker.kind: none` + feishu 启用）而非 prompt body 区分的变体——直连会话以用户消息为 prompt，变体的 prompt 轴在该部署形态下不适用。未知 `--workflow` 值仍报错退出。

#### Scenario: 非交互写入 feishu-direct 模板
- **WHEN** `tasking init --workflow feishu-direct --nonInteractive`
- **THEN** 生成的 `WORKFLOW.md` 与 `assets/workflows/WORKFLOW.feishu-direct.md.example` 字节一致，含 `tracker.kind: none` 与 `feishu.enabled: true`

#### Scenario: 未知变体仍报错
- **WHEN** `tasking init --workflow custom`
- **THEN** 报错列出全部四个支持值并以非零码退出

### Requirement: 变体哨兵标记与 detectWorkflow 三路探测

`detectWorkflow` SHALL 四路探测：`feishu-direct` 哨兵 `<!-- tasking-workflow: feishu-direct -->`（最优先——该模板 prompt body 沿用 default 最小正文，必须靠哨兵区分）→ grill 标记 `## 🔍 拷问 / Grill Questions` → code-mr 标记 `<!-- tasking-workflow: code-mr -->` → default 兜底。`--update` 漂移检测对 `feishu-direct` 生成的 WORKFLOW.md SHALL 复用同一探测与对应参考模板。

#### Scenario: detectWorkflow 识别 feishu-direct
- **WHEN** `--update` 面对含 feishu-direct 哨兵的 WORKFLOW.md（body 为 default 最小正文）
- **THEN** 变体判定为 `feishu-direct`，漂移对比使用 feishu-direct 参考模板

### Requirement: 按变体的技能集

技能安装集合 SHALL 仅由变体决定：`feishu-direct` 与 `default` 一样**不安装**任何 tasking 技能（`land`/`install-glab`/opsx 系均为 Jira 路径向）；已存在的技能目录跳过不覆盖；`--update` 技能同步对 feishu-direct 无技能可同步。

#### Scenario: feishu-direct init 不装技能
- **WHEN** `tasking init --workflow feishu-direct`
- **THEN** `.opencode/skills/` 下不写入任何 tasking 技能

## ADDED Requirements

### Requirement: feishu-direct 模板的配置面与 prompt body

feishu-direct 模板 SHALL 满足：① tracker 块 `kind: none` 生效并**保留全量 Jira 字段注释**（与 default 模板同构），头部注释注明"如需启用 Jira 源：改 `kind: jira` 并填写以下字段"——用户看不到源码，WORKFLOW.md 是唯一配置参考；② feishu 块 `enabled: true`，app_id/app_secret/intake_chat_id 以 `$VAR` 引用，direct 段完整文档化（projects 两形态示例、path_roots、auto_approve、verbosity、max_concurrent、idle_ttl_ms）；③ prompt body 沿用 default 最小正文 + 顶部注释说明"直连会话以用户消息为 prompt，此 body 在启用 Jira 源后生效"；④ 与其余模板一致满足 agents catalog（`opencode.agents: []` + 注释）与 `DEFAULTS.feishu` 键覆盖守卫。

#### Scenario: 模板可解析且配置自洽
- **WHEN** 解析 feishu-direct 模板 front matter
- **THEN** `tracker.kind` 为 `none`、`feishu.enabled` 为 true、`feishu.direct` 空配置解析合法（与 en-templates 守卫同口径）

#### Scenario: 切换 Jira 源的路径自明
- **WHEN** 用户阅读模板 tracker 块
- **THEN** 注释给出启用方法（改 kind 并填字段），字段说明齐全，无需查阅源码
