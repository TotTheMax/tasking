## MODIFIED Requirements

### Requirement: jira 技能
tasking SHALL 提供 `jira` 技能模板（`assets/skills/jira/SKILL.md`），指导 agent 使用 `jira_rest` 和 `jira_upload_attachment` MCP 工具完成 Jira 交互。技能 SHALL 在正文最前面包含强制规则：禁止使用 curl、wget 或任何 HTTP 客户端直接调用 Jira REST API，所有 Jira 操作必须通过 `jira_rest` MCP 工具完成。技能 SHALL 包含以下使用场景的完整说明与 API 路径示例：
- 查询可用 transitions：`GET /issue/{key}/transitions`
- 执行状态转换：`POST /issue/{key}/transitions`（body 含 transition id，按名称从查询结果中选择）
- 读取已有评论：`GET /issue/{key}/comment`
- 添加评论：`POST /issue/{key}/comment`（body 含 body 字段）
- 读取附件元数据：`GET /issue/{key}?fields=attachment`
- 添加标签：`PUT /issue/{key}/labels`（body 含 labels update 操作）
- 上传附件：`jira_upload_attachment` 工具调用示例
- 生成 base64 编码：`fs.readFileSync(path).toString('base64')`

技能 SHALL 指示 agent 在转状态前先查询可用 transitions，按名称选择 id，SHALL NOT 硬编码 transition id。技能 SHALL 包含 State Flow 小节，解释三层状态模型（active / neither / terminal）和双路径 review 处理：增量修复（人移回初始 active 态，PR 还在 → 同分支改、push、扫完反馈、转回 review 态）和全量重置（人移到返工 active 态 → 关旧 MR、从 `origin/main` 创新分支、从头来、转回 review 态）。技能 SHALL 说明各阶段转换职责：开始工作时转入工作中 active 态；创建 MR 后转入 review 态；`land` 技能 merge 成功后转入 terminal 态。技能 SHALL 指示 agent 不要自行 transition 到终态。

#### Scenario: jira 技能包含强制规则禁止 curl
- **WHEN** 查看 `assets/skills/jira/SKILL.md`
- **THEN** 正文最前面含强制规则，禁止 curl/wget/HTTP 客户端直接调 Jira API

#### Scenario: jira 技能包含 transitions 查询示例
- **WHEN** 查看 `assets/skills/jira/SKILL.md`
- **THEN** 包含 `GET /issue/{key}/transitions` 的 jira_rest 调用示例

#### Scenario: jira 技能包含状态转换示例
- **WHEN** 查看 `assets/skills/jira/SKILL.md`
- **THEN** 包含 `POST /issue/{key}/transitions` 的 jira_rest 调用示例，含按名称选 id 的说明

#### Scenario: jira 技能包含评论读写示例
- **WHEN** 查看 `assets/skills/jira/SKILL.md`
- **THEN** 包含 `GET /issue/{key}/comment` 和 `POST /issue/{key}/comment` 的调用示例

#### Scenario: jira 技能包含附件读写示例
- **WHEN** 查看 `assets/skills/jira/SKILL.md`
- **THEN** 包含 `GET /issue/{key}?fields=attachment` 和 `jira_upload_attachment` 的调用示例

#### Scenario: jira 技能包含标签添加示例
- **WHEN** 查看 `assets/skills/jira/SKILL.md`
- **THEN** 包含 `PUT /issue/{key}/labels` 的 jira_rest 调用示例

#### Scenario: jira 技能包含 base64 编码方法
- **WHEN** 查看 `assets/skills/jira/SKILL.md`
- **THEN** 包含 `fs.readFileSync(path).toString('base64')` 的示例代码

#### Scenario: jira 技能指示先查 transitions
- **WHEN** 查看 `assets/skills/jira/SKILL.md`
- **THEN** 指示 agent 先查询可用 transitions 再按名称选 id，不硬编码 id

#### Scenario: jira 技能包含 State Flow 小节
- **WHEN** 查看 `assets/skills/jira/SKILL.md`
- **THEN** 包含 State Flow 小节，解释三层状态模型（active / neither / terminal）

