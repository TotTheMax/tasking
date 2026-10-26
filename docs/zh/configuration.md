# 配置参考

本文档逐块说明 `WORKFLOW.md` 的全部配置字段、默认值、解析规则与动态重载语义。字段名保持英文原文。

## `WORKFLOW.md` 格式

`WORKFLOW.md` 是一个 Markdown 文件,由 **YAML front matter**(配置)+ **prompt body**(prompt 模板)组成。

```markdown
---
<paste YAML front matter here>
---

<prompt body, e.g. {{ task.identifier }}>
```

### 解析规则

- 文件以 `---` 开头时,到下一个 `---` 之间为 YAML front matter;之后为 prompt body。
- 无 front matter 时,整个文件视为 prompt body,配置为空对象。
- front matter 必须解析为一个 YAML 对象(map);非 map 为错误(`workflow_front_matter_not_a_map`)。
- prompt body 在使用前修剪首尾空白。
- front matter 不存在时配置为空 map,使用全部默认值。

### 空 body 回退

prompt body 为空(或仅空白)时,运行时回退为默认 prompt:`You are working on an issue from the tracker.`。

**重要**:文件读取/解析错误(`missing_workflow_file`、`workflow_parse_error`)**绝不**回退,而是阻止启动。

### 模板变体

`tasking init` 通过 `--workflow` 选择 starter 模板,三者 **同一 config schema**(front matter 字段集一致),仅 prompt body 不同:

| `--workflow` 值 | 模板文件 | prompt body | 安装的技能 |
|-----------------|----------|-------------|------------|
| `feishu-direct`(**默认**;裸 `tasking init` 即是) | `assets/workflows/WORKFLOW.feishu-direct.md.example` | **唯一以配置区分的变体**:`tracker.kind: none` + 飞书启用——直连专用部署;prompt body 仅为哨兵 + 两行用户说明(直连会话以用户消息为 prompt;想接 Jira 重跑 init) | 无 |
| `minimal` | `assets/workflows/WORKFLOW.minimal.md.example` | 最小:转"处理中"→在工作目录完成任务→上传结果到 Jira(comment＋附件)→转终态。无 git 分支/MR/glab、无 review 暂停 | 无 |
| `code-mr` | `assets/workflows/WORKFLOW.code-mr.md.example` | 全-MR:转"处理中"→写代码→建 MR→review→合并。含增量修复/全量重置/合并三路 | `land` + `install-glab` |
| `grill-openspec` | `assets/workflows/WORKFLOW.grill-openspec.md.example` | 四阶段:grill(拷问+发 comment→review,不建 MR)→实施(propose+implement+建 MR)→合并(land+archive),含运行中升级通道 | `land` + `install-glab` + 4 opsx |

每个非 `minimal` 变体的模板 prompt body 携带哨兵标记供 `--update` 探测:`grill-openspec` 含 `## 🔍 拷问 / Grill Questions`,`code-mr` 含 `<!-- tasking-workflow: code-mr -->`,`feishu-direct` 含 `<!-- tasking-workflow: feishu-direct -->`(最优先),`minimal` 无标记(兜底)。`detectWorkflow` 按优先级四路探测,不做遗留启发式——无标记的 body 一律落 `minimal`。

### 模板语言

每个变体另有英文版,经 `--lang <zh|en>` 选择(默认 `zh`;上表所列中文文件为规范原版)。同一变体的两种语言共享相同 config schema、协议哨兵与安装技能——仅注释/引导文案不同:

| `--lang` 值 | 模板文件(依次对应 feishu-direct / minimal / code-mr / grill-openspec) | 哨兵 |
|------|------|------|
| `zh`(默认) | `assets/workflows/WORKFLOW.feishu-direct.md.example` / `assets/workflows/WORKFLOW.minimal.md.example` / `assets/workflows/WORKFLOW.code-mr.md.example` / `assets/workflows/WORKFLOW.grill-openspec.md.example` | 无(兜底;feishu-direct 有自己的变体哨兵) |
| `en` | `assets/workflows/WORKFLOW.feishu-direct.en.md.example` / `assets/workflows/WORKFLOW.minimal.en.md.example` / `assets/workflows/WORKFLOW.code-mr.en.md.example` / `assets/workflows/WORKFLOW.grill-openspec.en.md.example` | prompt body 顶部 `<!-- tasking-workflow-lang: en -->` |

