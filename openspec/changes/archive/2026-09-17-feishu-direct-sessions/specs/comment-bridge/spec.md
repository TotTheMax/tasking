## MODIFIED Requirements

### Requirement: intake 群 /issue 发现与消费
`CommentBridge.discoverIntake` SHALL 在 intake 群发现新根消息（游标之后、`root_id == null`）并分派：`/chat` 交由 `DirectSessionPort`（直连会话，见 direct-sessions 能力）、`/issue` 建 Jira issue、`/help` 回复用法、`/state` 提示话题内使用、`/agent` 提示话题内使用、未知 `/` 命令回复未知命令、非命令自由文本回复"已收到" ack；消费后 SHALL 推进 `intake_cursor`。游标为空的首轮 SHALL 走冷启动探测（见新需求"intake 冷启动探测"），不执行本需求的消费逻辑。直连功能未启用（`feishu.direct.enabled: false` 或未接线 direct 端口）时 `/chat` SHALL 按未知命令处理。

#### Scenario: 游标之后的 /issue 建单
- **WHEN** intake 群出现游标之后的 `/issue` 根消息
- **THEN** 创建 Jira issue、回复创建成功、推进游标

#### Scenario: 首轮游标为空走探测
- **WHEN** `discoverIntake` 首轮且 `intake_cursor` 为空
- **THEN** 只探测记录初始游标，不执行本需求的建单/ack/命令分支

#### Scenario: /chat 根消息交给直连会话管理器
- **WHEN** intake 群出现游标之后的 `/chat …` 根消息且直连功能已配置
- **THEN** 该消息由 `DirectSessionPort` 处理（创建会话/列项目/错误提示），不回复"未知命令"，游标照常推进
