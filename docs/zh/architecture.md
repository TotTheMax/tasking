# 架构概览

本文档解释 `tasking` 的整体架构:双源双调度模型、共享 Task 模型、worker 子进程隔离、状态持久化与重启恢复、安全不变式。

## 双源双调度

`tasking` 从两个截然不同的任务源编排 coding-agent 工作,两者汇聚到共享的 worker 路径。

```
Jira (结构化) ──► 确定性调度器 ──┐
                                 ├──► 共享 Task 模型 ──► 工作区 ──► opencode run worker
飞书 (直连会话) ──► direct worker ─┘
```

### 结构化路径(Jira):确定性调度

Jira 路径采用 Symphony 式的确定性调度,**热循环中不使用任何 LLM**。调度器按固定间隔轮询 Jira,对候选任务进行资格判定与排序,派发符合条件的任务给 worker。

调度循环(每个 tick):

1. **对账(reconcile)**:先对账运行中任务——检测停滞(超过 `stall_timeout_ms` 无活动)、刷新 tracker 状态(terminal 则停止并清理工作区,active 则更新快照,其他则停止不清理)。
2. **预校验**:校验配置(`tracker.kind`、凭据、`opencode.command`),失败则跳过本 tick 派发但保留对账。
3. **拉取候选**:用 JQL 拉取活跃状态下的 Jira issue。
4. **排序**:按 `priority` 升序、`created_at` 最旧优先、`identifier` 字典序排序。
5. **派发**:在有全局与按状态并发槽位时,逐个派发符合资格的任务。

派发资格判定:任务有 id/identifier/title/state、状态为活跃且非终端、含全部 `required_labels`、未运行、未认领、并发槽位可用;对 Todo 状态还要求所有 blocker 已终端。

### 非结构化路径(飞书):route agent 分诊（**未实现**）

> **未实现**：本节为设计稿——route agent / inbox 分诊路径当前无运行时代码（无 `src/router/`，`tasking triage` 子命令无 handler）。飞书当前能力见[使用指南](./usage.md)的直连会话与评论桥。

飞书路径用 LLM **仅做分诊**:把聊天消息转化为归一化 `Task` + 派发决策,再交给同一确定性 worker 路径。

流程:

1. **接入**:飞书 IM 文本消息 @mention 机器人后,幂等接入持久 inbox(SQLite)。
2. **分诊**:route agent(一个 `opencode run` 子进程,使用 triage agent profile)按 tick 有界运行,通过 `inbox.pop_untriaged`/`inbox.mark_decision`/`feishu.reply` 工具读取、决策、回复。
3. **派发**:决策为"可派发"的条目归一化为 `Task`,经共享 worker 路径派发(受同一并发预算约束),inbox 条目标记为 `dispatched`。

route agent 同一时刻最多一个运行(除非另行配置),**不阻塞**结构化调度器。

### 共享汇聚点

两条路径在以下三处汇聚:

- **共享 Task 模型**:Jira 归一化产出 `Task` 类型（route agent 产出为规划，未实现）。
- **共享工作区管理器**:per-task 工作区创建/复用/hooks/安全不变式。
- **共享 worker**:`opencode run` 子进程,OS 级进程隔离。

全局并发(`agent.max_concurrent_agents`)封顶 Jira worker 的 `opencode run` 子进程数。飞书直连会话走**独立**预算(`feishu.direct.max_concurrent`,默认 5),交互式 `/chat` 不会排在 Jira 队列之后;因此机器上的子进程总数可达两者之和。

`feishu.direct.verbosity: detailed`（默认）时每个 turn 会发一张可原地更新的**轮次卡片**(Turn card):会话状态头部 + 工具调用的折叠面板(失败默认展开)+ 控制按钮;turn 结束时该卡被封存(按钮行换成一行统计),下一轮另发一张。卡片是**过程面**,每 turn 那条完成文本是**结果面**(可引用、可搜索)。两个平台约束驱动了这个形态:飞书单卡上限 30KB 且更新为整卡替换,所以卡片按轮拆分并在单轮内做预算降级;卡片更新与话题内新消息都不产生推送通知,通知由飞书自身的会话语义负责。

