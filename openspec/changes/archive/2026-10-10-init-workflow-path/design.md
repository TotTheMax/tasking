## Context

`tasking start` 已通过位置参数 `[workflow-path]` 接受任意位置的 `WORKFLOW.md`（`src/cli/index.ts:170`），并把它所在目录作为关联产物的基准（`.opencode/`、dotenv）。但 `tasking init`（`src/cli/index.ts:99`，位置参数被丢弃且写死 `join(cwd,"WORKFLOW.md")`）与 `tasking doctor`（`src/cli/doctor.ts:63`，写死 `cwd/WORKFLOW.md`）只认 cwd。结果是同一部署"能运行于自定义路径、却不能在同一路径初始化/升级/体检"。

本变更把三条命令的路径语义收敛到一个概念：**workflow path**（见 `CONTEXT.md`）——某条命令操作的 `WORKFLOW.md` 路径，其所在目录是 `.opencode/skills/`、`.tasking/`、`.bak` 的基准。

## Goals / Non-Goals

**Goals:**

- `init`（生成 / `--update` / `--restore`）与 `doctor` 接受 `[workflow-path]`，缺省 `./WORKFLOW.md`，相对 cwd 解析——与 `start` 语义完全一致。
- 关联产物（skills、漂移参考副本、备份）跟随 `dirname(workflow path)`。
- `start` / `init` / `doctor` 共用一处路径解析逻辑，杜绝再次分叉。

**Non-Goals:**

- 不改 `start` 的现有行为（已支持位置参数）。
- 不引入"传目录自动补 `WORKFLOW.md`"的糖。
- 不改 `--workflow`（变体）/ `--lang` 的语义。
- 不把概念性文案里的"WORKFLOW.md"全部参数化；不动 `config schema`。

## Decisions

1. **位置参数，而非 flag。** `start` 已是位置参数；`init` 已有 `--workflow <name>`（变体），再加 `--workflow-path` flag 易混淆。位置参数与 `start` help 平行，且 `init` 本就 `allowPositionals: true`（`src/cli/index.ts:109`），不破坏现状。
2. **三种模式全支持（生成 / `--update` / `--restore`）。** 位置参数只表达"目标 workflow 文件"一个概念；否则会出现"能 `--update` 自定义路径、却不能生成到自定义路径"的割裂。
3. **纯文件路径，不做目录糖。** 与 `start` 一字不差；传目录视为错误。目录推导是 `start` 没有的行为，会造成语义分叉。
4. **生成模式递归创建父目录。** `init` 是脚手架命令，且生成路径下本就会 `mkdirSync(...,{recursive:true})` 建 `.opencode/skills/`、`.tasking/`，把配置自身所在目录一并建出更一致。`--update` / `--restore` 仍要求目标已存在。
5. **关联产物跟随 `dirname(workflow path)`，漂移参考名改 `<basename>.reference`。** 保持既有"init 目录 = 配置文件所在目录"语义，只把写死的 `WORKFLOW.md` 换成 `basename`；避免自定义文件名时 `.tasking/` 出现与目标不符的 `WORKFLOW.md.reference`。
6. **`doctor` 一并纳入。** 用户选择彻底对齐；`doctor` 接受同一位置参数，且 dotenv 从 `dirname(path)` 加载（对齐 `start` 的 `loadDotenvIfPresent(dirname(workflowPath))`）。
7. **文案只改"指向具体目标文件"的处。** 概念性文案（`--force` 说明、喂 sentinel markers、edit WORKFLOW.md、feishu 提示）保持原样，控制改动面与翻译字典风险。
8. **抽 `resolveWorkflowPath(cwd, positional)` 共享 helper**（含关联目录派生），`start` / `init` / `doctor` 调用；`runInit(dir, opts)`、`runDoctor(cwd, deps)` 签名保持向后兼容（新增可选路径参数），旧测试零改动。

**Alternatives considered:** flag `--path`（否决：命名混淆）；仅 `--update` 支持（否决：语义割裂）；目录糖（否决：与 `start` 分叉）；skills 恒在 cwd（否决：与"配置与产物同行"的部署直觉冲突，且 `start` 已按配置目录运行）。

## Risks / Trade-offs

- **[关联产物位置成为用户可见契约]** → 以 ADR 0033 固化；文档写明"路径决定配置与产物同置"，未来改动需走破坏性变更流程。
- **[生成时误建目录（路径 typo）]** → 仅创建用户显式给出的路径的父目录，符合脚手架命令直觉；不做通配或推断。
- **[概念性文案残留 "WORKFLOW.md" 在自定义文件名下略显突兀]** → 接受；不打断点式文案的稳定性与翻译。
- **[变更目录命名]** → 仓库惯例是活动变更用不含日期的 kebab-case 名，日期前缀由 `opsx-archive` 在归档时按 `YYYY-MM-DD-<name>` 生成（见 `.opencode/commands/opsx-archive.md`）。故本变更目录为 `openspec/changes/init-workflow-path`，归档时成为 `archive/2026-10-09-init-workflow-path`。
