# Tasks: feishu-first-onboarding

前置：proposal/design/specs 已读；无存量用户约束（破坏免费，不留兼容层）。所有测试任务先写失败测试（红）再实现（绿）。

## 1. 变体改名 default → minimal

- [x] 1.1 模板改名与映射（写失败测试先：`--workflow minimal --non-interactive` 产物为最小模板；`--workflow default` 报错且错误信息列出四个支持值；无标记 body `detectWorkflow` 返回 `minimal`；然后 `git mv` 两份 `WORKFLOW[.en].md.example` → `WORKFLOW.minimal[.en].md.example`，改 `resolveExampleFile`/`normalizeWorkflow`/`SUPPORTED_WORKFLOWS`/`skillsForWorkflow`/`detectWorkflow` 兜底）
- [x] 1.2 en-templates PAIRS 与帮助文本跟随（写失败测试先：`tests/en-templates.test.ts` PAIRS 指向 minimal 文件名仍全绿；`tasking init --help` 的 `--workflow` 行含 `feishu-direct (default: feishu-direct)`；然后更新 PAIRS 与 `src/cli/help.ts`）

## 2. 默认变体翻转与任务来源首问

- [x] 2.1 裸 init 默认 feishu-direct（写失败测试先：非交互裸 `tasking init` 产物 `tracker.kind: none`；交互式未指定 `--workflow` 时首问为任务来源二选一、回车后全程不出现 Jira 问答与变体名；然后实现 `normalizeWorkflow(undefined) → feishu-direct` 与新 `selectTaskSource`）
- [x] 2.2 接 Jira 分支追问变体（写失败测试先：任务来源选"接 Jira"后追问 minimal/code-mr/grill-openspec 三选一，随后进入现有 Jira 凭据问答与连接测试；然后实现变体追问并复用现有 Jira 流程）
- [x] 2.3 `--workflow` 显式优先（写失败测试先：`--workflow code-mr` 交互式不出现任务来源问答直接进 Jira 流；然后接线跳过逻辑）

## 3. 飞书凭据验证与群帮选

- [x] 3.1 连通验证与失败重输（写失败测试先：mock token 端点——成功打印确认；凭据错打印人话原因并重问 app_secret（app_id 保留）；连续失败达上限提供"跳过验证继续"，init 仍完成且写入所填值；然后实现 `testFeishuConnection` 并接入飞河流程）
- [x] 3.2 intake 群编号帮选（写失败测试先：验证成功且群列表非空 → askSelect 列群名、回车默认第一项、写入 `intake_chat_id`；列表为空或接口失败或验证被跳过 → 回落手填问答；然后接 `listChats` 实现）

## 4. 可选项目问答与 path_roots 收敛

- [x] 4.1 项目采集与收敛（写失败测试先：填项目名+存在目录 → WORKFLOW.md 含 `projects` 条目与 `path_roots: [该路径]`；目录不存在 → 提示并重问；项目名回车跳过 → `projects: {}`、`path_roots: []`；然后实现采集问答与 `generateWorkflowContent` 扩展）

## 5. feishu-direct 模板说明性 body

- [x] 5.1 body 缩两行（写失败测试先：feishu-direct zh/en 模板 body 无 Liquid 表达式、zh 首行变体哨兵、en 首行语言哨兵、说明为用户语言且不含 "ADR" 字样；`--update` 对含哨兵 WORKFLOW.md 探测为 feishu-direct；然后重写两份模板 body）

## 6. 按变体分级的完成提示

- [x] 6.1 分级提示（写失败测试先：feishu-direct 完成输出含 `tasking start` 与 `/chat` 示例命令；跳过项目问答时含 path 不限制警告行；接 Jira 分支维持 active_states 等四字段提示；然后改 `printCompletionHint` 按变体分流）

## 7. 文档换轨

- [x] 7.1 getting-started 双语重写（主线 = 5 分钟飞书直连：init 一路回车 → start → /chat → 常用命令速查；第二章"接 Jira"收编现有 grill-openspec 教程内容；`tests/docs-links.test.ts` 保绿）
- [x] 7.2 机械同步（README/README.zh-CN 变体清单与默认值、`docs/{zh,en}/usage.md`、`docs/{zh,en}/configuration.md` 的 `default` → `minimal` 与默认变体说明）

## 8. 决策记录与收尾

- [x] 8.1 写 `docs/adr/0027-feishu-first-onboarding.md`（默认门面翻转 + minimal 改名 + body 缩为说明的取舍与被否决项）
- [x] 8.2 门禁：lint / typecheck / `npm test` / `npm run test:e2e` 全绿；全仓 grep `--workflow default` 与旧文件名确认零残留
- [ ] 8.3 真机 final-only 冒烟：空目录 `tasking init`（真凭据、一路回车）→ `tasking start` → 群内 `/chat <项目名> <消息>` 跑通一轮；抽查 `tasking init --workflow minimal --non-interactive` 产物
