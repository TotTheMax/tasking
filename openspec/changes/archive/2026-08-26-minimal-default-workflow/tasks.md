## 1. 变体类型与模板文件（先红后绿）

- [ ] 1.1 写失败测试：`normalizeWorkflow("code-mr")` 返回 `code-mr`；`SUPPORTED_WORKFLOWS` 含三者；未知值仍 invalid（`tests/init.test.ts`）
- [ ] 1.2 `git mv WORKFLOW.md.example WORKFLOW.code-mr.md.example`（保留历史），在其 prompt body 加哨兵 `<!-- tasking-workflow: code-mr -->`
- [ ] 1.3 新建最小 `WORKFLOW.md.example`：最小 prompt body（转 in-progress→工作目录完成任务→上传 Jira→转终态；无 git/MR/glab）＋ frontmatter `review_state: null`/`active_states: [待办,处理中]`/`terminal_states: [完成,关闭,取消,重复]`；保留 `generateWorkflowContent` 的 sed 命中行（endpoint/api_key/auth_mode/api_user/project_key/app_id/intake_chat_id/create_issue_type）
- [ ] 1.4 更新 `src/cli/init.ts`：`WorkflowVariant` 加 `code-mr`；`SUPPORTED_WORKFLOWS` 三值；新增 `EXAMPLE_FILE_CODE_MR` 常量；`resolveExampleFile`/`normalizeWorkflow` 认 `code-mr`

## 2. 探测与技能集（先红后绿）

- [ ] 2.1 写失败测试：`detectWorkflow` 三路——grill 标记→`grill-openspec`；`<!-- tasking-workflow: code-mr -->`→`code-mr`；无标记→`default`（`tests/init.test.ts`）
- [ ] 2.2 写失败测试：`skillsForWorkflow(default)` 返回 `[]`；`code-mr` 返回 `[land, install-glab]`；`grill-openspec` 返回 6 个（`tests/init.test.ts`：default init 不装技能、code-mr init 装 land+install-glab）
- [ ] 2.3 实现：`skillsForWorkflow` 改为 `default→[]`/`code-mr→[land,install-glab]`/`grill-openspec→[land,install-glab,...opsx]`；`detectWorkflow` 改三路优先级探测
- [ ] 2.4 写失败测试：`--update` 对 `default`（无标记）探测不装技能；对 code-mr 标记同步 land+install-glab；对 grill 标记同步全 6 个
- [ ] 2.5 实现：`syncAllSkills` 由硬编码 `skillsForWorkflow("grill-openspec")` 改为 `skillsForWorkflow(workflow)`（`workflow` 取自 `runUpdate` 已探测值）

## 3. 交互式选择与 CLI/包接线（先红后绿）

- [ ] 3.1 写失败测试：交互式 `selectWorkflow` 提供三选项（`default`/`code-mr`/`grill-openspec`）；`--workflow code-mr` 跳过问答并用 code-mr 模板（`tests/init.test.ts`）
- [ ] 3.2 实现：`selectWorkflow` 三选项 ＋ 描述更新（`default`＝最小；`code-mr`＝写码＋建 MR；`grill-openspec`＝拷问→propose→implement→archive）；`generateWorkflowContent` sed 目标随最小模板字段对齐
- [ ] 3.3 更新 `src/cli/help.ts`：`--workflow` 描述为 `default | code-mr | grill-openspec (default: default)`
- [ ] 3.4 更新 `package.json` `files`：以新 `WORKFLOW.md.example` ＋ `WORKFLOW.code-mr.md.example` 取代旧条目（`WORKFLOW.grill-openspec.md.example` 保留）

## 4. 模板 prompt body 测试（先红后绿）

- [ ] 4.1 写失败测试：`WORKFLOW.code-mr.md.example` body 渲染不抛错（attempt null 与重试）、含哨兵 `<!-- tasking-workflow: code-mr -->`、含 sync/MR/commit/land（`tests/prompt.test.ts` 新 describe）
- [ ] 4.2 写失败测试：新最小 `WORKFLOW.md.example` body 渲染不抛错、不含 `glab mr create`/git 分支/`land`、含 `jira_rest` 与 `jira_upload_attachment` 引用、frontmatter `review_state: null`（`tests/prompt.test.ts`）
- [ ] 4.3 调整原 `WORKFLOW.md.example` body 测试组：迁到 `WORKFLOW.code-mr.md.example`（State Flow/双路径/jira_rest/land/sync/MR/commit 等断言指向 code-mr 模板）
- [ ] 4.4 跑 `npm test` 确认 prompt 测试绿

## 5. 文档与项目记忆

- [ ] 5.1 更新 `docs/configuration.md`：模板变体表三行（`default`最小/`code-mr`全-MR/`grill-openspec`）＋文件名
- [ ] 5.2 更新 `docs/usage.md`：`--workflow` 选项三值、技能交付说明（default 不装/code-mr 装 land+install-glab/grill 装 6 个）、`--update` 探测三路
- [ ] 5.3 更新 `docs/getting-started.md`、`docs/state-flow.md`、`README.md`：变体名与默认语义
- [ ] 5.4 更新 `CONTEXT.md`：`Workflows` 段补 `code-mr` 变体术语，`default` 释义改为最小
- [ ] 5.5 写 `docs/adr/0011-three-variant-split-and-marker-detection.md`：三变体拆分 ＋ 哨兵标记三路探测决策（守 ADR 0001）

## 6. 验证

- [ ] 6.1 跑 `npm run lint` ＋ `npm run typecheck` ＋ `npm test`，全绿后提交
