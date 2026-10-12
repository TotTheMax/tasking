# Proposal: feishu-direct init 变体——飞书直连专用部署的交付面

## Why

Change ①（`feishu-direct-source-switch`）让 `tracker.kind: none` 的部署可以运行，但用户没有任何途径**生成**这样的配置：现有三变体（default/code-mr/grill-openspec）全部面向 Jira 路径，交互式 init 强制回答 Jira 三问（endpoint/api_key/project）。直连专用用户需要一个开箱即用的起点。

## What Changes

- `SUPPORTED_WORKFLOWS` 新增第 4 个变体 **`feishu-direct`**：唯一以**配置**（`tracker.kind: none` + feishu 启用）而非 prompt body 区分的变体；语言轴（zh/en）照旧适用。
- 新模板 `assets/workflows/WORKFLOW.feishu-direct.md.example`（+ `.en.` 版）：tracker 块 `kind: none` 生效但**保留全量 Jira 字段注释**并注明切换方法（用户看不到源码，WORKFLOW.md 是唯一配置参考）；feishu 块完整文档化（app_id/secret/intake + direct.projects/path_roots 示例）；prompt body 沿用 default 最小正文 + 注释说明"直连会话以用户消息为 prompt，此 body 供将来启用 Jira 时使用"。
- sentinel `<!-- tasking-workflow: feishu-direct -->` + `detectWorkflow` 四路探测；`--update` 漂移检测复用现有机制。
- 交互式 init（Q7+B 定案）：选择 `feishu-direct` 时**跳过 Jira 三问与连接测试**、跳过 "Enable Feishu bridge" 问答（`enabled: true` 直接烘焙）、跳过 issue types 问答（无 Jira 可查）；只问 app_id/app_secret/intake_chat_id；**不新增**交互式 projects 收集（模板留注释示例）。
- 非交互：`tasking init --workflow feishu-direct [--lang en]` 直接写模板。
- 技能集：**不安装**任何 tasking 技能（同 default——`land`/opsx 系都是 Jira 路径向）。
- 文档：`docs/{zh,en}/configuration.md` 变体表与语言表、`usage.md`、`getting-started`、`README` 双语的变体清单同步。

## Capabilities

### New Capabilities

（无——全部为既有能力的扩展）

### Modified Capabilities
- `workflow-templates`: 变体枚举扩为四个；模板映射、哨兵探测、技能集、新模板的配置面与 prompt body 约定。
- `interactive-init`: workflow 选择问答选项扩展；`feishu-direct` 分支的问答裁剪（跳 Jira、跳 Enable-Feishu、跳 issue types）。
- `cli-runtime`: `init 生成工作流骨架` 需求的变体×语言映射表扩为四变体。

## Impact

- 修改：`src/cli/init.ts`（变体枚举、`resolveExampleFile`、`detectWorkflow`、交互分支）、新增 `assets/workflows/WORKFLOW.feishu-direct{,.en}.md.example`、`package.json` 无需改（`assets` 已整目录打包）。
- 测试：`tests/init.test.ts`（新变体字节一致写入 + 交互流 promptInterface 用例 + `--update` 漂移）、`tests/en-templates.test.ts`（PAIRS 扩四对、Liquid 表达式对齐、协议哨兵、agents catalog、DEFAULTS 覆盖）、`tests/prompt.test.ts`（模板 body 渲染）。
- 文档：上述双语页面 + AGENTS.md 路由表无需改（`assets/workflows/WORKFLOW*.md.example` 通配已覆盖）。
- 依赖：**依赖 Change ① 落地**（`kind: none` 语义先存在，模板才有意义）；实现顺序 ①→②。
- 非目标：不做交互式 projects 收集；不改现有三变体的任何行为。
