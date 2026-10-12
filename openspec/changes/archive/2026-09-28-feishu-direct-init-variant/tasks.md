# Tasks: feishu-direct-init-variant

前置依赖：Change ① `feishu-direct-source-switch` 已实现（`tracker.kind: none` 语义存在）。

## 1. 模板

- [x] 1.1 新增 `assets/workflows/WORKFLOW.feishu-direct.md.example`（写校验测试先：front matter 解析出 `tracker.kind: none`、`feishu.enabled: true`、direct 空配置合法、哨兵存在、agents catalog 合规、`DEFAULTS.feishu` 键覆盖；然后编写模板——tracker 块全量 Jira 注释 + 切换说明、feishu 块完整文档化、default 最小 body + 说明注释）
- [x] 1.2 新增 `.en.` 版（写校验测试先：与 zh 版 Liquid 表达式对齐、语言哨兵存在；然后编写英文版）

## 2. init 机制

- [x] 2.1 变体枚举与模板映射（写失败测试先：`--workflow feishu-direct --nonInteractive` 字节一致写入、`--lang en` 同理、未知变体报错列四值；然后实现 `WorkflowVariant`/`SUPPORTED_WORKFLOWS`/`resolveExampleFile`/`normalizeWorkflow` 扩展）
- [x] 2.2 `detectWorkflow` 四路探测（写失败测试先：含 feishu-direct 哨兵 + default body 的内容判定为 `feishu-direct`；然后实现哨兵最优先探测）
- [x] 2.3 技能集（写失败测试先：feishu-direct init 后 `.opencode/skills` 无 tasking 技能、`--update` 无技能同步动作；然后实现 `skillsForWorkflow` 返回空数组）

## 3. 交互流

- [x] 3.1 workflow 选择问答扩四项 + 简述（写失败测试先：promptInterface 模拟选择 feishu-direct；然后实现选项与简述）
- [x] 3.2 feishu-direct 问答裁剪（写失败测试先：凭据阶段不出现 Jira 问答与连接测试、不出现 Enable-Feishu 选择、issue types 不问、glab 检查跳过、app_id/secret/intake 三问写入配置；然后实现分支裁剪）

## 4. 文档与收尾

- [x] 4.1 双语文档同步：`docs/{zh,en}/configuration.md` 变体表 + 语言表加 feishu-direct 行（含"唯一以配置区分"注记）、`docs/{zh,en}/usage.md`、`docs/{zh,en}/getting-started`、`README.md`/`README.zh-CN.md` 变体清单
- [x] 4.2 门禁：lint/typecheck/`npm test` 全绿（en-templates PAIRS 四对、prompt、init、docs-links 全部通过）；手动冒烟 `npm run dev -- init --workflow feishu-direct --nonInteractive` 于临时目录核对产物
