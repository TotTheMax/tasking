# Design: init-output-quality

## Context

- 约束延续：无存量用户，破坏性变更免费；目标是「简单用上」与「生成物一眼看清是我配了什么」
- 现状：交互路径 `generateWorkflowContent` 在模板上做活行替换；非交互路径 `runNonInteractiveInit` **字节复制**模板。模板顶层段：`tracker / polling / workspace / hooks / agent / opencode / router / feishu / server / logging / env`
- 事实：`router` 无运行时消费方（仅 resolver/config-view 解析）；feishu 的 `verification_token`/`encrypt_key` 是 webhook 预留；`fetchProjectStatuses()` 已返回状态名数组且 init 已调用
- 前序决策（Q9/上轮讨论）：模板保持 canonical 全活参照；**生成物向下注释**（不是模板全注释向上解注释）；漂移检测/语言对齐测试以模板为基准

## Goals / Non-Goals

**Goals**：生成的 WORKFLOW.md 只把必填/已采集/非默认的段保持 active，其余整段注释（默认值可见）；死配置收口；Jira 路径消灭「改状态名」这一必改项；交互与非交互产物风格一致。

**Non-Goals**：`router` 的运行时实现；模板转全注释风格（sshd 式，已否决）；改变 config schema 或 DEFAULTS；为生成物引入第二份「骨架」真相。

## Decisions

### D1 模板保持 canonical，生成侧「向下注释」

模板仍为全量 active YAML（`router`/webhook 除外，见 D5），继续充当漂移检测、语言对齐与 DEFAULTS 覆盖测试的基准。生成时把**非 active 的顶层段**整段加 `# ` 前缀。注释操作是纯前缀（不需理解行内容），失配风险远低于「从注释解出 YAML」（大档已否决）。
_否决_：模板全注释 + 生成解注释（注释重建脆弱、模板失去可 parse 基准）；从代码序列化 frontmatter（模板/骨架两份真相互相漂移）。

### D2 变体的 active 段集合

- `feishu-direct`：`tracker`（沿用现状：kind none 活 + jira 字段已注释）、`feishu`（含 `direct`）；其余段注释（无 hooks——直连会话不走工作区钩子；无 env——GITLAB 仅供 MR）
- `minimal`：`tracker`、`hooks`（`after_create` 是完成本任务的必需项）、`feishu`（启用时才 active）；`polling`/`workspace`/`agent`/`opencode`/`env`/`server`/`logging` 注释
- `code-mr` / `grill-openspec`：`tracker`、`hooks`、`env`（GITLAB token/host）、`feishu`（启用时）；其余注释
- 未启用的 `feishu` 段：只保 `enabled: false` 一行 active，段内其余行注释（段内二次处理，规则见 D4）

### D3 非交互也走生成路径

`runNonInteractiveInit` 不再字节复制：以空凭证走 `generateWorkflowContent` + 同一分段策略，得到「未填凭证的占位值 + 可选段注释」的产物。两条路径共用同一实现，风格一致。
**BREAKING**：脚本若 diff 生成物与模板会不同。
_否决_：非交互保留字节复制——同样的文件两种长相，且新手最可能用非交互/CI 首跑。

### D4 分段机制（锚定顶层键）

frontmatter 区域内按 `^[a-z_]+:` 行切成顶层段（banner 注释块随其**前一段**输出；生成器只在段内做行级 `# ` 前缀）；非 active 段的每个 YAML 行按原缩进插入 `# `（已是注释的行原样保留），并在该段键行前插入一行可本地化的 `# —— 可选：以下为默认值，改动才解注释 ——` / `# —— optional: defaults below; uncomment only to change ——`；active 段原样保留。`feishu` 段内未启用时，仅 `enabled:` 行保持 active，其余行按同法注释。
**护栏**：单测断言「切段得到的顶层键集合 == 该变体的期望集合」，模板新增段而生成器未跟进时测试变红，避免新段静默落错桶。

### D5 死配置在模板中收口

`router` 整段注释 + `# 未实现：当前仅解析，无运行时代码`；feishu 的 `verification_token`/`encrypt_key` 注释（已是预留说明）。代价：parse 模板得到的 config 不再含 router 键 → 漂移报告不会把它们列为「新增字段」。可接受（死配置本就不该被推荐配置）。

### D6 Jira 状态预填（映射 + 确认）

`fetchProjectStatuses()` 返回的状态名按常见中英文映射分桶（大小写与首尾空白不敏感）：

| 桶 | 常见名（示例表，实现为可测常量） |
|----|----------------------------------|
| active | 待办 / to do / 处理中 / 进行中 / in progress / 合并中 / merging / 重置处理 / reset |
| review | 代码评审中 / 评审中 / in review / review / 待评审 |
| terminal | 完成 / done / 关闭 / closed / 取消 / cancelled / canceled / 重复 / duplicate / resolved |

未匹配的状态名忽略并在汇总里列出（让用户知道没被采用）。`active` 与 `terminal` 两类非空时打印提议并 `askSelect`「确认写入（回车）/ 保持默认」（`review` 允许为空 → `review_state: null`）；未匹配的状态名始终在提议或回落信息中列出。确认后写入 `active_states`/`terminal_states`/`review_state`（review 取首个匹配名，无匹配则 `null`）。`active`/`terminal` 任一为空、或用户选择保持默认、或连接测试失败 → 回落到模板默认值。
_否决_：无条件自动写入（状态工作流千差万别，静默写错更难查）；不预填（必改项继续存在）。

### D7 完成提示跟随预填结果

Jira 变体：预填成功 → 手工字段清单里去掉 `active_states`/`terminal_states`/`review_state`，仅留 `after_create` 与（MR 变体的）`env.GITLAB_*`；预填跳过/失败 → 维持现有四字段清单。feishu-direct 分支不变。

### D8 漂移报告措辞对齐

`--update` 报告里「模板有而用户文件缺」的键，措辞改为「走 DEFAULTS 默认值（可选段在生成文件中注释/省略）」。检测逻辑与 `.tasking/WORKFLOW.md.reference` 机制不变。

### D9 决策记录

新增 `docs/adr/0028-generated-config-trimming.md`：记录「生成物向下注释、模板 canonical」的策略取舍与被否决项（sshd 式模板、代码序列化骨架、router 运行时实现延后）。

## Risks / Trade-offs

- [用户想改某可选参数却找不到] → 注释态行内保留默认值与说明，段头写明「改动才解注释」
- [模板新增顶层段落入错误桶] → D4 护栏测试（切段键集合断言）
- [中文状态名千奇百怪、映射漏] → 确认步骤 + 未匹配清单；不确认即回落默认，不静默写错
- [`--update` 对精简文件报一堆「缺失字段」] → D8 改述为默认值语义；现有测试文案需跟随
- [非交互产物不再是模板副本] → BREAKING 已在 proposal 标注；测试改为性质断言

## Migration Plan

无存量用户，无迁移。验收（final-only）：空目录 `tasking init`（feishu-direct 与接 Jira 两条路径各一遍）核对产物：只活跃必需段、注释段带默认值、Jira 状态已预填；`--workflow minimal --non-interactive` 抽查。回滚 = revert 单个变更。

## Open Questions

无。
