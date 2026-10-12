## Context

tasking 当前 prompt 模板（`WORKFLOW.md.example`）让 agent 一上来就转"处理中"写代码建 MR。复杂任务计划方向错了要等 MR review 才暴露，返工重。grill-openspec 变体把"和人就计划/决策达成共识"前置：先跑 `opsx-grill-with-docs` 拷问，把待定决策合并成一条 Jira comment 转 review 等人答，答完再 propose+implement 建 MR。运行时（scheduler/runner/prompt 渲染）已稳定，不想为变体动运行时。

## Goals / Non-Goals

**Goals:**

- 新增 `grill-openspec` 变体，纯模板 + init 选项落地，运行时零改动
- prompt body 自包含四阶段路由 + 升级通道，跨 Jira 实例不硬编码状态名
- 默认 workflow 行为完全不变

**Non-Goals:**

- 不改运行时（scheduler/runner/prompt.ts/config-types/MCP）
- 不让 daemon 拷技能进工作区（技能由目标仓库提交）
- 不持久化 openspec change 跨工作区（靠 MR 让上游留存；opsx-archive 仅工作区收尾）
- 不重新 grill 返工路径（增量修复/全量重置都按现有计划重做）

## Decisions

1. **阶段路由放 prompt body，不放运行时代码**（见 `docs/adr/0001-phase-routing-in-prompt.md`）。agent 每次派发自判阶段：产物为主（有无 CONTEXT.md/拷问 comment/openspec change/MR）+ 状态语义（合并中/重置处理）+ 兜底（Jira comments、glab MR 审批状态）。不引入新模板变量（`prompt.ts` 的 strict Liquid 对未知变量抛错，加变量有摩擦）。

2. **四阶段 + 两 review 暂停 + 升级通道**。grill（初始 active）→ review（人答）→ 实施（active）→ review（人 review MR）→ 合并（active）→ terminal。任何阶段遇 truly blocking 决策可发拷问 comment 转 review（复用 grill 通道）。

3. **不硬编码状态名**。prompt 只用 `{{ active_states }}`/`{{ review_state }}`/`{{ terminal_states }}`（注入的实例值）+ 角色描述。合 MR 信号：状态语义明确表示"合并中"→ 合；不明 → 查 glab MR 审批状态（approved→合，未 approve+反馈→增量修复）。

4. **技能由 `tasking init` 装进目标仓库**。`tasking init` 在目标仓库（即 `after_create` 克隆的那个仓库，用户在该仓库内跑 init）的 `.opencode/skills/` 安装技能：`default` 装 `land`；`grill-openspec` 装 `land` + 4 个 opsx 技能（`opsx-grill-with-docs`/`opsx-propose-with-tdd`/`opsx-implement`/`openspec-archive-change`）。技能源在 `assets/skills/`（`openspec-archive-change` 已纳入，随包发布）。运行时 daemon **不**每工作区拷贝技能——工作区靠 `after_create` 克隆目标仓库获得技能。

5. **opsx-archive = 工作区收尾**。合并阶段 agent 跑 land 合 MR + openspec-archive-change（归档工作区内 openspec change）→ 转 terminal → 调度器删工作区。openspec change 的长期留存靠 implement 阶段提交进 feature 分支、MR 合并进上游。

6. **拷问未答默认走推荐**。grill 技能要求每题带推荐答案；人未答的题 agent 采用自己推荐（comment 标注"未答采用推荐"）继续；truly blocking 才升级重发那一题。

7. **返工不重新 grill**。增量修复（MR 还在）同分支改；全量重置（重置处理语义）关旧 MR、新分支、按现有 openspec change 重新 implement。计划 survives，只丢代码/MR。

8. **拷问 comment 固定标记头** `## 🔍 拷问 / Grill Questions`。agent 重派时据此识别自己的拷问 comment，捞人答。

## Risks / Trade-offs

- **[续轮指引 MR 中心偏移]** turn 2+ 的 `buildContinuationGuidance` 全局共享且 MR 中心，grill 阶段（无 MR）跑到 turn 2 会收到略偏提示。→ grill 通常 turn 1 发完 comment 转 review 退出，实战影响小；彻底修需改 `prompt.ts`（越界），记 `docs/known-issues.md`。
- **[agent 自判阶段可靠性]** 阶段判定靠 agent 读产物/comments，无运行时强制。→ prompt 给明确判定步骤 + 标记头让 agent 可靠识别自己的拷问 comment；不确定就查 Jira comments、仍不确定就升级。
- **[技能交付依赖目标仓库]** 若目标仓库没提交 4 个技能，agent 读不到。→ 模板注释说明技能清单与提交位置；init 不补救（设计如此）。
- **[opsx-archive 不持久化]** 工作区删了 archive 结果也没了。→ 靠 MR 留存 change 记录，archive 仅收尾，已记 Non-Goal。
