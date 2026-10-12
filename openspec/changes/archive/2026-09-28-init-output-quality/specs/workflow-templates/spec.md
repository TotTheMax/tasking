# workflow-templates

## ADDED Requirements

### Requirement: 模板中的死配置注释化

模板 SHALL 将无运行时消费方的配置以注释形式保留并标注原因，成为 canonical 参照的一部分：`router` 段整段注释并标注「未实现：当前仅解析，无运行时代码」；`feishu.verification_token` / `feishu.encrypt_key` 注释并标注「webhook 模式预留」。模板其余段落 SHALL 保持 active（模板仍是可直接复制的全量参照与漂移/语言对齐测试的基准）。

#### Scenario: router 段在模板中为注释
- **WHEN** 解析任一 starter 模板
- **THEN** `router` 键不出现在解析结果中（整段为注释），且注释内含「未实现」标注

#### Scenario: 模板其余段仍可解析
- **WHEN** 解析任一 starter 模板的 frontmatter
- **THEN** `tracker`/`polling`/`workspace`/`hooks`/`agent`/`opencode`/`feishu`/`server`/`logging`/`env` 仍为可解析的活配置（除 `feishu.verification_token`/`encrypt_key` 两行为注释）

#### Scenario: 模板语言对齐不受影响
- **WHEN** 运行 en-templates 的语言对齐测试
- **THEN** zh/en 模板仍通过 YAML 键集合与 Liquid 表达式对齐断言
