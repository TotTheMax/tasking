# Design: feishu-first-onboarding

## Context

- 无存量用户约束：破坏性变更免费，不留迁移垫片、不保兼容层
- init 现状（`src/cli/init.ts`）：交互流 = 变体四选一 → 语言 → （feishu-direct：飞书三问 | jira：六问+连接测试+可选飞书问答）；非交互 = 字节复制模板；`default` 变体为缺省
- 复用资产：`FeishuSource.getTenantAccessToken` / `listChats`（连通测试与群帮选只读复用，模式对齐既有 `testJiraConnection`）；`PromptInterface`（ask/askSelect）；问答 mock 模式（`tests/init.test.ts` 的 promptInterface 注入）
- 两个前置 change（`feishu-direct-source-switch` / `feishu-direct-init-variant`）已完成未归档，本变更的 delta 按归档后的目标态书写

## Goals / Non-Goals

**Goals**：新手最短路径 = `tasking init` 一路回车 + 三个飞书问答 → `tasking start` → `/chat` 跑通；变体命名与默认值不再互相矛盾；配置即所得（填了项目即锁目录）。

**Non-Goals**（后续 change）：生成物按段注释化；Jira 状态名自动预填；`--update` 漂移语义调整；任何面向存量用户的迁移。

## Decisions

### D1 默认变体翻转的实现位置

默认值收敛在 `normalizeWorkflow(undefined)`：交互路径的缺省走"任务来源首问的回车项"，非交互路径缺省返回 `feishu-direct`。`--workflow` 显式指定优先于一切。`runNonInteractiveInit` 保持字节复制（复制的是 feishu-direct 新模板），不引入生成器——注释化属于 change ②。
_否决_：在 CLI 解析层给 `--workflow` 塞默认值——会把"用户显式选了"与"没传"混为一谈，探测与帮助文本都需要区分。

### D2 任务来源首问的分支语义

新函数 `selectTaskSource(prompts)`: askSelect 二项「只用飞书直连 / 接 Jira」，回车默认前者 → 直接进飞书流；后者 → askSelect 三项变体（minimal/code-mr/grill-openspec）→ 进 Jira 流（现有六问+连接测试+可选飞书问答原样复用）。`--workflow` 显式传入时跳过首问（保持现状语义：指定即跳过选择）。
_否决_：保留四选一改序——变体黑话对非 Jira 用户是噪音；否决彻底不问——藏起 Jira 路径，可发现性为零。

### D3 凭据边采边验

`collectFeishuDirectConfig` 采完 app_id/app_secret 后调用 `testFeishuConnection(app_id, app_secret, fetchImpl)`（内部用 `FeishuSource` 的 token 端点逻辑，或直接 POST `auth/v3/tenant_access_token/internal`）：成功 → 打 ✓ 并进群帮选；失败 → 打印人话原因（secret 错 / 应用未发布版本 / 权限未开 / 网络不可达，按返回码区分）→ 重问 app_secret（app_id 保留）。**不阻断**：连续失败后允许"跳过验证继续"（与 testJiraConnection 的非阻断精神一致，离线环境可完成 init）。
_否决_：强制验证通过才放行——离线/内网受限环境会把 init 卡死；重问循环设上限后退出到"跳过验证"。

### D4 群列表帮选

连通成功后 `listChats()`（FeishuSource 现成）取机器人所在群 → askSelect（编号+群名，回车默认第 1 个）→ 写 `intake_chat_id`。列表为空 / API 失败 / 连通被跳过 → 回落 `ask` 手填 `oc_xxx`。
_依据_：Q2 对齐——消灭 `oc_xxx` 天书抄写这一最易错步骤；群来自机器人所在群列表，天然保证机器人在群内。

### D5 可选项目问答与 path_roots 收敛

飞河流末尾问「项目名（回车跳过）」：空 → `projects: {}`、`path_roots: []` 保持，完成提示加警告"path 模式当前不限制目录，建议配置 projects 或 path_roots"；非空 → 问「目录绝对路径」，`existsSync` + `realpathSync` 校验（不存在/不是目录则重问，回车空则放弃回到跳过态）→ 写 `feishu.direct.projects[name] = path` 且 `path_roots = [该路径]`。只问一个项目（多个手改配置，模板注释已说明）。
_否决_：循环录多项目——问答变长，违背简单主线；_否决_：跳过时也锁死 path_roots（如 `[]` 禁用 ad-hoc）——跳过者往往就是要用 `/chat /abs` 快速试，锁死会把唯一可用路径关掉。

### D6 body 缩两行与哨兵契约

feishu-direct 模板 body = 变体哨兵 + 语言哨兵（en）+ 两行用户语言 HTML 注释。**不含** Liquid 表达式、ADR 引用。`detectWorkflow`/`detectTemplateLanguage`/`--update` 漂移机器零改动（哨兵原位保留）。zh/en 的 Liquid 表达式集合两侧皆空，en-templates 对齐测试天然通过。
_否决_：body 全删——哨兵必须住在 body（`detectWorkflow` 只吃 `prompt_template`），删 body 要动探测契约三处机器，省两行不值。

### D7 变体改名 `default` → `minimal` 的机械面

- 旗标值/`SUPPORTED_WORKFLOWS`/`normalizeWorkflow` 取值表：`minimal` 取代 `default`
- 模板文件改名：`WORKFLOW.md.example` → `WORKFLOW.minimal.md.example`（zh/en 各一，git mv）
- `detectWorkflow` 无标记兜底：→ `minimal`
- `skillsForWorkflow`：minimal 分支 = 原 default 分支（不装技能）
- `--workflow` 帮助文本：取值清单与 `(default: feishu-direct)` 说明
- 不保留 `default` 别名（无存量用户）

### D8 完成提示分级

`printCompletionHint` 按变体分流：feishu-direct → "✅ 配置完成！运行 tasking start，然后在群里发 /chat <项目名> <消息>"（跳过项目时附 path 警告行）；Jira 三变体 → 现状四行手工字段提示原样。编辑器打开逻辑不分流。

### D9 文档换轨

`getting-started`（zh/en）重写：主线 = 5 分钟飞书直连路径（init 一路回车 → start → /chat → 常用命令速查），第二章"接 Jira"收编现有 grill-openspec 内容。README/README.zh-CN、usage、configuration 只做改名与默认值的机械同步。双语 parity 由 `tests/docs-links.test.ts` 强制。

## Risks / Trade-offs

- [凭据验证给 init 引入网络依赖] → 非阻断 + 失败重问 + 可跳过；`fetchImpl` 注入保持单测可离线 mock
- [群帮选选错群（机器人在多个群）] → 菜单展示群名，选择而非唯一解；选完在完成提示里回显群名
- [改名遗漏引用（`default` 字符串散落）] → 全仓 grep 清单化进 tasks（src/tests/assets/docs/README），en-templates PAIRS 与 init 测试逐条跟随
- [两前置 change 未归档，delta 叠写] → 本变更 delta 按目标态书写；归档顺序由 openspec 流程保证一致性，冲突在归档时显式暴露
- [语言问答保留多一次回车] → 接受（Q7 决策），换取交互/非交互行为自洽

## Migration Plan

无存量用户：无迁移。真机验收（final-only）：空目录 `tasking init`（真凭据一路回车）→ `tasking start` → 群内 `/chat <项目名> <消息>` 跑通一轮；抽查 `tasking init --workflow minimal --non-interactive` 产物。回滚 = revert 单个变更。

## Open Questions

无——Q1–Q10 已在提案前逐题对齐闭环。