卡片按钮(中断/重试/完整输出/结束)经事件通道的 `card.action.trigger` 回调进入,走**独立快路径**——不排入消息入站队列,处理函数内只做快速状态变更并返回 `toast + 新卡片`(WS 长连接下 handler 的返回值就是回调响应,即卡片更新),慢操作(删除 opencode 会话、发送结果文本、上传文件)在响应之后异步执行。卡片不可用(回调失败/端口不支持)时降级为合并文本投递。

数据面边界:卡片是**飞书话题内的视图**(每轮一张,按 30KB 预算裁剪),TUI 的 activity 视图(`direct:<root_id>`)是**本地完整事件流**(内存环形缓冲),两者独立,不互相依赖;`📄 完整输出` 从本轮的内存累积器取数并作为文件附件投递。

## 共享 Task 模型

无论来源,所有任务归一化为统一的 `Task` 实体:

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | tracker 内部稳定 ID |
| `identifier` | string | 人类可读标识(如 `ENG-42`) |
| `title` | string | 标题 |
| `description` | string\|null | 描述 |
| `priority` | number\|null | 优先级(数字越小越优先;非整数变 null) |
| `state` | string | 当前状态名 |
| `branch_name` | string\|null | 分支元数据 |
| `url` | string\|null | 链接 |
| `labels` | string[] | 标签(已小写化) |
| `blocked_by` | BlockerRef[] | 阻塞关系(含 id/identifier/state) |
| `created_at` | number\|null | 创建时间(ms) |
| `updated_at` | number\|null | 更新时间(ms) |
| `source` | `"jira"`\|`"feishu"` | 任务来源 |

Jira 归一化:`labels` 修剪并小写;`priority` 仅整数;`blocked_by` 从 issue link 派生;时间戳从 ISO-8601 解析。（route agent 产出的 `Task` 为规划路径，未实现。）

## worker 子进程隔离

每个任务 attempt 以独立 `opencode run` 子进程执行:

```bash
opencode run --format json --auto --dir <workspace> --agent <build> "<rendered prompt>"
```

- **OS 级隔离**:每个 worker 是独立进程,cwd 为 per-task 工作区路径。
- **权限放行**:默认追加 `--auto` 标志(`opencode.auto_approve: true`),自动放行未被 `.opencode/opencode.json` 显式拒绝的权限请求,适配无人值守运行。设为 `false` 时 agent 遇到权限确认会 hang 到 turn timeout。
- **JSON 事件流**:所有 `opencode run` 调用使用 `--format json`,从结构化事件流中提取 session ID 与 token 用量。
- **有界 session 续轮循环(对齐 Symphony 模式)**:worker 内 turn 1 用完整 prompt 创建 opencode session;turn 2+ 使用 `-s <sessionID>` 续接同一 session(agent 跨 turn 保持完整对话上下文)。worker 退出后,continuation retry 创建**全新 session**(不传旧 session ID),agent 从 `git log`/文件系统重新评估进度——避免对话历史膨胀和错误沿袭。每次成功后重新检查 tracker 状态,若仍活跃且未达 `max_turns`,启动续轮调用。
- **session 生命周期管理**:turn 1 创建 session 并写入 workspace sidecar 文件(`.tasking-session.json`);turn 2+ 续接同一 session;continuation retry 全新 session;任务进入 terminal 状态触发工作区清理时,从 sidecar 读取 last session ID 执行 `opencode session delete`。
- **attempt 生命周期**:经历 `preparing_workspace` → `building_prompt` → `launching_agent` → `finishing`,终态为 `succeeded`/`failed`/`timed_out`/`stalled`/`canceled_by_reconciliation`。
- **失败分类**:墙钟超时(`turn_timeout_ms`)→ `timed_out`(`turn_timeout`);不活跃超时(`inactivity_timeout_ms`)→ `timed_out`(`inactivity_timeout`);子进程异常退出 → `failed`;停滞(scheduler 检测)→ `stalled`。
- **三层超时模型**:不活跃超时(10min,subprocess 层,stdout/stderr 无数据即杀)→ 墙钟超时(1h,绝对上限,到点必杀)→ 停滞超时(2h,scheduler 层,worker 整体卡死兜底)。三层独立运行,先触发者先终止子进程。不活跃和墙钟在 subprocess 内先发 SIGTERM(仅父进程),10s 宽限未退出则升级为进程组 SIGKILL(与 `tasking stop` 的 daemon 终止节奏一致,见 ADR 0020);停滞在 scheduler 层通过 AbortSignal 直接进程组 SIGKILL。
- **token 提取**:从 `opencode run --format json` 的 `step_finish` 事件累加 `part.tokens`;不可用时回退到进程级计时。
- **工作区保留**:成功 attempt 后不删除工作区,供后续续轮复用。