状态名占位值(如 `active_states` 下)属用户需按实际 Jira 修改的配置值,英文模板保留原样并加英文注释提示。`init --update` 用同一哨兵探测语言,漂移报告对同语言模板比对;可用 `--lang` 显式覆盖。见 ADR 0013。

`--lang` 同时决定 `interface_language` 种子:选 `en` 时生成的 WORKFLOW.md 写入 `interface_language: en`,选 `zh`(默认)时省略该字段(默认值,遵循"只写非默认字段"的裁剪规则)。

`grill-openspec` 与 `code-mr` 的阶段/重派路由全部在 prompt body 内由 agent 自判(产物为主 + 状态语义 + Jira comments/glab 兜底),不硬编码状态名,不改运行时代码。详见 `docs/usage.md` 与 `docs/adr/0001-phase-routing-in-prompt.md`、`docs/adr/0011-three-variant-split-and-marker-detection.md`。

## `tracker` 块

Jira tracker 配置。结构化源。

| 字段 | 类型 | 默认值 | 必需 | 说明 |
|------|------|--------|------|------|
| `kind` | string | — | 是(派发) | tracker 类型,支持 `jira`(结构化源)或 `none`(无 Jira 源——直连专用部署;其余字段被忽略并告警) |
| `endpoint` | string | `https://your-domain.atlassian.net/rest/api/3` | 否 | Jira Cloud REST base URL |
| `api_key` | string\|`$VAR` | — | 是(派发) | API token,支持 `$VAR` 间接引用;规范环境变量 `JIRA_API_TOKEN` |
| `api_user` | string | — | 是(派发) | Basic auth 的 username(email) |
| `auth_mode` | `"basic"` \| `"bearer"` | `"basic"` | 否 | 认证模式。`basic` = email + token；`bearer` = 仅 token (自托管 PAT) |
| `review_state` | string | — | 否 | review 交接态名称 (如 "代码评审中")。此状态不放在 `active_states` 或 `terminal_states` 中，自动成为隐式中间态。注入 prompt 模板供 agent 使用 |
| `project_key` | string | — | 是(派发) | Jira 项目 key(如 `ENG`);与 `project_slug` 至少一个 |
| `project_slug` | string | — | 否 | 项目 slug(备选) |
| `required_labels` | string[] | `[]` | 否 | 任务必须含全部这些标签才派发;匹配忽略大小写与首尾空格 |
| `active_states` | string[] | `["To Do", "In Progress"]` | 否 | 活跃状态;处于这些状态的任务可被派发。建议包含初始态、工作中态、合并态、返工态。不在此列表且不在 `terminal_states` 的状态自动成为隐式 review 态（停 worker 但保留工作区）。详见 [状态流转](./state-flow.md) |
| `terminal_states` | string[] | `["Done", "Closed", "Cancelled", "Canceled", "Duplicate"]` | 否 | 终端状态;任务进入这些状态后停止并清理工作区 |

`api_key` 与 `api_user` 组成 Basic auth(`base64(api_user:api_key)`)。`$VAR` 解析为空字符串时视为缺失。

## `polling` 块

轮询节奏。

| 字段 | 类型 | 默认值 | 必需 | 说明 |
|------|------|--------|------|------|
| `interval_ms` | integer | `30000` | 否 | 轮询间隔(毫秒);变更在运行时重新应用,影响后续 tick 调度,无需重启 |

## `workspace` 块

per-task 工作区。

| 字段 | 类型 | 默认值 | 必需 | 说明 |
|------|------|--------|------|------|
| `root` | path\|`$VAR` | `<系统临时目录>/tasking_workspaces` | 否 | 工作区根目录;支持 `~` 展开、`$VAR` 间接引用;相对路径解析为相对于 `WORKFLOW.md` 所在目录;使用前规范化为绝对路径 |

每个任务的工作区路径为 `<root>/<sanitized_identifier>`,其中标识符中非 `[A-Za-z0-9._-]` 字符替换为 `_`。

## `hooks` 块

工作区生命周期 hook。

| 字段 | 类型 | 默认值 | 必需 | 说明 |
|------|------|--------|------|------|
| `after_create` | string(shell) | `null` | 否 | 仅在新创建工作区目录时运行;失败中止工作区创建 |
| `before_run` | string(shell) | `null` | 否 | 每次 attempt 前运行;失败中止当前 attempt |
| `after_run` | string(shell) | `null` | 否 | 每次 attempt 后运行;失败仅记录,不影响结果 |
| `before_remove` | string(shell) | `null` | 否 | 删除工作区前运行;失败仅记录,继续删除 |
| `timeout_ms` | integer | `60000` | 否 | 适用于全部 hook 的超时(毫秒);非法值导致配置校验失败 |

