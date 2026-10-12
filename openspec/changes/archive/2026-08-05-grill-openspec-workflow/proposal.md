## Why

`tasking` 当前只有一个 workflow（默认），agent 一上来就转"处理中"写代码建 MR，没有"先和人就计划达成共识"的阶段。复杂任务计划方向错了要等 MR review 才暴露，返工成本高。需要一种新 workflow 变体 `grill-openspec`：先拷问（和人就决策达成共识）→ 再 propose+implement 建 MR → 合并后归档 openspec change，把"对齐计划"前置。

## What Changes

- 新增 workflow 变体 `grill-openspec`，通过 `tasking init --workflow grill-openspec` 选用；默认（`--workflow default` 或省略）保持现有行为不变
- 新增模板文件 `WORKFLOW.grill-openspec.md.example`（与 `WORKFLOW.md.example` 同 config schema，只 prompt body 不同）；其 prompt body 编码四阶段路由：grill（拷问+发 Jira comment+转 review，不建 MR）→ 实施（propose-with-tdd+implement+建 MR+转 review）→ 合并（land 合 MR+openspec-archive-change+转 terminal），以及运行中升级通道（任何阶段遇 truly blocking 决策可发 comment 转 review）
- 阶段路由全部在 prompt body 内由 agent 自判（产物为主 + 状态语义 + Jira comments/glab 兜底），不写字面量状态名（用 `{{ active_states }}`/`{{ review_state }}`/`{{ terminal_states }}`），不引入新模板变量、不改运行时代码
- `tasking init` 加 `--workflow <name>` 选项；交互式 init 多问一题选 workflow
- 4 个技能（`opsx-grill-with-docs`/`opsx-propose-with-tdd`/`opsx-implement`/`openspec-archive-change`）由 `tasking init` 从 `assets/skills/` 装进目标仓库的 `.opencode/skills/`：`default` 仅装 `land`，`grill-openspec` 装 `land` + 4 个 opsx（共 5 个）。`openspec-archive-change` 的 `SKILL.md` 纳入 `assets/skills/` 随包发布。运行时 daemon 不每工作区拷贝技能（工作区靠 `after_create` 克隆目标仓库获得）
- 返工路径不重新 grill：增量修复（MR 还在）同分支改；全量重置关旧 MR、新分支、按现有 openspec change 重新 implement
- 拷问未答的题默认走 agent 推荐答案（标注），truly blocking 才升级重发那一题

## Capabilities

### New Capabilities

- `grill-openspec-workflow`: grill-openspec 变体的模板与 prompt body 行为——四阶段路由、拷问 comment 标记头、运行中升级、不硬编码状态名、只用现有模板变量、返工不重新 grill、未答走推荐

### Modified Capabilities

- `cli-runtime`: `init 生成工作流骨架` 需求增加 `--workflow` 选项（模板选择，默认 `default`）
- `interactive-init`: 交互式 init 增加 workflow 选择问答（已指定 `--workflow` 时跳过）

## Impact

- 新增 `WORKFLOW.grill-openspec.md.example`（模板文件）
- `src/cli/init.ts`：`InitOptions` 加 `workflow` 字段；`runInit` 按 `--workflow` 选模板；非交互式按 flag 选；交互式多问一题
- `src/cli/index.ts`：`init` 子命令解析 `--workflow` 并传入
- 新增 `docs/adr/0001-phase-routing-in-prompt.md`、`CONTEXT.md`、`docs/known-issues.md`（本提案阶段已写）
- 同步 `docs/state-flow.md`（加 grill-openspec 流转）、`docs/configuration.md`（`--workflow` 选项）、`docs/usage.md`（用法示例与技能提交说明）
- 不改：`src/worker/prompt.ts`/`src/scheduler/scheduler.ts`/`src/worker/runner.ts`/`src/config/config-types.ts`/`src/mcp/`
- 已知代价：turn 2+ 的 `buildContinuationGuidance`（MR 中心、全局共享）在 grill 阶段略偏（记 `docs/known-issues.md`）
