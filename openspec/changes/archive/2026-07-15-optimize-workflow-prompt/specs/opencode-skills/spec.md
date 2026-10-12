## ADDED Requirements

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

技能 SHALL 指示 agent 在转状态前先查询可用 transitions，按名称选择 id，SHALL NOT 硬编码 transition id。技能 SHALL 指示 agent 不要自行 transition 到终态。

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

#### Scenario: jira 技能 front matter 格式
- **WHEN** 查看 `assets/skills/jira/SKILL.md`
- **THEN** 文件以 YAML front matter 开头，含 `name` 和 `description` 字段
