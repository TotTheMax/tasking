## ADDED Requirements

### Requirement: intake 冷启动探测
`CommentBridge.discoverIntake` 在 `intake_cursor` 为空时 SHALL 通过 `FeishuSource.listMessages(intakeChat, "")`（不带时间参数 → 服务端返回最新一页）探测，取返回项 `create_time` 的最大值写入 `bridge_meta.intake_cursor`，且本轮 SHALL 只记录不处理（不建 issue、不回复 ack）。下一轮起从该游标正常增量轮询。空游标时 SHALL NOT 以 24h 窗口回看历史。

#### Scenario: 新机器首次轮询建立游标
- **WHEN** `discoverIntake` 发现 `intake_cursor` 为空且 intake 群存在历史消息
- **THEN** 用不带时间参数的请求取最新一页，`max(create_time)` 写入 `intake_cursor`，本轮不处理消息

#### Scenario: 探测后下一轮增量消费
- **WHEN** 初始游标已写入且之后出现新消息
- **THEN** 正常轮询消费游标之后的消息（`/issue` 建单、ack、命令各按既有分支）

#### Scenario: 空群不回退 24h
- **WHEN** `intake_cursor` 为空且 intake 群无可探测消息
- **THEN** 游标保持为空，不触发 24h 历史回看

### Requirement: 冷启动探测防重复建单
在冷启动探测完成前（游标为空的那一轮），`discoverIntake` SHALL NOT 对任何历史根消息执行 `/issue` 建单或发送 ack；探测只推进游标。

#### Scenario: 历史 /issue 消息不被重复建单
- **WHEN** 新机器首轮探测返回含历史 `/issue` 消息的最新一页
- **THEN** 该 `/issue` 不被建单，仅其 `create_time` 用于初始化游标

## MODIFIED Requirements

### Requirement: intake 群 /issue 发现与消费
`CommentBridge.discoverIntake` SHALL 在 intake 群发现新根消息（游标之后、`root_id == null`）并分派：`/issue` 建 Jira issue、`/help` 回复用法、`/state` 提示话题内使用、`/agent` 提示话题内使用、未知 `/` 命令回复未知命令、非命令自由文本回复"已收到" ack；消费后 SHALL 推进 `intake_cursor`。游标为空的首轮 SHALL 走冷启动探测（见新需求"intake 冷启动探测"），不执行本需求的消费逻辑。

#### Scenario: 游标之后的 /issue 建单
- **WHEN** intake 群出现游标之后的 `/issue` 根消息
- **THEN** 创建 Jira issue、回复创建成功、推进游标

#### Scenario: 首轮游标为空走探测
- **WHEN** `discoverIntake` 首轮且 `intake_cursor` 为空
- **THEN** 只探测记录初始游标，不执行本需求的建单/ack/命令分支
