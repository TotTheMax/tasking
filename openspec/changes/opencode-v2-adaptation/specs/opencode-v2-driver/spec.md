## ADDED Requirements

### Requirement: turn 以 opencode api 提交与驱动
worker/直连的 turn SHALL 通过 `opencode api` 命令（机器二进制，自动发现共享后台服务；`opencode.server_url` 非空时透传 `--server <url>`）驱动：首 turn `session.create`（显式携带 `location.directory` = 工作区/固定目录、`model` 映射 `{id, providerID, variant}`、`auto_approve` 生效时携带全放 ruleset）→ `session.prompt` 投递 prompt；后续轮对同一 session 继续 `session.prompt`。所有操作 SHALL 显式携带 `sessionID` 路径参数。tasking SHALL NOT spawn `opencode run`，SHALL NOT 依赖任何 stdout NDJSON 事件流。

#### Scenario: 首 turn 创建会话并投递
- **WHEN** 任务首 turn 启动（auto_approve=true、model=provider/model、variant=high）
- **THEN** 依次调用 `session.create`（location.directory=工作区、model={id,providerID,variant}、全放 ruleset）与 `session.prompt`，prompt 为渲染后的完整模板

#### Scenario: server_url 逃生口
- **WHEN** `opencode.server_url` 配置为 `http://127.0.0.1:48123`
- **THEN** 所有 api 调用附 `--server http://127.0.0.1:48123`；为 null 时不附，走自动发现

#### Scenario: session 限定操作必带路径参数
- **WHEN** 调用 `session.get` / `session.permission.list` / `session.prompt` 等 session 限定操作
- **THEN** 命令携带 `--param sessionID=<id>`，不依赖任何 location 默认解析

### Requirement: 轮询循环取进度与终态
驱动器 SHALL 以 `opencode.poll_interval_ms`（默认 2000）为间隔轮询：`session.get`（`outcome` ∈ succeeded/failed/interrupted 三态 + tokens）、`session.permission.list`（pending 审批单）、`session.message.list`（diff 新增 assistant 消息的 `content[]`，其中 `type:"tool"` 条目的 `state.input`/`state.metadata.exit`/`state.time` 为工具调用详情来源）。终态判定 SHALL 以 `outcome` 非空为准。ActivityStore/卡片数据 SHALL 由 message diff 喂入。

#### Scenario: 终态以 outcome 为准
- **WHEN** 轮询到 `outcome: "succeeded"`
- **THEN** turn 结算为成功，tokens 取自会话与消息级数据

#### Scenario: message diff 喂活动数据
- **WHEN** 两次轮询之间新增一条含 `type:"tool"` 的 assistant 消息（exit=0、耗时可算）
- **THEN** ActivityStore 新增对应工具调用条目，字段含命令、退出码与耗时

#### Scenario: 轮询失败可恢复
- **WHEN** 单次轮询调用失败（进程错误/网络抖动）
- **THEN** 记录警告并按原间隔继续下一轮轮询，不判失败

### Requirement: 中断梯子
超时（墙钟/不活跃）或显式中断 SHALL 依次执行：① `session.interrupt`；② 短宽限等待 turn 终态（outcome=interrupted）；③ 宽限后清理残留 api 子进程。`/stop` 与 daemon 停机 SHALL 走同一梯子。interrupt SHALL 对 turn 产生 `interrupted` 终态而非 `failed`。

#### Scenario: interrupt 后宽限内终态
- **WHEN** 墙钟超时触发 interrupt，且 2 个轮询周期内 outcome 变为 interrupted
- **THEN** attempt 分类 timed_out（turn_timeout），不进入清理残留分支

#### Scenario: 宽限后清理残留进程
- **WHEN** interrupt 后宽限期内终态未出现
- **THEN** 清理残留 api 子进程并按超时分类结算

### Requirement: 版本门禁
tasking SHALL 定义 `SUPPORTED`（`>=2.0 <3`）与 `VALIDATED`（起步 `2.0.x`）两个区间：大版本不符（含 1.x/3.x+）时 doctor 报失败且 daemon SHALL 拒绝启动（附升级指引）；2.x 内但超出 VALIDATED 的版本 SHALL 仅警告并放行。daemon 启动 SHALL 探活共享服务（`server.info`）并探测模型认证可用性，探活失败 SHALL 给出明确指引。

#### Scenario: v1 拒绝启动
- **WHEN** 机器 opencode 版本为 1.19.0
- **THEN** doctor 与 `tasking start` 均失败，提示需 `opencode upgrade --major`

#### Scenario: 未验证小版本放行
- **WHEN** 机器 opencode 为 2.3.1 而 VALIDATED 为 2.0.x
- **THEN** 输出友好警告后正常启动

#### Scenario: 服务与认证探活
- **WHEN** daemon 启动
- **THEN** 依次探测 `server.info` 与模型列表，失败时报告缺哪一环

### Requirement: 审批等待预算与计时器矩阵
存在 pending 审批单期间：`turn_timeout_ms` 与 `inactivity_timeout_ms` SHALL 暂停；`permission_timeout_ms`（默认 1800000）SHALL 接管计时，TUI 与卡片 SHALL 显示等待审批与剩余时间。到期 SHALL 自动 `reject` 该审批单（卡片盖章"超时已拒绝"）并恢复执行计时，turn 继续正常结算。调度器停滞检测 SHALL 感知等待审批状态（不判停滞）。`/stop` 撞挂起审批 SHALL 连带作废 pending 单（服务端未自动取消时补发 reject）。

#### Scenario: 等待期间执行计时暂停
- **WHEN** 审批单挂起 20 分钟后获准，turn 总执行时长预算 30 分钟
- **THEN** 结算时执行计时只含非等待时间，不因等待触发 turn_timeout

#### Scenario: 审批超时自动拒绝
- **WHEN** 审批单挂起达 `permission_timeout_ms`
- **THEN** 自动 reject、卡片盖章、turn 继续运行（工具被拒）

#### Scenario: stall 不误杀等待中的任务
- **WHEN** 任务挂起等审批超过 `stall_timeout_ms`
- **THEN** 调度器不将其判为停滞清理

### Requirement: daemon 重启清扫在飞会话
daemon 启动时 SHALL 对持久化记录（Jira sidecar 与直连 `direct_sessions` 表）中的会话，经 `session.active` 过滤出仍在执行的，逐个 `session.interrupt`，对应任务按失败进入正常重试。SHALL NOT 尝试收养（继续等待在飞 turn 完成）。

#### Scenario: 重启中断在飞 turn
- **WHEN** daemon 重启时某任务的会话仍在执行
- **THEN** 该会话被 interrupt，任务标记失败并按退避重试

#### Scenario: 已结束的会话不动作
- **WHEN** 重启时记录的会话已不在 active 列表
- **THEN** 不发 interrupt，不改动其状态