hook 以 `bash -lc <script>` 在工作区目录(cwd)中执行。多行脚本用 YAML 的 `|` 字面量块表示。

## `agent` 块

worker 并发与重试策略。

| 字段 | 类型 | 默认值 | 必需 | 说明 |
|------|------|--------|------|------|
| `max_concurrent_agents` | integer | `10` | 否 | 封顶 Jira worker 的并发 turn 数。飞书直连会话走独立预算(`feishu.direct.max_concurrent`)。 |
| `max_turns` | positive integer | `20` | 否 | 一次 worker 内 session 续轮调用的上限。turn 1 创建 opencode session,turn 2+ 使用 `-s <sessionID>` 续接同一 session(agent 跨 turn 保持完整对话上下文)。worker 退出后 continuation retry 创建全新 session(agent 从 `git log` 重新评估进度)。设为 `1` 时仅单轮执行。 |
| `max_retry_backoff_ms` | integer | `300000`(5 分钟) | 否 | 失败退避延迟的封顶值 |
| `max_concurrent_agents_by_state` | map<string, positive integer> | `{}` | 否 | 按状态并发上限;状态键小写化;非正数/非数值项被忽略 |

`max_concurrent_agents_by_state` 示例:

```yaml
agent:
  max_concurrent_agents_by_state:
    "In Progress": 3
    "In Review": 2
```

键 `In Progress` 归一化为 `in progress` 查找;未配置的状态回退到全局 `max_concurrent_agents`。

## `opencode` 块

worker 的 opencode v2 驱动配置（tasking 0.7 起要求 `opencode >=2.0 <3`，turn 经 `opencode api` 驱动，见 ADR 0035）。

| 字段 | 类型 | 默认值 | 必需 | 说明 |
|------|------|--------|------|------|
| `command` | string(shell) | `opencode` | 是(派发) | opencode 可执行命令;按空白拆分为命令 + 参数（0.7 起不再包含 `run`） |
| `agent` | string | `build` | 否 | 会话 agent，即 opencode agent profile;作为 per-task 兜底默认 |
| `agents` | string[] | `[]` | 否 | 已知 opencode agent profile 的咨询性目录;非空时供 `/agent` 命令展示并对未知名友好提示,空则不校验(任何 `agent:<name>` 标签直通)。不作为硬白名单 |
| `model` | string\|null | `null` | 否 | `provider/model` 格式;映射会话的 `Model.Ref`。`null` 或空串时用服务端默认模型 |
| `variant` | string\|null | `null` | 否 | provider 特定推理档位(如 `high`/`max`/`minimal`),映射 `Model.Ref.variant`。与 `model` 彼此独立 |
| `turn_timeout_ms` | integer | `3600000`(1 小时) | 否 | 单次 turn 的执行墙钟超时（**等待审批期间暂停**）；超时走中断梯子并标记 `timed_out`(`turn_timeout`) |
| `stall_timeout_ms` | integer | `7200000`(2 小时) | 否 | 停滞检测阈值(scheduler 层);`<= 0` 禁用。等待审批期间不判停滞 |
| `inactivity_timeout_ms` | integer | `600000`(10 分钟) | 否 | 不活跃超时（轮询周期无新消息，**等待审批期间暂停**）；`<= 0` 禁用 |
| `auto_approve` | boolean | `true` | 否 | 会话级权限姿态：`true` 时建会话携带全放 ruleset（工作区 ask 规则被覆盖）；`false` 时听工作区规则——**`ask` 权限会挂起等待审批卡**（v1 的“自动拒绝”语义已废止，见 ADR 0036） |
| `poll_interval_ms` | integer | `2000` | 否 | 轮询间隔（进度/审批/终态均由此节奏读取，见 ADR 0037） |
| `permission_timeout_ms` | integer | `1800000`(30 分钟) | 否 | 审批等待预算；挂起期间接管计时，到点自动拒绝并盖章 |
| `server_url` | string\|null | `null` | 否 | 逃生口：非空时所有 api 调用透传 `--server <url>`；默认自动发现机器共享后台服务 |

worker 的 turn 经 `opencode api` 驱动：首 turn `session.create`（显式 location=工作区、`Model.Ref`、按需全放 ruleset）→ `session.prompt`；进度与终态由轮询 `session.get` / `session.permission.list` / `session.message.list` 取得；超时/中止经 `session.interrupt`。`agent` 每 turn 从任务的 `agent:<name>` 标签(若有)重新解析，回退到 `opencode.agent`，在 turn 边界经会话切换生效；详见 [飞书↔Jira 评论桥](./usage.md) 的 `/agent` 命令与 ADR 0011。

