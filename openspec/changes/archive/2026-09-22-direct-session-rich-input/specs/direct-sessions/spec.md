## ADDED Requirements

### Requirement: 附件进入本轮 prompt
直连会话收到带附件的消息时 SHALL 下载每个附件、写入 tasking 自有 inbox 目录（`<workspace.root>/direct-inbox/<root_id>/`，SHALL NOT 写入用户的目标仓库），并把**绝对路径**追加到该轮 prompt（用户原文在前，每个附件一行；无文字时补一句引导语）。单个附件 SHALL 有体积上限（默认 20MB），超限 SHALL 在话题内说明并跳过。附件下载失败 SHALL 在话题内可见；若该消息仍有文字，SHALL 继续执行该轮并带上失败说明。**仅含附件、没有文字**的消息 SHALL 正常开启一轮（不再回"暂仅支持文本消息"）。该会话的 inbox 目录 SHALL 在 `/done`、`/new` 与 TTL 过期时随会话一起清理。

#### Scenario: 文字+截图一条消息
- **WHEN** 收到 `post` 富文本（文字 + 图片）
- **THEN** 该轮 prompt 含用户原文与图片的绝对路径，agent 可按路径读取

#### Scenario: 仅附件也能起一轮
- **WHEN** 话题内收到一条只有图片（无文字）的消息
- **THEN** 系统开启一轮，prompt 含该图片路径与引导语，不再回"暂仅支持文本消息"

#### Scenario: 下载失败不静默
- **WHEN** 某附件超过体积上限或下载失败
- **THEN** 话题内出现说明；若仍有文字，该轮照常执行并注明该附件不可用

#### Scenario: 仅附件且全部失败则不开跑
- **WHEN** 消息仅含附件，且所有附件都下载失败或超限
- **THEN** 系统 SHALL NOT 以空 prompt 开跑，话题内说明附件未能读取

#### Scenario: 不污染目标仓库
- **WHEN** 任意附件被落盘
- **THEN** 文件位于 tasking 的 inbox 目录，目标仓库工作区不新增文件

#### Scenario: 会话结束清理附件
- **WHEN** 执行 `/done`（或 `/new`、TTL 过期）
- **THEN** 该会话的 inbox 目录被删除

### Requirement: 多消息收集模式（/collect、/send、/cancel）
系统 SHALL 支持手动收集模式：`/collect` 开启后，话题内的普通消息（含附件）SHALL 只被收集并回执（`📥 已收集 N 条`），SHALL NOT 立即开跑；`/send` SHALL 把缓冲合并为**一轮**提交（多条以 `\n---\n` 连接）；`/cancel` SHALL 丢弃缓冲并退出。收集模式 SHALL 有**空闲超时**（默认 10 分钟无新消息）并**自动提交**，避免"忘记提交"导致静默卡住。收集期间其它命令（`/status`、`/auto`、`/agent`…）SHALL 正常执行且不影响缓冲；`/done`、`/new`、TTL 过期 SHALL 丢弃缓冲。缓冲为内存态，daemon 重启即丢失（开启时的回执 SHALL 说明）。附件在收集时即下载落盘，路径随该条一起进缓冲。

#### Scenario: 收集多条（含附件）后一次提交
- **WHEN** `/collect` 后依次发"这是报错 + 截图"与"再补充一句"，然后 `/send`
- **THEN** 这些内容合并为**一轮**，prompt 同时含两段文字与图片的绝对路径

#### Scenario: 超时自动提交
- **WHEN** 收集模式下超过空闲超时没有新消息
- **THEN** 系统自动把缓冲提交为一轮，并在话题内说明是超时提交

#### Scenario: 取消丢弃
- **WHEN** 收集模式下执行 `/cancel`
- **THEN** 缓冲被丢弃、不产生任何轮次，回执说明丢弃条数

#### Scenario: 命令不受收集影响
- **WHEN** 收集模式下执行 `/status`
- **THEN** 状态卡正常返回，缓冲保持不变，随后 `/send` 仍能提交全部收集内容

### Requirement: 命令回执以卡片呈现
直连会话的**信息类**命令回执（`/help`、`/auto` 查看、`/collect` 状态、`/agent` 查看、`/model` 查看）SHALL 以飞书卡片呈现，而非纯文本；卡片不可用（无上传能力或发送失败）时 SHALL 回落为纯文本。`/auto` 查看卡与 `/collect` 状态卡 SHALL 提供操作按钮（`/auto on|once|off`、开始收集/提交/丢弃），点击 SHALL 执行与对应命令相同的动作，并就地刷新被点击的那张卡。转瞬即逝的回执（`📥 已收集 N 条`、附件超限/失败告警、未知命令提示、`/done` 确认等）SHALL 保持纯文本。

#### Scenario: /help 返回卡片
- **WHEN** 话题内执行 `/help`
- **THEN** 返回一张卡片（含续聊、富输入与命令清单），而非纯文本；卡片不可用时回落纯文本

#### Scenario: /auto 卡片按钮生效
- **WHEN** 点击 `/auto` 查看卡上的"本会话放开"按钮
- **THEN** 会话覆盖被置为 `on`（下一轮生效），返回 toast，且该卡就地刷新为新的姿态

#### Scenario: /collect 卡片按钮驱动收集
- **WHEN** 点击"开始收集"→ 发若干消息 → 点击"提交为一轮"
- **THEN** 缓冲内容合并为**一轮**执行，回执说明提交条数；点"丢弃"则缓冲被丢弃且不产生轮次

#### Scenario: 信息卡回落纯文本
- **WHEN** 适配器没有卡片发送能力（或发卡失败）
- **THEN** 同一命令以纯文本回执，命令语义不变
