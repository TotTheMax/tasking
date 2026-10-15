## Context

spike 分支（`spike/opencode-v2-adaptation`，10 轮实验，v2.0.29 实测）已定案全部技术前提，本文只记决策与理由，事实证据见该分支 research.md 与 `tests/fixtures/opencode-v2/`（实现时拷入 main）。现状：worker 与直连均 spawn `opencode run` 子进程解析 stdout NDJSON；v2 下该路径不可用。访谈 12 问已与用户逐项达成共识。

## Goals / Non-Goals

**Goals:**
- v2-only：Jira 路径行为对齐 v1（`auto_approve: true` 全放体感不变），直连获得同步审批
- 单一驱动路径（api-CLI），不留 run 双轨
- 每片切片可独立验收、测试保持绿

**Non-Goals:**
- 不做 SSE 事件流订阅（轮询快照够用；SSE 为将来增强）
- 不做 daemon 重启"收养"在飞会话（清扫+重试即可，收养留后续）
- 不做 Code Mode（注入 `codemode:false`，将来独立变更）
- 不改直连合并队列语义（本地队列保持，服务端 durable inbox 留后续）
- 不做 @opencode/client 运行时依赖、不自管 serve（用机器共享服务自动发现）

## Decisions

### D1 驱动器形态：`opencode api` 命令 + 轮询

- 提交：`session.create`（携带 `location.directory`、`model:{id,providerID,variant}`、`auto_approve` 时全放 ruleset）→ `session.prompt`
- 轮询循环（`opencode.poll_interval_ms`，默认 2s）：`session.get`（outcome 三态 + tokens）+ `session.permission.list`（pending）+ `session.message.list`（diff 喂 ActivityStore/卡片，工具终态字段在 `content[]` 的 `type:"tool"` 条目）
- 中断梯子：`session.interrupt` → 短宽限 → 杀残留 api 进程（interrupt 后 run 客户端不退出的行为已实测，api 进程同理无害）
- 连接：默认 `opencode api` 自动发现机器共享后台服务；`opencode.server_url` 非空则透传 `--server`。凭据在用户侧（服务进程继承用户认证），tasking 不管理
- 关键陷阱（spike 实证）：所有 session 限定操作必须显式带 `sessionID` 路径参数（location-less 操作会落到服务 cwd 的 T1 陷阱）；`Model.Ref` 字段名是 `id` 非 `modelID`

### D2 版本门禁（中方案）

- `SUPPORTED = >=2.0 <3`（硬拦：拒绝启动，附 `opencode upgrade --major` 指引）；`VALIDATED = 2.0.x`（超出仅友好警告放行——v2 发版快，硬拦小版本会困死用户）
- 落点：doctor 与 `runStart` 共用；启动探活 `server.info` + 认证探测（列模型）
- 两常量集中定义一处；扩 VALIDATED 靠 sdk 契约测试验证后手改

### D3 三层权限模型与 auto_approve

- ①工作区 `.opencode/opencode.json`：用户自有，tasking 只注入 `mcp.servers.jira`（`codemode:false`），永不写 permissions
- ②会话级：`auto_approve: true` → `session.create` 带全放 ruleset（会话 ruleset 覆盖工作区 ask，已实测）；`false` → 不带，听工作区（ask 挂起→审批卡）
- ③逐次：审批卡 `decision: once|always|reject`；`always` 由 opencode 服务端按命令模式持久保存，tasking 不管理其生命周期
- 姿态翻译：`perm_on`/`auto_approve_override:on` → `session.update` 全放（立即生效，不再等下一轮）；`perm_once` → 放开+turn 边界自动收回；`perm` toggle/`/auto off` → ruleset 清空
- Jira 审批卡投放到绑定话题（桥接管线），直连投放到会话话题；话题内所有人可点；回访路径=常驻可重判（已回复/超时原位盖章不删除）

### D4 计时器矩阵

| 状态 | turn_timeout | inactivity | permission_timeout(30min) | stall(2h) |
|---|---|---|---|---|
| 执行中 | 走 | 走（poll diff 时间戳） | — | 走（lastActivity） |
| 挂起等审批 | **暂停** | **暂停** | **接管**，TUI/卡片显示倒计时 | 感知等待态不误杀 |

超时自动 `reject` + 盖章 + turn 继续正常结算；`/stop` 撞挂起 → interrupt + pending 作废（若服务端不自动取消则补发 reject——实现期验证点）。

### D5 重启清扫

daemon 启动时对 sidecar/durable 存储记录的 tasking 会话，经 `session.active` 过滤后逐个 `interrupt`，任务按失败进正常重试。sessionID 持久化沿用 sidecar（Jira）与 `direct_sessions` 表（直连）。

### D6 计费口径

v2 tokens = `{input, output, reasoning, cache{read,write}}`，无 `total`。合计口径：**input+output+reasoning**（cache 读写不计入用量合计，单列展示）——与 v1 `total` 口径最接近且可从轮询数据直接求和。

### D7 测试四层

- 单元/E2E：**假 `opencode` CLI**（`tests/helpers/opencode-mock.ts` 生成可执行脚本 + PATH 注入），剧本=spike fixtures（三态 outcome、pending/回复/超时、interrupt、权限拒绝场景）；驱动器全逻辑离线可测
- 契约：`@opencode/sdk`（devDep，pin 2.0.29）内存运行时断言硬编码 API 形状（operation 名、decision 枚举、Model.Ref 字段）——版本区间扩容的验证工装
- 真机：`INTEGRATION=1` 体系新增 v2 冒烟（本机 wrapper / ljw）
- 回路：审批卡与姿态按钮进 `tests/card-roundtrip.test.ts`（三场景：再点一次/换卡后点/payload 缺字段）

### D8 切片（tasks.md 骨架）

S1 门禁与配置地基 → S2 驱动器 + Jira 切换 → S3 同步审批 → S4 直连切换 → S5 收尾（旧代码删除/TUI 倒计时/双语文档/0.7.0）。

## Risks / Trade-offs

- **轮询 2~3s 快照** vs v1 事件流：展示延迟最坏 +1~1.5s，无流式增量文本——用户知情接受（v1 展示面本有 1s/1.5s 节流；换取每步全量对账的皮实性）
- **未验证小版本放行**：依赖 opencode 小版本加性演进；失败模式为可见报错而非静默，契约测试 + VALIDATED 扩容流程兜底
- **硬编码 API 形状漂移**（decision 枚举/字段名）：契约层捕获；升级时四个常量/形状一处验证
- **等待审批占并发槽 30 分钟**：可观测（倒计时）+ 可配置；Jira 默认 auto_approve 不触发
- 遗留验证点（实现期闭环，均已列 S1/S3 任务）：interrupt 是否自动取消 pending；ruleset 清空（收回）的 API 语义（null vs []）；`codemode:false` 真机生效