## `router` 块

> **未实现**：该块仅在 resolver 中解析，**无运行时代码**消费（route agent 尚未实现）。模板与 `tasking init` 生成物中整段为注释，仅作预留说明；无需配置。

route agent(非结构化分诊)配置。

| 字段 | 类型 | 默认值 | 必需 | 说明 |
|------|------|--------|------|------|
| `enabled` | boolean | `false` | 否 | 是否启用 route agent |
| `agent` | string | `triage` | 否 | route agent 使用的 opencode agent profile |
| `batch_size` | integer | `20` | 否 | 单次 route agent 运行处理的 inbox 条目上限 |
| `timeout_ms` | integer | `120000`(2 分钟) | 否 | 单次 route agent 运行超时;超时终止,未处理条目保持 `untriaged` |

route agent 同一时刻最多一个运行(除非另行配置),不阻塞结构化调度器。

## `feishu` 块

飞书 ↔ Jira 评论同步桥配置。启用后，飞书话题按 1:1 绑定到 Jira issue，双向镜像评论；人用 `/issue`/`/state`/`/help` 命令在飞书操作。入站用 REST 轮询（无公网端口、零新依赖）。

| 字段 | 类型 | 默认值 | 必需 | 说明 |
|------|------|--------|------|------|
| `enabled` | boolean | `false` | 否 | 是否启用飞书桥；`false` 时即使配置了凭据也不启用 |
| `edition` | string | `feishu` | 否 | 飞书版本：`feishu`（国内版，`open.feishu.cn`）或 `lark`（海外版，`open.larksuite.com`）。决定 REST/事件通道域名与开发者后台深链；非法值启动校验失败 |
| `app_id` | string\|`$VAR` | — | 是(启用时) | 飞书应用 app id |
| `app_secret` | string\|`$VAR` | — | 是(启用时) | 飞书应用 app secret |
| `intake_chat_id` | string | — | 是(启用时) | 承载所有 issue 线程的指定群 chat_id（`GET /im/v1/chats` 取） |
| `forward_interval_ms` | integer | `5000` | 否 | Jira→飞书评论镜像节奏（快循环） |
| `sweep_interval_ms` | integer | `43200000` | 否 | Sweep 兜底清扫节奏（补拉断线/停机窗口），启动与 WS 重连时也会触发 |
| `create_issue_type` | string | — | 是(启用时) | `/issue` 默认 issueType（init 时列出项目可用 type） |
| `verification_token` | string\|`$VAR` | — | 否 | 事件订阅校验 token（REST 轮询下不用，保留供将来 webhook 模式） |
| `encrypt_key` | string\|`$VAR` | — | 否 | 事件订阅加密 key（REST 轮询下不用，保留） |

旧键 `poll_interval_ms`（≤2026-09-08 版本）已弃用：配置里存在时会被忽略（并记一条 WARN 日志），`forward_interval_ms` 缺省取默认 5000，daemon 正常启动；请更新 WORKFLOW.md 改用新键（见 [ADR 0022](../adr/0022-deprecated-config-key-soft-migration.md)）。

启用但缺失 `app_id`/`app_secret`/`intake_chat_id`/`create_issue_type` 时启动校验失败。飞书应用需授权 scope：`im:message.group_msg`（应用级读群消息，无替代）、`im:message`（发消息与读内容）、`im:chat`（列群/建群）。去重用可见 sentinel `💬 {sender} via 飞书 [msg:{id}]:`（tasking 与 agent 共享 Jira 账号，无法按作者区分）。详见 ADR 0002/0003/0004。

`bindings.db` 不存在（首次运行或换新机器）时，intake 游标为空，桥会通过一次性冷启动探测把游标锚定到飞书自己的时钟——不回看过去 24h、不重建 issue，因此换机器无需迁移 db 文件（见 ADR 0016）。

### `feishu.direct` 子块（直连会话）

飞书直连 opencode 会话配置。`feishu.enabled` 为 true 时直连**默认启用**（本段缺失 = 全默认值，path 模式零配置可用）；段内 `enabled: false` 显式关闭。直连会话绕过 Jira，在固定目录直接跑 opencode（见 ADR 0022/0023）。

