## ADDED Requirements

### Requirement: prompt 模板包含 jira_upload_attachment 使用指南
`WORKFLOW.md` starter 模板(`init.ts`)的 prompt body SHALL 包含 `jira_upload_attachment` 工具的使用说明,告诉 agent 如何上传附件到 Jira 任务。说明 SHALL 包含调用示例(如 `jira_upload_attachment({ issue_key: "{{ task.identifier }}", filename: "screenshot.png", content: "<base64>" })`)与生成 base64 content 的方法(`fs.readFileSync(path).toString('base64')`)。

#### Scenario: prompt 包含 jira_upload_attachment 用法
- **WHEN** 查看 `init.ts` 中 starter WORKFLOW.md 模板的 prompt body
- **THEN** 包含 `jira_upload_attachment` 工具的使用说明与调用示例

#### Scenario: prompt 包含 base64 编码方法
- **WHEN** 查看 starter 模板中附件上传说明
- **THEN** 包含将本地文件转为 base64 的示例代码 `fs.readFileSync(path).toString('base64')`

### Requirement: 完成流程集成可选附件上传步骤
prompt 模板 SHALL 在代码任务和非代码任务的完成步骤中增加可选附件上传指引:如有产出文件(截图、日志、测试报告等),agent SHALL 用 `jira_upload_attachment` 上传到 Jira 任务。该步骤为条件性的——仅在存在产出文件时执行,SHALL NOT 强制 agent 造文件。

#### Scenario: 代码任务完成时上传附件
- **WHEN** prompt 模板渲染给代码任务的 agent,且 agent 有产出文件(如测试报告)
- **THEN** 指示 agent 用 `jira_upload_attachment` 上传产出文件到 Jira 任务

#### Scenario: 无产出文件时跳过附件上传
- **WHEN** prompt 模板包含附件上传指引,但 agent 无产出文件
- **THEN** 指示 agent 跳过附件上传步骤(条件性语言"如有")

#### Scenario: 非代码任务也可上传附件
- **WHEN** prompt 模板渲染给非代码任务的 agent,且有产出文件(如调研报告)
- **THEN** 指示 agent 用 `jira_upload_attachment` 上传产出文件
