# Design: Feishu 直连专用部署——Jira 源开关

## Context

直连会话（ADR 0022）是 `CommentBridge` 的"寄居兄弟"：`DirectSessionManager` 本身零 tracker 依赖，但 `/chat` 入口路由写在桥里、桥构造需要 tracker、启动校验无条件强制 tracker、`runStart` 无条件构造 Jira 管线。本 change 依据拷问达成的共识（Q1–Q9，见 proposal 与 ADR 0026）落地"桥内开关"方案（C），不抽 FeishuIngress（D）。

## Goals / Non-Goals

**Goals:**
- `tracker.kind: none` 的 WORKFLOW.md 能 `tasking start` 并完整使用直连。
- Jira+飞书现有部署零行为变化（全量测试、`test:e2e` 不动如山）。
- Jira 缺席在桥内收敛为**唯一谓词**，为将来 D（抽 ingress）留下现成搬迁边界。

**Non-Goals:**
- 不抽 FeishuIngress（ADR 0026 记为被许可后续，届时"可缺席 Jira 参与者"整体搬迁）。
- 不新增 `feishu.mirror.enabled` 键——镜像可用 ⟺ tracker 存在。
- 不含 init 变体/模板/文档交付（Change ② `feishu-direct-init-variant`）。
- 不支持"桥镜像保留但 Jira 不派发"的中间态（tracker 关 ⇒ 镜像随之不可用，语义从简）。

## Decisions

### 1. 配置表达：`tracker.kind: none`
显式优于隐式（省略块无法与漏配区分）；单轴不矛盾（否决 `enabled: false` 的双轴组合态）。resolver 接受 `"none"` 枚举；tracker 块存在其他字段时 resolver 打 WARN（"在 kind:none 下被忽略"）。

### 2. 校验矩阵（Q3 定案）
- 删除 `opencode.command` 死检查（`DEFAULTS.opencode.command = "opencode run"` 兜底，检查不可能触发）。
- `kind: "none"` 时跳过 tracker 必填项；`kind: "jira"`（或缺省）维持现状。
- `feishu.create_issue_type` 仅 `kind: jira` 时必填；`app_id`/`app_secret`/`intake_chat_id` 不变。
- 退化拒启：① `kind: none` 且 `feishu.enabled: false` → "没有任何任务源"；② `kind: none` 且 feishu 启用但 `direct.enabled: false` → "飞书开着但无事可做"。

### 3. 桥内唯一谓词 = tracker 在场性（Q4+A 修正）
`CommentBridgeDeps.tracker` 类型放宽为可空；桥内**唯一**判定 `private get jiraTracker(): JiraTracker | null`（谓词 = 其在场性）——装配期决定、桥不读 `tracker.kind`，运行中热翻转 kind 双向优雅降级而非崩溃。全桥只允许这一处消费 tracker 可空性：
- `forwardTick` 首行短路（零 Jira 调用；5s 一次 noop 可忽略，换取热重载安全）。
- intake `/issue`、`/state`：命中解析后经谓词路由到现有"未知命令"兜底（**无专用模板**——与 `/help` 裁剪语义自洽："不宣传 ⇒ 即不存在"；直连话题内兜底已是此形态，实测确认）。intake 兜底文案升级为"未知命令。可用：<能力裁剪后清单>"（与直连话题兜底同构）。
- `/help` 帮助卡与文本兜底按能力裁剪：隐藏 `/issue`/`/state`，保留 `/chat`/`/agent`/直连命令。
- 卡片按钮 handler（Jira 动作集：`state_open`/`state_refresh`/`state_summon`/`tr`/`tr_confirm`/`tr_cancel`/`agent_set`/`full`）首判谓词，false → `{ toast: "该操作需要 Jira 任务源" }`——平台入口纪律（外部输入显式降级，不抛异常），非 UX 场景。`full` 修订：它并非纯飞书投递，需从 Jira 取评论全文，故归入 Jira 动作集。
- **零改动**：`/agent`（intake 列表与直连版均无 tracker 依赖）、`full`（纯文件投递）、Sweep（`/chat` 丢失兜底照常；逐绑定部分因无绑定自然为空）。

### 4. 装配：缺席即缺席（Q5 定案）
`runStart` 在 `kind: none` 时：不构造 `JiraTracker`/`Scheduler`；独立 `new ActivityStore()` 供直连 manager 与 dashboard；dashboard/TUI 的 `state` 喂 `createInitialState(...)` 空快照（工厂已存在）；`requestRefresh` 传 no-op；不跑 `startupTerminalCleanup`。**不用 NullTracker**——没有"看起来是 Jira 其实不是"的对象，"日志零 jira 请求"验收天然成立。

### 5. 热重载边界（A 修正）
装配不随热重载重建，因此 reload 回调检测 `tracker.kind` 与启动值不同 → WARN"任务源变更需重启生效"。方向安全性由决策 3 的谓词保证（在场性只减不增：none→jira 翻转后桥仍因 tracker 为 null 而短路）。

### 6. 接缝约定（写给未来的 D）
"Jira 命令组"是桥内**可缺席的参与者**：其全部行为挂在唯一谓词后、共享同一兜底文案路径。D 落地时按谓词切分搬迁（桥构造要求 tracker 非空 → 缺席即不实例化桥 → 谓词消费点整体消失），届时本 change 的 5 处判定收敛为构造期一处。

## Risks / Trade-offs

- **桥被动 → 回归面**：`comment-bridge.ts` 是生产在跑路径。缓解：判定点仅 5 处且全部 dispatch 层；`test:e2e` 硬门禁 + `card-roundtrip` 套件 + 真机 `test:event-flow` 冒烟；Jira 在场路径的行为断言完全复用现有测试。
- **判断点 +5（vs D 的 2–3）**：C 的已知代价，换"不碰生产路径"；接缝约定保证 D 落地时收敛。
- **`create_issue_type` 条件化**可能让旧配置（飞书开、Jira 开、缺 issue type）在 `kind: none` 下不再报错——语义正确（该字段纯 `/issue` 用），但文档需同步（Change ②）。
- **验收口径**：direct-only 启动后日志零 jira HTTP 请求；`/chat` 全链路可用；`/issue`/`/state` 得兜底；Jira+飞书全量回归绿。
