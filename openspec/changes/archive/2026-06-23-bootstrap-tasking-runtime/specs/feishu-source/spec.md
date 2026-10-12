## ADDED Requirements

### Requirement: 飞书 v1 接入范围
`feishu-source` 适配器 SHALL 接入飞书 IM 文本消息(v1)。SHALL 过滤为 @mention 了配置机器人的消息。富文本、卡片、文件消息与非 IM 事件类型在 v1 范围外,SHALL 被忽略或记录后跳过。

#### Scenario: 带 mention 的文本消息被接入
- **WHEN** 一条飞书 IM 文本消息 @mention 了配置机器人
- **THEN** 该消息作为未分诊条目接入 inbox

#### Scenario: 无 mention 被忽略
- **WHEN** 一条飞书 IM 文本消息未 @mention 机器人
- **THEN** 不接入该消息

#### Scenario: 富文本超出范围
- **WHEN** 收到一条飞书富文本/卡片消息
- **THEN** 忽略(v1),可选地记录日志

### Requirement: 幂等接入 inbox
适配器 SHALL 以飞书消息 id 为键(带 UNIQUE 约束)将每条接入消息插入持久 inbox,使重复投递或回放为无操作。每个 inbox 条目 SHALL 记录 `source=feishu`、`source_msg_id`、`received_at`、以及原始负载。

#### Scenario: 重复投递幂等
- **WHEN** 同一飞书消息 id 被投递两次
- **THEN** 仅创建一个 inbox 条目

### Requirement: 飞书回复支持
适配器 SHALL 支持 `feishu.reply` 操作,向飞书会话发送文本回复,供 route agent 的 `feishu.reply` 工具使用。失败 SHALL 作为工具错误暴露,且 SHALL NOT 使 route-agent 运行无限停滞。

#### Scenario: 回复已发送
- **WHEN** 调用 `feishu.reply` 带会话 id 与文本
- **THEN** 向该会话发送一条文本回复

#### Scenario: 回复失败暴露错误
- **WHEN** `feishu.reply` 失败
- **THEN** 返回工具错误且 route-agent 运行继续

### Requirement: 飞书认证与端点配置
适配器 SHALL 从配置读取飞书应用凭据(app id/secret 或 `$VAR` 间接引用)以及事件订阅的校验 token/加密 key。飞书源启用时,缺失必需凭据 SHALL 为配置校验错误。

#### Scenario: 缺失凭据校验失败
- **WHEN** 飞书源启用但 `$` 解析后应用凭据缺失
- **THEN** 配置校验失败

### Requirement: 事件接入不阻塞
飞书事件接入 SHALL NOT 阻塞结构化调度器。接入的条目 SHALL 持久化到 inbox 并供下次 route-agent 运行使用。

#### Scenario: 接入不阻塞结构化路径
- **WHEN** 正在接入一条飞书事件
- **THEN** 结构化调度器继续独立轮询与派发