| 字段 | 类型 | 默认值 | 必需 | 说明 |
|------|------|--------|------|------|
| `enabled` | boolean | `true`(段存在时) | 否 | 段内显式 `enabled: false` 可关闭直连 |
| `projects` | map（名称 → 路径字符串，或 `{ path, auto_approve }`） | `{}` | 否 | 项目名 → 目录映射；`/chat <项目名> <消息>` 使用。值为对象形态时 `auto_approve` 覆盖全局值 |
| `path_roots` | string[] | `[]` | 否 | ad-hoc path 模式（`/chat /绝对路径 <消息>`）的目录前缀白名单；空 = 不限制 |
| `auto_approve` | boolean | `false` | 否 | 为 true 时会话携带全放 ruleset（自动放行未被显式拒绝的权限）。默认 false：权限姿态由目标目录自己的 `.opencode` 权限配置决定，`ask` 项**挂起等待审批卡**（0.7 起；v1 的“自动拒绝”已废止） |
| `verbosity` | `quiet`\|`summary`\|`detailed` | `detailed` | 否 | 镜像到飞书的事件量级：`quiet` 仅最终回复正文（权限拒绝提示保留）；`summary` 正文 + 一行统计（⏱/🔧/tokens，老客户端环境的显式回退）；`detailed`（默认）为每个 turn 发一张可原地更新的过程卡片（工具明细折叠面板 + 中断/重试/完整输出/结束按钮；失败面板默认展开），turn 结束时再发一张 markdown 结果卡片（标题/表格/代码块正常渲染；超长时改发 `.md` 附件）。折叠面板需飞书/Lark 客户端 >= V7.9，更低版本显示「请升级」占位符（不影响结果投递） |
| `max_concurrent` | integer | `5` | 否 | 直连 turn 的全局并发上限（独立于 Jira 的 `max_concurrent_agents`）；同目录/同会话始终串行 |
| `idle_ttl_ms` | integer | `2592000000`(30 天) | 否 | 空闲多久后把会话标记为 expired（不删除 opencode 磁盘上的 session） |

直连 turn 继承操作者级的 `opencode.agent`、`opencode.model`、`opencode.variant`（非空时映射会话 agent 与 `Model.Ref`），与 Jira worker 一致；目标目录自身的 `.opencode/` 配置仍治理权限/LSP/formatter。

零配置即可用（path 模式）：`feishu.enabled: true` 且无 `direct` 子块时，群里 `/chat /绝对路径 <消息>` 直接可用。要按项目名使用，加两行：

```yaml
feishu:
  direct:
    projects:
      tasking: /home/me/workspace/tasking
```

## `server` 块

可选 HTTP dashboard 扩展。

| 字段 | 类型 | 默认值 | 必需 | 说明 |
|------|------|--------|------|------|
| `port` | integer\|null | `null` | 否 | 启用 HTTP dashboard 的端口;`null` 不启用;`0` 请求临时端口 |

CLI `--port` 参数覆盖此值。默认绑定回环地址 `127.0.0.1`。dashboard 仅用于可观测/控制,不参与正确性。

端点:

| 路径 | 方法 | 说明 |
|------|------|------|
| `/` | GET | 人类可读 dashboard |
| `/api/v1/state` | GET | JSON 运行时状态快照 |
| `/api/v1/refresh` | POST | 触发一次轮询 + 对账(返回 `202`) |

## `interface_language` 顶层字段

界面语言(Interface language):tasking 渲染**自产**界面文案所用语言——飞书回复/toast/卡片标签、CLI 输出(doctor/init/start 报错)、TUI。用户内容与 agent 输出**永不翻译**。

| 字段 | 取值 | 默认 | 说明 |
|------|------|------|------|
| `interface_language` | `zh` \| `en` | `zh` | 缺省为 `zh`,行为与历史版本完全一致;非法取值在配置解析时报错 |

- **热重载即时生效**:daemon 运行中修改该字段并保存,下一条外发消息/下一次渲染即用新语言,无需重启(区别于需要重启的 `tracker.kind`)。
- 翻译经出口字典实现,中文源文案零改动;新增中文文案必须配字典条目,否则 `tests/translate-coverage.test.ts` CI 失败(见 ADR 0031)。
- `tasking start` 无语言覆盖 flag——WORKFLOW.md 是唯一真相源。

## 解析规则

### `$VAR` 间接引用

