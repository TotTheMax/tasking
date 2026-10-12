## MODIFIED Requirements

### Requirement: /chat 在 intake 群发起直连会话
`CommentBridge.discoverIntake` SHALL 把以 `/chat` 开头的 intake 群根消息交给 `DirectSessionManager` 处理（而非当作未知命令）。`/chat <project> <消息>` SHALL 按 `feishu.direct.projects` 名称映射（大小写不敏感）解析目录；`/chat /绝对路径 <消息>` SHALL 使用该绝对路径（ad-hoc path 模式）。两者均 SHALL 以首条消息内容作为第一 turn 的 prompt 创建直连会话，并立即在原消息的话题回复中 ACK（`✅ 会话已创建 …`）。`/chat` 根消息 SHALL 幂等：若 `direct_sessions` 中已存在该 root_id（daemon 重启/断线导致的 intake sweep 重投、或 WS 重放），系统 SHALL NOT 重建会话或重跑首 turn；由于该分支只可能由重投触发（新 `/chat` 必然是新 message_id → 新建会话），系统 SHALL NOT 回复任何消息，仅记 debug（避免与用户动作无关的随机回执）。该持久去重与 `/issue` 的 `hasRootId` 守卫同理。

#### Scenario: 按项目名创建会话
- **WHEN** intake 群收到根消息 `/chat tasking 帮我跑一下测试`，且 `feishu.direct.projects` 含 `tasking: /repos/tasking`
- **THEN** 系统在 `/repos/tasking` 创建直连会话，首 turn prompt 为 `帮我跑一下测试`，并在该消息的话题内回复创建 ACK

#### Scenario: 重投的 /chat 根消息静默跳过
- **WHEN** 同一条 `/chat` 根消息在 daemon 重启后被 intake sweep 再次投递（该 root_id 已有会话）
- **THEN** 系统不再新建会话、不重跑首 turn、不覆盖既有 session_id，且不发送任何回执（静默跳过并记 debug）

#### Scenario: 按 path 创建会话
- **WHEN** intake 群收到根消息 `/chat /home/me/notes 整理一下这个目录`，且 `feishu.direct.path_roots` 为空（不限制）
- **THEN** 系统在 `/home/me/notes` 创建直连会话并以 `整理一下这个目录` 为首 turn

#### Scenario: path 模式受 path_roots 白名单约束
- **WHEN** `feishu.direct.path_roots` 非空且收到的 ad-hoc path 不在任何前缀之下
- **THEN** 系统 SHALL 拒绝创建并回复提示（列出可用的前缀与项目名），不产生任何会话记录

#### Scenario: 未知项目名与不存在的路径
- **WHEN** `/chat <project>` 的 project 不在配置映射中，或 ad-hoc path 不存在/不是目录
- **THEN** 系统 SHALL 回复友好错误（含 `/chat` 用法与可用项目列表），不创建会话

#### Scenario: /chat 无参数
- **WHEN** 收到 `/chat` 或 `/chat list`
- **THEN** 系统 SHALL 回复已配置的项目清单（名字 → 路径）及 path 模式用法提示
