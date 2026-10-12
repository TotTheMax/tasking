# Proposal: feishu-first-onboarding

## Why

tasking 即将交付给首批真实用户，但当前 `tasking init` 的默认门面是 Jira 最小变体——新手要答完 Jira 六问 + 手工改状态名才能真正跑起来，而目标用户活在飞书里：最短路径应是"一路回车 + 三个飞书配置 + `/chat` 一句话"就能用上。同时生成的 WORKFLOW.md 无论用不用都全量平铺（feishu-direct 里还躺着 40 行永远不会执行的 Jira prompt body），`default` 这个变体名在默认翻转后将永久误导。本变更是发布前的门面翻转：无存量用户、无兼容包袱，破坏性变更免费。

## What Changes

- **BREAKING** 交互式 init 首问改为「任务来源」二选一：**只用飞书直连（回车默认）/ 接 Jira**；选"接 Jira"才追问变体三选一（minimal / code-mr / grill-openspec）
- **BREAKING** 裸 `tasking init`（交互与非交互）默认变体 = `feishu-direct`；`--workflow` 缺省值说明同步
- **BREAKING** 变体 `default` 改名 `minimal`：旗标值、`SUPPORTED_WORKFLOWS`、模板文件名（`WORKFLOW.md.example` → `WORKFLOW.minimal.md.example`）、`detectWorkflow` 兜底值、帮助文本
- 飞书凭据采集改为**边采边验**：app_id + app_secret 采完立即用其换 tenant_access_token 做连通测试（失败报人话原因并允许重输，不等到 start 才炸）
- intake 群**编号帮选**：连通测试通过后调 `listChats`（机器人所在群）列成菜单选择；API 失败或列表为空回落手填 `oc_xxx`
- 新增**可跳过的项目问答**：项目名（回车跳过）→ 目录绝对路径（`existsSync` 校验，不存在重问）；填了则预填 `feishu.direct.projects` 并把 `path_roots` 收敛为该目录；跳过则维持 `[]` 并在完成提示中警告"path 模式当前不限制目录"
- feishu-direct 模板 prompt body 从"哨兵 + 完整 minimal Jira 正文"缩为**哨兵 + 两行用户语言说明**（无 ADR/开发者术语；"想接 Jira → 重跑 init 选接 Jira"）；en 模板同步
- init 完成提示**按变体分级**：feishu-direct 直接给"✅ 配置完成 + `tasking start` + `/chat <项目名> <消息>` 首句命令"；Jira 三变体维持现有手工字段提示
- 文档主线换轨：`getting-started`（双语）重写为 feishu-direct 5 分钟上手主线，Jira 收编为第二章；README/usage/configuration 机械同步改名与默认值

## Capabilities

### New Capabilities

- `feishu-first-onboarding`: init 的飞书优先门面——默认变体 feishu-direct、任务来源首问、飞书凭据连通验证与群帮选、可选项目问答与 path_roots 收敛、按变体分级的完成提示

### Modified Capabilities

- `interactive-init`: 问答流重排——首问从"变体四选一"改为"任务来源二选一（回车=飞书直连）"，接 Jira 分支才追问变体；语言问答保留（回车默认中文）
- `workflow-templates`: `default` 改名 `minimal`（含模板文件名与 `normalizeWorkflow`/`SUPPORTED_WORKFLOWS` 取值）；feishu-direct 模板 body 缩为两行说明；`detectWorkflow` 兜底值改为 `minimal`
- `init-update`: 技能同步与漂移报告中引用的 `detectWorkflow` 兜底变体名跟随改为 `minimal`

## Impact

- `src/cli/init.ts`：问答流重排、凭据验证、群帮选、项目问答、分级提示、变体改名与默认翻转
- `src/cli/help.ts`：`--workflow` 帮助文本（取值清单 + 默认值说明）
- `src/adapters/feishu/source.ts`：init 侧复用 `getTenantAccessToken`/`listChats`（只读复用，不改实现）
- `assets/workflows/`：`WORKFLOW.md.example` 改名 `WORKFLOW.minimal.md.example`（zh/en）；feishu-direct（zh/en）body 缩两行
- 测试：`tests/init.test.ts`（问答序、裸默认、改名、新问答）、`tests/cli.test.ts`/`cli-commands.test.ts`（帮助文本）、`tests/en-templates.test.ts`（PAIRS 表改名）
- 文档：`docs/{zh,en}/getting-started.md`（重写）、`usage.md`、`configuration.md`、`README.md`/`README.zh-CN.md`
- `CONTEXT.md`：词条已在提案前同步（minimal / feishu-direct / 哨兵映射表）
- 非目标（留给后续 change）：生成物按段注释化、Jira 状态名自动预填
