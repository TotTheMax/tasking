# Proposal: init-output-quality

## Why

`tasking init` 生成的 WORKFLOW.md 目前是「模板整份照搬」：无论用不用，`polling`/`agent`/`opencode`/`server`/`logging`/`env` 等可选段全部以默认值平铺，`router` 是**无运行时代码的死配置**（resolver 解析但无人消费），feishu 块里还留着 webhook 预留字段——新手打开文件看到 200+ 行「全是我没配的」。同时 Jira 路径有一个必须手改的堵点：`active_states`/`terminal_states` 默认英文名对不上中文 Jira，不改调度器永不派发；而 init 的连接测试**已经拉到了项目状态列表**却没利用。

## What Changes

- **生成物按段裁剪**：生成的 WORKFLOW.md 只把「必填/已采集/非默认」的段保持 active（tracker 凭证与状态、feishu 块、用户填的项目等），其余可选段整段注释、段头一句“可选——默认值如下，改动才解注释”；注释文本仍来自模板（单真相），不做注释重建
- **死配置收敛**：`router` 段与 feishu 的 `verification_token`/`encrypt_key` 在模板与生成物中整段注释并标注“未实现/预留”
- **BREAKING** 非交互 init 不再字节复制模板，改走同一生成路径（占位凭证 + 同样的分段策略），两条路径产物风格一致
- **Jira 状态自动预填**：Jira 连接测试拉到的项目状态列表，按常见中英文名映射到 active/review/terminal 三类并预填进生成的 frontmatter，用户在 init 内**确认/修正**而非事后手改
- **完成提示跟随**：状态已预填后，Jira 变体的完成提示不再让用户手动编辑这四个字段，只提示剩余可选项
- **漂移报告语义对齐**：`--update` 对“用户文件缺失的可选键”改述为“走 DEFAULTS 的默认值”，避免精简后的文件每次都被报成“新增字段”

## Capabilities

### New Capabilities

- `generated-config-trimming`: 生成物的分段裁剪策略——哪些段 active、哪些整段注释、死配置如何标注；交互与非交互两条生成路径共用
- `jira-state-autofill`: 从项目状态列表按常见中英文名映射并预填 `active_states`/`terminal_states`/`review_state`，含确认与回落

### Modified Capabilities

- `workflow-templates`: 模板中 `router` 与 feishu webhook 预留字段改为注释态；模板仍是 canonical 全量参照（漂移检测/语言对齐测试的基准）
- `interactive-init`: Jira 流程新增状态预填确认问答；完成提示按“是否仍有必改项”分级
- `init-update`: 漂移报告对缺失可选键的措辞改为“默认值”语义

## Impact

- `src/cli/init.ts`：分段裁剪变换、非交互走生成路径、状态映射与确认问答、完成提示
- `assets/workflows/*.md.example`（8 份 ×2 语言）：router/webhook 注释化
- 测试：`tests/init.test.ts`（非交互产物性质断言取代字节一致、状态预填）、`tests/en-templates.test.ts`（PAIRS 新约束）、`tests/prompt.test.ts`（模板 body 不受影响）
- 文档：`docs/{zh,en}/usage.md`、`configuration.md`（生成物风格说明 + router 未实现标注）、`getting-started` 的 Jira 章节（不再要求手改状态名）
- 非目标：`router` 的运行时实现；模板转全注释风格（sshd 式，已否决）
