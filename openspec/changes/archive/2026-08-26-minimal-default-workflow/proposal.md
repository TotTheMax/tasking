## Why

现有 `default` workflow 模板（`WORKFLOW.md.example`）并非最小化：它驱动完整的 git 分支 + GitLab MR + review + land 合并流程，并安装 `land`/`install-glab` 技能。对于只想让 agent 在工作目录完成任务、把结果上传 Jira 即可的用户（无 VCS/MR），没有最小化 starter。TAS-15 要求把现有全-MR 模板改名为非默认变体，并让新 `default` 成为最小模板（工作目录完成任务 → 上传 Jira → 转 active→terminal），使开箱即用体验最小且丝滑。

## What Changes

- **BREAKING（变体语义）**：`--workflow default` 现指**最小** workflow——在工作目录完成任务 → 把结果（摘要 comment via `jira_rest` ＋ 附件 via `jira_upload_attachment`）上传 Jira → 直接转终态；**不建 git 分支、不建 MR、不用 glab、无 review 暂停、不装技能**。原全-MR 行为迁至新变体 `code-mr`。
- 新变体 `code-mr`：模板 `WORKFLOW.code-mr.md.example`（由原 `WORKFLOW.md.example` 改名而来，内容保留 + 哨兵标记 `<!-- tasking-workflow: code-mr -->`）。安装 `land` + `install-glab` 技能。
- 新最小 `default` 模板 `WORKFLOW.md.example`：最小 prompt body（转"处理中"→ 在工作目录完成任务 → 上传结果到 Jira → 转终态）。frontmatter：`review_state: null`、`active_states: [待办, 处理中]`、`terminal_states: [完成, 关闭, 取消, 重复]`。不装任何技能。
- `WorkflowVariant` 类型 → `"default" | "code-mr" | "grill-openspec"`；`SUPPORTED_WORKFLOWS`、`resolveExampleFile`、`normalizeWorkflow` 同步支持 `code-mr`。
- `skillsForWorkflow`：`default` → `[]`（无技能）；`code-mr` → `[land, install-glab]`；`grill-openspec` → `[land, install-glab, ...4 opsx]`（不变）。
- `detectWorkflow`（`--update` 漂移报告用）：三路探测——grill 标记 `## 🔍 拷问 / Grill Questions` → `grill-openspec`；`<!-- tasking-workflow: code-mr -->` → `code-mr`；否则 → `default`。**不做遗留启发式**：老的全-MR 文件无标记 → 落 `default` → 伪 diff，可用 `--workflow code-mr` 显式覆盖。
- `syncAllSkills`（`--update`）：改为同步 `skillsForWorkflow(detectedWorkflow)`，避免最小默认用户 `--update` 时被塞全量 6 个技能。
- `selectWorkflow` 交互式：三选项（`default`/`code-mr`/`grill-openspec`），描述更新。
- `src/cli/help.ts` `--workflow` 描述更新；`package.json` `files` 以新最小 `WORKFLOW.md.example` ＋ `WORKFLOW.code-mr.md.example` 取代旧条目。
- `tests/`（`prompt.test.ts`、`init.test.ts`）与 `docs/`（`configuration.md`、`usage.md`、`getting-started.md`、`state-flow.md`、`README.md`）同步更新。

## Capabilities

### New Capabilities
- `workflow-templates`: 三个 workflow 变体（`default` 最小、`code-mr` 全-MR、`grill-openspec`）的定义：各自的模板文件、变体→模板映射、prompt body 哨兵标记、按变体的技能集，以及 `detectWorkflow` 的三路标记探测。

### Modified Capabilities
- `interactive-init`: workflow 选择问答从二选项变三选项（`default`/`code-mr`/`grill-openspec`）；技能安装改为按变体条件化——最小 `default` 不装任何技能。
- `init-update`: `--update` 技能同步改为按 `skillsForWorkflow(detectedWorkflow)` 而非硬编码全量 6 个；`detectWorkflow` 由二路（grill 标记 vs default）升级为三路（grill 标记 / code-mr 标记 / default 兜底）。

## Impact

- `src/cli/init.ts`：`WorkflowVariant` 类型、`SUPPORTED_WORKFLOWS`、`EXAMPLE_FILE*` 常量、`resolveExampleFile`、`normalizeWorkflow`、`detectWorkflow`、`skillsForWorkflow`、`syncAllSkills`、`selectWorkflow`、`generateWorkflowContent` 的 sed 目标。
- `src/cli/help.ts`：`--workflow` 选项描述。
- `package.json`：`files` 数组。
- 模板文件：`git mv WORKFLOW.md.example WORKFLOW.code-mr.md.example`（＋哨兵标记）；新建最小 `WORKFLOW.md.example`。
- `tests/prompt.test.ts`、`tests/init.test.ts`：新增 `code-mr` 与最小 `default` 用例，调整原 default 用例指向 `code-mr`。
- `docs/configuration.md`、`docs/usage.md`、`docs/getting-started.md`、`docs/state-flow.md`、`README.md`：变体表与说明。
- `CONTEXT.md`：补 `code-mr` 变体术语；`docs/adr/0011-*.md`：记录三变体拆分 ＋ 标记探测决策。
- 无新增运行时依赖；纯增量，schema 不变（守 ADR 0001）。
