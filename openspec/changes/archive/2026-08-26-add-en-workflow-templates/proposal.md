## Why

TAS-19: 现有三个 workflow 入门模板（default / code-mr / grill-openspec）均为中文注释版，非中文用户无法顺畅上手。需要新增纯英文模板，同时保持现有中文模板内容逐字节不变（成为正式的 zh 版），并让 `tasking init` / `init --update` 能选择与识别模板语言（产品已确认按 grill 推荐方案执行：独立 `--lang <zh|en>` 选项、默认 zh、英文模板加语言哨兵注释）。

## What Changes

- 新增 3 个英文 starter 模板：`WORKFLOW.en.md.example`、`WORKFLOW.code-mr.en.md.example`、`WORKFLOW.grill-openspec.en.md.example`——YAML 注释与 prompt 正文的中文说明句全部英译；协议性哨兵（`<!-- tasking-workflow: code-mr -->`、`## 🔍 拷问 / Grill Questions`）、YAML key、Liquid 语法逐字节不译；状态名占位值保留原样并加英文注释提示需按实际 Jira 调整。每个英文模板顶部带哨兵注释 `<!-- tasking-workflow-lang: en -->`。
- 现有 3 个中文模板内容不动，正式定位为 zh 版。
- `tasking init` 新增 `--lang <zh|en>` 选项，与 `--workflow <name>` 正交组合（3 变体 × 2 语言）；skills 安装集合仍只由 workflow variant 决定。未指定时默认 `zh`；非法值报错并列出支持值。
- 交互式 init 在未指定 `--lang` 时弹出「Template language」选择框引导（中文在前，回车即中文）；已指定时跳过该问答。
- 非交互式 init 未指定 `--lang` 时静默使用 zh 模板（与现状完全向后兼容）。
- `tasking init --update` 的漂移报告改为对同语言模板比对：按用户 WORKFLOW.md 是否含 `<!-- tasking-workflow-lang: en -->` 哨兵识别语言（有 = en，无 = zh），显式 `--lang` 可覆盖探测。
- package.json `files` 增加 3 个新模板文件；help.ts（CLI help 单一来源）、README、docs/usage.md 与 docs/configuration.md 双语页同步更新。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `cli-runtime`: 「init 生成工作流骨架」需求扩展——新增 `--lang <zh|en>` 选项语义、默认 zh、非法值报错、6 种 变体×语言 组合的模板文件映射。
- `interactive-init`: 「workflow 选择问答」旁新增「Template language 选择问答」需求——未指定 `--lang` 且 TTY 时询问，已指定时跳过。
- `init-update`: 「--update 不写 WORKFLOW.md 只报告漂移」需求扩展——漂移报告模板按语言哨兵探测选取（en 哨兵 → 英文模板，否则中文模板），显式 `--lang` 覆盖探测。

## Impact

- **代码**：`src/cli/init.ts`（语言类型/解析/模板路径/检测/交互问答/输出行）、`src/cli/index.ts`（init 子命令 parseArgs 增加 `--lang`）、`src/cli/help.ts`（usage + options 行）。
- **资产**：仓库根新增 3 个 `.md.example` 文件；`package.json` `files` 数组 +3。
- **测试**：`tests/init.test.ts`（语言选项、默认值、交互问答、--update 语言识别与覆盖）、可能涉及 `tests/skills.test.ts`、`tests/docs-links.test.ts` 保持绿。
- **文档**：README、docs/{usage,configuration}.md 双语页同步；CONTEXT.md 术语表新增「Template language」、`docs/adr/0013-template-language-axis.md` 记录决策（grill 阶段产出）。
- **兼容性**：无破坏——不传 `--lang` 行为与现状逐字节一致（zh 默认）；中文模板零改动。
