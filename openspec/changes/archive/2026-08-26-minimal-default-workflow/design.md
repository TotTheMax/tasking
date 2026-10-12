## Context

`tasking init` 目前通过 `--workflow` 在两个变体间选 starter 模板（`src/cli/init.ts`）：`default`（`WORKFLOW.md.example`，全 MR 流程）与 `grill-openspec`（`WORKFLOW.grill-openspec.md.example`）。两模板共用同一 config schema，仅 prompt body 不同（ADR 0001 确立的"运行时零改动"原则：新变体＝一个模板文件 ＋ 一个 `init --workflow` 选项，不动 scheduler/runner/prompt 渲染器/config schema）。`detectWorkflow`（`init.ts:218`）用 prompt body 里的 grill 标记 `## 🔍 拷问 / Grill Questions` 区分 grill-openspec 与 default，供 `--update` 漂移报告选模板；`syncAllSkills`（`init.ts:287`）硬编码同步 `skillsForWorkflow("grill-openspec")` 的全量 6 个技能。

TAS-15 的目标：现有 `default`（全 MR）非最小，应改名为非默认变体；新增一个真正的最小 `default`——在工作目录完成任务 → 上传结果到 Jira → 转 active→terminal，无 git 分支/MR/glab、无 review 暂停、不装技能。已与人确认的决策：①改名 `code-mr`；②最小 default 形态（流程/review_state null/不装技能/frontmatter）；③给新模板加哨兵标记做三路探测（为后续用户优化），但不为少数老体验用户做遗留启发式（老文件落 default 兜底，可用 `--workflow code-mr` 显式覆盖）。

## Goals / Non-Goals

**Goals:**
- `--workflow default` 指最小 workflow（工作目录做事 → 上传 Jira → 转终态），不装技能、无 review。
- 新变体 `code-mr` 承接原全-MR 行为（模板 `WORKFLOW.code-mr.md.example`），装 `land`+`install-glab`。
- `detectWorkflow` 三路标记探测，使 `--update` 对新 `code-mr` 用户选对模板。
- `syncAllSkills` 按探测变体同步技能集，避免最小 default 用户被塞全量技能。
- 守 ADR 0001：不改 config schema、不动 scheduler/runner/prompt 渲染器。

**Non-Goals:**
- 不为少数老体验用户做遗留启发式探测（老全-MR 文件无标记 → 落 default → 伪 diff，`--workflow code-mr` 显式覆盖）。
- 不改 `grill-openspec` 模板内容与探测（保持其 grill 标记不变，零回归）。
- 不改 config schema（`review_state` 仍 `string | null`，最小 default 用 `null`）。
- 不动 `WORKFLOW.md`（仓库自用）与 `WORKFLOW-test.md`（测试夹具）。

## Decisions

1. **`code-mr` 作为第三变体，文件 `WORKFLOW.code-mr.md.example`**：与 `grill-openspec` 复合命名风格一致；"code"(写码) ＋ "mr"(建 MR) 概括其区别于最小 default 的两点。用 `git mv` 保留历史。备选 `git-mr`（更偏机制轴），已选 `code-mr`。

2. **最小 default 模板形态**：prompt body 极简——转"处理中"（查 transitions，语义匹配，不硬编码）→ 在工作目录完成任务（不建 git 分支/MR、不用 glab）→ 把结果上传 Jira（摘要 comment via `jira_rest` ＋ 附件 via `jira_upload_attachment`）→ 转终态（语义匹配）。frontmatter：`review_state: null`（无 review 桶）、`active_states: [待办, 处理中]`、`terminal_states: [完成, 关闭, 取消, 重复]`。备选：保留 review_state 名但不用——否决（`null` 更明确，且 `review_state` 允许 `null`）。

3. **按变体的技能集**：`skillsForWorkflow(default) = []`（最小 default 不装技能）；`code-mr = [land, install-glab]`；`grill-openspec = [land, install-glab, ...4 opsx]`（不变）。最小 default 不创造 MR，故不需 land/install-glab。

4. **三路标记探测**：grill 标记 `## 🔍 拷问 / Grill Questions` → `grill-openspec`；`<!-- tasking-workflow: code-mr -->` 哨兵注释 → `code-mr`；否则 → `default`。标记写在 prompt body（不改 schema/运行时，守 ADR 0001），与现有 grill 标记法一致。最小 default 不加标记（兜底即 default）。备选：加 `default` 标记做对称——否决（兜底已够，更简单）。备选：为老文件加 MR 语言启发式——否决（人为少数老用户做多余工作；`--workflow code-mr` 可显式覆盖）。

5. **`syncAllSkills` 改为按探测变体**：`runUpdate` 已先 `detectWorkflow` 出 `workflow`，把 `syncAllSkills` 的硬编码 `skillsForWorkflow("grill-openspec")` 换成 `skillsForWorkflow(workflow)`。最小 default 用户 `--update` 不再被塞全量技能；code-mr 用户同步 land+install-glab；grill-openspec 用户同步全 6 个（行为不变）。

6. **CLI/交互/包/文档同步**：`WorkflowVariant` 类型加 `code-mr`；`SUPPORTED_WORKFLOWS` 三值；`EXAMPLE_FILE_CODE_MR` 常量；`resolveExampleFile`/`normalizeWorkflow` 认 `code-mr`；`selectWorkflow` 三选项 ＋ 描述更新；`help.ts` `--workflow` 描述更新；`package.json` `files` 以新最小 `WORKFLOW.md.example` ＋ `WORKFLOW.code-mr.md.example` 取代旧条目；`generateWorkflowContent` 的 sed 目标随模板字段调整。

## Risks / Trade-offs

- [最小 default 用户无 land/install-glab 技能] → 若其 agent 临时想做 MR 会缺技能。可接受：最小 default 的契约就是"无 MR"；需要 MR 时选 `code-mr`。
- [老全-MR default WORKFLOW.md 无哨兵标记 → `--update` 探测为 default → 拿最小模板 diff 全 body 伪噪声] → 非破坏性（`--update` 永不写 WORKFLOW.md）；用户可 `tasking init --update --workflow code-mr` 显式覆盖。少数内部体验用户可接受。
- [`--workflow default` 语义 BREAKING] → 已有 `WORKFLOW.md` 不受影响（用户拥有，不被覆盖）；新装用户开箱即得最小。已在 issue 与拷问中确认。
- [`generateWorkflowContent` 的 sed 替换目标变化] → 最小 default 模板须保留 `endpoint:`/`api_key:`/`auth_mode:`/`api_user:`/`project_key:`/`app_id:`/`intake_chat_id:`/`create_issue_type:` 等可被正则命中的行，否则交互式 init 注入凭证失败。测试覆盖。

## Migration Plan

纯增量：`npm run build` 产出新 CLI；新装用户 `tasking init` 得最小 default，需全-MR 用 `tasking init --workflow code-mr`。老用户 WORKFLOW.md 不被改写；`--update` 老全-MR 文件可加 `--workflow code-mr` 选对模板。无 schema/存储迁移。回滚 = revert 分支。