启动 worker 前,强制三条安全不变式(见下文)。

## 状态持久化与重启恢复

`tasking` 刻意区分两类状态的持久性:

### 调度状态:内存,不跨重启

编排器的 `OrchestratorRuntimeState`(`running`、`claimed`、`retry_attempts`、`completed`、聚合总量)仅存于内存进程内。**重启后不恢复**:
- 无 retry timer 跨重启存活。
- 无运行中会话跨重启假定可恢复。

重启恢复策略(Symphony 验证过的模型):
1. 启动时查询 tracker 中终端状态任务,删除对应工作区(terminal 清理)。
2. 重新轮询活跃任务,作为新 attempt 重新派发。
3. 复用已保留的 per-task 工作区目录。

### inbox:SQLite,跨重启

> **未实现**：非结构化 triage 的 inbox（下述 SQLite 持久化队列）为设计稿，无运行时代码。

这是相比 Symphony 的唯一持久化增量——Symphony 没有 inbox,因为它是单源(Linear)的。

## Feishu↔Jira 评论桥:事件驱动入站

CommentBridge(scheduler 的 sibling 组件)把 issue 话题与 Jira 评论双向镜像。入站(飞书→Jira)走**事件通道**:官方 SDK 的 WS 长连接订阅 `im.message.receive_v1`,事件实时进入单一入站队列(msg_id 先到先得 claim,单消费者串行);REST 轮询保留为 **Sweep 兜底清扫**——启动时、WS 重连时、`sweep_interval_ms`(默认 12h)各按持久游标补拉一次,覆盖断线/停机窗口。出站(Jira→飞书)按 `forward_interval_ms` 快循环轮询。桥遇到飞书 429 进入冷却(60s 起翻倍封顶 10 分钟),期间发送跳过、游标 hold、事件接收不受影响。WS 长连接需一次性在开发者后台配置事件订阅;同一应用仅允许单实例在线(见 [ADR 0018](../adr/0018-event-driven-feishu-ingress.md))。

## 重试与退避

- **正常退出 → 续轮 retry**:worker 正常退出后,调度器调度一次短续轮 retry(attempt 1,固定 1000ms 延迟),以重新检查任务是否仍需处理。
- **异常退出 → 指数退避 retry**:延迟为 `min(10000 * 2^(attempt-1), agent.max_retry_backoff_ms)`,受 `max_retry_backoff_ms`(默认 300000ms / 5 分钟)封顶。
- **retry 处理**:retry timer 触发时重新拉取活跃候选;任务缺失或不再活跃则释放认领;无槽位则递增 attempt 重新入队(原因 `no available orchestrator slots`);符合条件则派发。

## 安全不变式

三条非协商的文件系统安全不变式,启动 worker 前强制校验:

1. **agent cwd == 工作区路径**:worker 子进程的 cwd 必须等于当前任务的 per-task 工作区路径。不匹配则中止 attempt。
2. **工作区路径位于 root 内**:工作区路径与工作区 root 都规范化为绝对路径,要求工作区路径以 root 为前缀目录。路径逃逸(如经 `..` 遍历)则拒绝。
3. **工作区 key 已清洗**:工作区目录名仅允许 `[A-Za-z0-9._-]`,其他字符替换为 `_`。