- 仅对**显式包含** `$VAR_NAME` 形式的值生效。
- `$VAR_NAME` 解析为环境变量 `VAR_NAME` 的值。
- 解析为空字符串时,该值视为**缺失**。
- 环境变量**不全局覆盖** YAML 值;仅当 YAML 值本身是 `$VAR` 形式时才解析。
- `tasking start` / `tasking doctor` 启动时会把 `WORKFLOW.md` 所在目录的 `.env` 文件(若存在)加载进进程环境(已设置的真实环境变量优先,不被覆盖),作为 `$VAR` 的便捷来源;模板见 `.env.example`。

示例:

```yaml
tracker:
  api_key: $JIRA_API_TOKEN   # 解析为 env.JIRA_API_TOKEN
  project_key: ENG            # 原样使用,不解析
```

### `~` 展开

仅对路径字段(如 `workspace.root`)生效:以 `~` 开头时展开为用户家目录。

### 相对路径解析

`workspace.root` 为相对路径时,解析为**相对于 `WORKFLOW.md` 所在目录**(而非当前工作目录)。解析后规范化为绝对路径。

### 默认值应用

可选字段缺失时应用内置默认值(见各块表格的「默认值」列)。必需字段缺失(如 `tracker.kind`、`tracker.api_key`、`project_key`)导致派发校验失败。

## 动态重载

`tasking` 检测 `WORKFLOW.md` 文件变更,无需重启即重新读取并重新应用配置与 prompt 模板。

### 重新应用范围

重载后的配置影响后续派发、retry 调度、reconcile 决策、hook 执行、worker 启动。包括:

- `polling.interval_ms` → 后续 tick 调度。
- `agent.max_concurrent_agents` / `max_concurrent_agents_by_state` → 后续派发决策。
- `tracker.active_states` / `terminal_states` → 后续对账与候选资格。
- `opencode.*` → 后续 worker 启动。
- `workspace.*` / `hooks.*` → 后续工作区创建与 hook。
- prompt 模板 → 后续 attempt 渲染。

**在途 agent 会话**无需自动重启。

### 无效重载行为

- 无效重载(如 YAML 语法错误)**不使 daemon 崩溃**。
- 保留**上一个已知良好配置**继续生效。
- 向运维者发出可见错误(结构化日志,`level=error`)。
- 修复文件后下次重载恢复正常。

## 校验规则

### 启动校验

启动时校验,失败则**阻止启动**(非零退出码)。校验项:

- `WORKFLOW.md` 可加载与解析。
- `tracker.kind` 存在且为支持的值(`jira`);为 `none` 时改走 trackerless 校验:飞书凭证必填、`create_issue_type` 不再必填、并拒绝无任务源的退化组合。
- `$` 解析后 `tracker.api_key` 存在。
- `tracker.project_key` 或 `tracker.project_slug` 存在。
- 飞书桥启用时,`feishu.app_id`、`feishu.app_secret`、`feishu.intake_chat_id`、`feishu.create_issue_type` 存在。

### 每 tick 派发校验

每个 tick 派发前重新校验。失败则:

- **跳过本 tick 的派发**。
- **保留对账**(reconcile 仍运行)。
- 发出运维者可见错误。

这确保配置临时损坏不会停止对运行中任务的对账。

## `server` 块

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `port` | integer/null | `null` | HTTP 仪表板端口。CLI `--port` 覆盖。`null` = 不启动 |
| `host` | string | `0.0.0.0` | HTTP 仪表板绑定地址。设 `127.0.0.1` 仅限本地访问 |

## `logging` 块

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `file.path` | string/null | `null` | 文件日志路径。CLI 启动时默认为 `./tasking.log` |
| `file.max_bytes` | integer | `10485760`(10MB) | 单文件最大字节数,超出后轮转 |
| `file.max_files` | integer | `5` | 轮转备份数 |

## `env` 块

注入 worker 驱动器进程的环境变量。值支持 `$VAR` 间接引用（与 `tracker.api_key` 相同语义），解析为空字符串时注入空字符串值。缺失的 `env` 段默认为空对象。

`config.env` 的值优先于继承的 `process.env`——WORKFLOW.md 显式声明的值覆盖 daemon 进程的环境变量。

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `<KEY>` | string | — | 环境变量名→值映射，值支持 `$VAR` 间接引用 |

示例:

```yaml
env:
  GITLAB_TOKEN: $GITLAB_TOKEN
  GITLAB_HOST: $GITLAB_HOST
```

## CLI 标志

| 标志 | 说明 |
|---|---|
| `--port <n>` / `-p` | HTTP 仪表板端口(覆盖 `server.port`) |
| `--tui` | 启用终端 TUI 状态面板(日志仅写文件) |