#### Scenario: jira 技能 State Flow 说明双路径 review
- **WHEN** 查看 `assets/skills/jira/SKILL.md` 的 State Flow 小节
- **THEN** 说明增量修复路径（人移回初始 active 态 → 同分支改）和全量重置路径（人移到返工 active 态 → 关 MR、新分支）

#### Scenario: jira 技能 State Flow 说明各阶段转换职责
- **WHEN** 查看 `assets/skills/jira/SKILL.md` 的 State Flow 小节
- **THEN** 说明开始工作时转工作中 active 态、创建 MR 后转 review 态、land 技能 merge 后转 terminal 态

#### Scenario: jira 技能 front matter 格式
- **WHEN** 查看 `assets/skills/jira/SKILL.md`
- **THEN** 文件以 YAML front matter 开头，含 `name` 和 `description` 字段

### Requirement: push 技能
tasking SHALL 提供 `push` 技能模板（`assets/skills/push/SKILL.md`），指导 agent push 分支并创建/更新 GitLab MR。技能 SHALL 在正文最前面包含强制规则：`glab` 已通过 `GITLAB_TOKEN` 环境变量预认证，直接使用 `glab` 命令；禁止搜索 token 文件、禁止执行 `glab auth login` 或 `glab auth status`、禁止用 `git push` + 手动创建 MR 代替 `glab mr create`。技能 SHALL 使用 `glab` CLI 而非 `gh`：`glab mr create --title <title> --description <body>` 创建 MR，`glab mr view` 查看 MR 信息。技能 SHALL 指示 agent 在 push 被拒绝时使用 `pull` 技能同步。

#### Scenario: push 技能包含 glab 预认证声明
- **WHEN** 查看 `assets/skills/push/SKILL.md`
- **THEN** 正文最前面含强制规则，声明 glab 已预认证，禁止搜索 token

#### Scenario: push 技能使用 glab 创建 MR
- **WHEN** agent 使用 `push` 技能发布分支
- **THEN** 使用 `glab mr create` 而非 `gh pr create`

#### Scenario: push 技能引用 pull 技能
- **WHEN** push 被拒绝（non-fast-forward）
- **THEN** 技能指示使用 `pull` 技能同步后再 push

### Requirement: land 技能
tasking SHALL 提供 `land` 技能模板（`assets/skills/land/SKILL.md`），指导 agent 完成 GitLab MR 落地流程。技能 SHALL 在正文最前面包含强制规则：`glab` 已通过 `GITLAB_TOKEN` 环境变量预认证，直接使用 `glab` 命令；禁止搜索 token 文件、禁止执行 `glab auth login` 或 `glab auth status`、禁止用 `git push` + 手动创建 MR 代替 `glab mr create`。技能 SHALL 指示 agent：检查 mergeable 状态、使用 `land_watch.py` 传感器监控 CI 和 review、根据 exit code 处理反馈、`glab mr merge --squash` 合并。技能 SHALL NOT 包含 Codex Review bot 相关逻辑。技能 SHALL 指示 agent 在单 turn 内驱动 land_watch 循环（run → interpret → act → re-run）。

#### Scenario: land 技能包含 glab 预认证声明
- **WHEN** 查看 `assets/skills/land/SKILL.md`
- **THEN** 正文最前面含强制规则，声明 glab 已预认证，禁止搜索 token

#### Scenario: land 技能使用 glab 合并
- **WHEN** agent 使用 `land` 技能落地 MR
- **THEN** 使用 `glab mr merge --squash` 而非 `gh pr merge --squash`

#### Scenario: land 技能不含 Codex Review 逻辑
- **WHEN** 查看 `land` 技能模板
- **THEN** 不包含 `## Codex Review`、`[codex]` 前缀、`CODEX_BOTS` 等 Codex Review 相关内容

#### Scenario: land 技能驱动 land_watch 循环
- **WHEN** agent 使用 `land` 技能
- **THEN** 技能指示 agent 运行 `python3 land_watch.py`、根据 exit code 处理、然后重新运行
