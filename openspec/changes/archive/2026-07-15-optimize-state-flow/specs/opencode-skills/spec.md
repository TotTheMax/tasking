## MODIFIED Requirements

### Requirement: jira 技能
tasking SHALL 提供 `jira` 技能模板（`assets/skills/jira/SKILL.md`），指导 agent 使用 `jira_rest` 和 `jira_upload_attachment` MCP 工具完成 Jira 交互。技能 SHALL 包含以下使用场景的完整说明与 API 路径示例：
- 查询可用 transitions：`GET /issue/{key}/transitions`
- 执行状态转换：`POST /issue/{key}/transitions`（body 含 transition id，按名称从查询结果中选择）
- 读取已有评论：`GET /issue/{key}/comment`
- 添加评论：`POST /issue/{key}/comment`（body 含 body 字段）
- 读取附件元数据：`GET /issue/{key}?fields=attachment`
- 添加标签：`PUT /issue/{key}/labels`（body 含 labels update 操作）
- 上传附件：`jira_upload_attachment` 工具调用示例
- 生成 base64 编码：`fs.readFileSync(path).toString('base64')`

技能 SHALL 指示 agent 在转状态前先查询可用 transitions，按名称选择 id，SHALL NOT 硬编码 transition id。技能 SHALL 包含 State Flow 小节，解释三层状态模型（active / neither / terminal）和双路径 review 处理：增量修复（人移回初始 active 态，PR 还在 → 同分支改、push、扫完反馈、转回 review 态）和全量重置（人移到返工 active 态 → 关旧 MR、从 `origin/main` 创新分支、从头来、转回 review 态）。技能 SHALL 说明各阶段转换职责：开始工作时转入工作中 active 态；创建 MR 后转入 review 态；`land` 技能 merge 成功后转入 terminal 态。技能 SHALL 指示 agent 不要自行 transition 到终态。

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
