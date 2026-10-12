# Tasks: init-output-quality

前置：proposal/design/specs 已读；无存量用户约束。测试任务一律先写失败测试（红）再实现（绿）。

## 1. 生成物分段裁剪

- [x] 1.1 分段裁剪核心（写失败测试先：feishu-direct 生成物中 `tracker:`/`feishu:` 为活配置，`polling`/`workspace`/`hooks`/`agent`/`opencode`/`env`/`server`/`logging` 整段为注释且段首带「可选」提示、注释行保留模板原文与默认值；然后实现「按顶层键切段 + 非活跃段加 `# ` 前缀 + 段首提示」并接入 `generateWorkflowContent`）
- [x] 1.2 变体 active 集合与未启用 feishu 段（写失败测试先：minimal 活 `tracker`/`hooks`/`feishu`、code-mr 与 grill-openspec 额外活 `env`；未启用飞书时 `feishu:` 段仅 `enabled: false` 为活行；然后实现按变体的集合与段内二次处理）
- [x] 1.3 分段护栏（写失败测试先：断言「切段顶层键集合 == 该变体期望集合」，模板新增段而生成器未跟进时失败；然后导出期望集合常量并接线测试）
- [x] 1.4 非交互走生成路径（写失败测试先：`tasking init --non-interactive` 产物为「必需段 active（占位凭证）+ 可选段注释」而非模板逐字节副本；然后改 `runNonInteractiveInit` 复用生成实现）

## 2. 死配置收敛

- [x] 2.1 模板注释化（写失败测试先：解析任一 starter 模板 frontmatter 不含 `router` 键且注释含「未实现」；`feishu.verification_token`/`encrypt_key` 为注释且含「预留」；en-templates 语言对齐与 DEFAULTS 覆盖测试仍绿；然后改 8 份模板）
- [x] 2.2 生成物死块断言（写失败测试先：任意变体生成物 `router:` 段全为注释且含「未实现」、feishu webhook 两行为注释；然后确认随生成路径自动生效，仅补测试锚定）

## 3. Jira 状态预填

- [x] 3.1 状态名映射分桶（写失败测试先：单元断言常见中英文名分入 active/review/terminal 三桶、大小写与空白不敏感、未匹配名进「未采用」清单；然后实现映射常量与分类函数）
- [x] 3.2 确认与预填（写失败测试先：三类桶非空 → 打印提议并回车确认 → 生成物 `active_states`/`terminal_states`/`review_state` 为映射结果；用户拒绝 / 任一类为空 / 连接失败 → 回落模板默认；然后接入 Jira 流程与 `generateWorkflowContent`）
- [x] 3.3 完成提示跟随（写失败测试先：预填成功时完成提示的手工字段清单不含状态三项；未预填时含四项；然后改 `printCompletionHint` 入参）

## 4. 漂移报告措辞

- [x] 4.1 默认值语义（写失败测试先：`--update` 对缺失可选键的报告含「默认值/走 DEFAULTS」措辞且不再暗示必须补齐；然后改 `reportWorkflowDrift` 文案）

## 5. 文档与收尾

- [x] 5.1 文档同步（`docs/{zh,en}/usage.md` 生成物风格说明；`configuration.md` 标注 `router` 未实现 + 可选段注释语义；`getting-started` Jira 章节不再要求手改状态名；双语 parity 保绿）
- [x] 5.2 写 `docs/adr/0028-generated-config-trimming.md`（向下注释策略 + 模板 canonical 的取舍与被否决项）
- [ ] 5.3 门禁：lint / typecheck / `npm test` / `npm run test:e2e` 全绿；真机 final-only 冒烟：空目录 `tasking init` 核对产物（feishu-direct 与接 Jira 各一遍、注释段带默认值、Jira 状态已预填）
