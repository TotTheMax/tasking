## ADDED Requirements

### Requirement: Feishu Setup 交互引导
交互式 init SHALL 在 Jira 段之后新增 **Feishu Setup** 段：询问是否启用飞书评论桥；启用则采集 app_id、intake_chat_id，并复用已发现的项目 issueTypes 供选择 `create_issue_type`（选项首项为模板默认 `Task`，回车即默认）。采集值 SHALL 写入生成的 WORKFLOW.md `feishu:` 块：`app_id`/`intake_chat_id`/`create_issue_type` 写明文值，`app_secret` 保持 `$FEISHU_APP_SECRET` env 引用并提示用户 export，`enabled` 置 `true`。不启用则保持模板 `enabled: false`。

#### Scenario: 启用并采集
- **WHEN** 交互式 init 中用户选择启用飞书桥并填写值
- **THEN** 生成的 WORKFLOW.md `feishu:` 块 `enabled: true`、app_id/intake_chat_id/create_issue_type 为所填值、app_secret 为 `$FEISHU_APP_SECRET`

#### Scenario: 不启用保持关闭
- **WHEN** 交互式 init 中用户选择不启用飞书桥
- **THEN** 生成的 WORKFLOW.md 飞书块保持 `enabled: false`，不写任何飞书值

### Requirement: 非交互 init 飞书提示
非交互式 init SHALL 在输出末尾打印一行飞书接入指引，指向 `docs/feishu-quickstart.md`，说明启用桥需编辑 WORKFLOW.md 的 `feishu:` 块。

#### Scenario: 非交互模式提示
- **WHEN** 运行非交互式 init
- **THEN** 输出含 `docs/feishu-quickstart.md` 指引