此外:
- **hook 脚本完全受信**:`WORKFLOW.md` 的 hook 以 `bash -lc` 在工作区目录执行任意 shell,受 `hooks.timeout_ms` 约束(默认 60s)。hook 超时产生 `hook_timeout` 错误类别。仅版本控制来自可信来源的 hook。
- **symlink 安全**:`isWithinRoot` 使用 `realpathSync` 解析符号链接后做前缀匹配,拒绝 symlink 逃逸。workspace == root 被拒绝。
- **编排器不写 tracker**:工单变更(状态转换、评论)由 coding agent 通过其工具完成,编排器只读不写。
- **API token 不入日志**:`$VAR` 间接引用保持密钥不写入 `WORKFLOW.md`;日志不记录 token 值。

## 可观测性

### 结构化日志

JSON 行格式输出到 stderr 和可选文件 sink(10MB×5 轮转)。必填上下文字段:`task_id`、`task_identifier`、`session_id`。详见 `docs/logging.md`。

### HTTP 仪表板

`--port` 或 `server.port` 启用。端点:
- `GET /` — HTML 仪表板
- `GET /api/v1/state` — 全局状态 JSON(含 `codex_totals`、ISO 8601 时间戳)
- `GET /api/v1/config` — 当前有效配置 + 运行时属性(密钥脱敏为 `****`)
- `GET /api/v1/<identifier>` — 单 issue 详情(含 `agent`/`model`/`variant`)
- `GET /api/v1/<identifier>/activity?limit=N` — 该运行中任务的 opencode 活动事件流(助手文本/工具调用/step tokens,近实时,1Hz 轮询;`tool_use` 事件携带执行详情字段)
- `POST /api/v1/refresh` — 触发立即 poll + reconcile(返回 `{queued, coalesced, operations}`)

不支持的方法返回 `405 Method Not Allowed`。绑定地址通过 `server.host` 配置(默认 `0.0.0.0`)。

### 终端 TUI 状态面板

`--tui` 启用。ANSI 彩色终端渲染,定时(1s)拉 snapshot 重绘。包含:
- 汇总栏(agents/tps/runtime/tokens)
- 运行中任务表格(ID/STATE/AGE/TURN/TOKENS/SESSION/EVENT)
- 退避队列(标识符/attempt/倒计时/error)
- sparkline 吞吐量图(10 分钟窗口,24 列)
- 最近日志(内存环形缓冲,最近 6 条,按 level 着色)
- 配置视图(按 `c` 进入):有效配置 + 运行时属性,密钥脱敏,`j`/`k` 滚动
- 活动视图(任务详情页按 `a` 进入):渲染该运行中任务的 opencode 交互流(助手文本、工具调用一行摘要 `🔧 <工具> · <命令/文件>`、失败 `✗` 红色标记、step token 增量)与当前 `model`/`agent`/`variant`,近实时;`Enter` 展开——工具调用显示结构化执行详情(状态/退出码、命令/参数、输出、耗时,超长输出尾部截断),`j`/`k` 滚动,`Space`/`f` 暂停跟随,`Esc`/`q` 返回详情
- 节流去重(内容无变化不重绘)

配置视图数据来自 daemon 侧的有效配置(`ConfigManager.current` / `GET /api/v1/config`),而非本地原始 WORKFLOW.md——保证热重载与默认值/环境变量展开后所见即所运行(ADR 0005)。进程内 TUI(`start --tui`)直接读内存配置;附加 TUI(`tasking tui`)经 `/api/v1/config` 拉取同一份脱敏数据。`.tasking/daemon.json` 元信息含 `pid`、`port`(实际绑定端口,`--port 0` 时为临时端口)、`host`、`started_at`、`workflow_path`,供 `status`/`tui`/`stop` 在当前目录定位 daemon。

TUI 启用时,日志仅写文件 sink(不写 stderr),避免争抢终端。

### Pub/Sub 通知

Scheduler 继承 `EventEmitter`,在 dispatch/workerExit/retry/reconcile 时 emit 事件。HTTP 仪表板和 TUI 可订阅以触发刷新。

## 设计出处

本架构移植自 [Symphony](https://github.com/openai/symphony) SPEC,做了三个替换(Linear→Jira、Codex app-server→`opencode run`、Elixir→TypeScript)并规划一个增量(route agent + inbox，**未实现**)。完整设计决策见 `openspec/changes/bootstrap-tasking-runtime/design.md`。
