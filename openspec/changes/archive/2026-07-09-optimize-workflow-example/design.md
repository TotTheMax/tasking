## Context

`WORKFLOW.md.example` 和 `src/cli/init.ts` 的 starter 模板是用户首次接触 tasking 配置的入口。当前两处模板均缺少已实现的配置字段，且无注释帮助理解。

缺失字段对比:

| 字段 | example | init starter | config-types 定义 |
|---|---|---|---|
| `tracker.auth_mode` | ✗ | ✓ | ✓ |
| `tracker.review_state` | ✗ | ✓ | ✓ |
| `tracker.assignee` | ✗ | ✗ | ✓ (新增) |
| `tracker.project_slug` | ✗ | ✗ | ✓ |
| `hooks.after_run` | ✗ | ✗ | ✓ |
| `hooks.before_remove` | ✗ | ✗ | ✓ |
| `server.host` | ✗ | ✗ | ✓ (新增) |
| `logging.file` | ✗ | ✗ | ✓ (新增) |

## Goals / Non-Goals

**Goals:**
- `WORKFLOW.md.example` 包含全部配置块和字段，每字段有内联注释
- `init.ts` starter 模板同步补全缺失字段
- 两处模板字段一致，注释风格统一
- prompt body 包含 `jira_rest`/`jira_upload_attachment` 工具指引(与 init.ts 已有内容对齐)

**Non-Goals:**
- 不改变配置解析逻辑
- 不新增配置字段
- 不改变 prompt 渲染引擎

## Decisions

### 决策 1:注释用 YAML 内联 `#` 注释
YAML 原生支持 `#` 行注释，无需额外格式。每个字段后加 `# 说明` 注释，必填字段标注 `(必填)`。

### 决策 2:init 生成的 WORKFLOW.md 直接带注释
`tasking init` 输出的 WORKFLOW.md 和 `WORKFLOW.md.example` 内容一致（含全部字段+注释+prompt body）。不再区分"参考模板"和"起步模板"——用户跑完 `init` 拿到的就是完整的、可编辑的、带注释的配置文件。`init.ts` 直接引用 `WORKFLOW.md.example` 的内容，消除两份模板的维护负担。

### 决策 3:init.ts 读取 WORKFLOW.md.example 而非内联模板
`init.ts` 不再内联 `STARTER_WORKFLOW` 字符串，改为 `readFileSync` 读取 `WORKFLOW.md.example`。这样模板只维护一份，字段和注释的修改自动同步到 `tasking init` 输出。

### 决策 4:默认值与 config-types.ts DEFAULTS 对齐
example 中展示的值 SHALL 与 `config-types.ts` 的 `DEFAULTS` 一同规划：

| 字段 | example 值 | 代码默认值 | 说明 |
|---|---|---|---|
| `tracker.kind` | `jira` | (无默认，必填) | 仅支持 jira |
| `tracker.endpoint` | 占位 URL | `https://your-domain.atlassian.net/rest/api/3` | 自托管 Jira 需改为实际地址 |
| `tracker.api_key` | `$JIRA_API_TOKEN` | null | 用 $VAR 引用，不写明文 |
| `tracker.api_user` | `you@example.com` | null | basic auth 必填；bearer 模式可省略 |
| `tracker.auth_mode` | `basic` | `basic` | `basic`=email+token, `bearer`=token only |
| `tracker.review_state` | `null` | null | 代码任务完成后的交接态名(如"处理中") |
| `tracker.project_key` | `ENG` | null | 必填，Jira 项目 key |
| `tracker.project_slug` | `null` | null | project_key 的替代，二选一 |
| `tracker.assignee` | `null` | null | 按指派人过滤；`"me"`=currentUser() |
| `tracker.required_labels` | `[]` | `[]` | 空=不过滤；如 `["tothemax"]` |
| `tracker.active_states` | `["To Do", "In Progress"]` | 同左 | 候选状态；自托管 Jira 可能是中文 |
| `tracker.terminal_states` | `["Done", "Closed", "Cancelled", "Canceled", "Duplicate"]` | 同左 | 终态 |
| `polling.interval_ms` | `30000` | `30000` | 30 秒轮询 |
| `workspace.root` | `~/tasking_workspaces` | `tasking_workspaces`(相对) | `~` 展开；相对路径基于 WORKFLOW.md 目录 |
| `hooks.timeout_ms` | `60000` | `60000` | 60 秒 |
| `hooks.after_create` | `null` | null | 仅新工作区创建时运行 |
| `hooks.before_run` | `null` | null | 每次 attempt 前运行 |
| `hooks.after_run` | `null` | null | 每次 attempt 后运行 |
| `hooks.before_remove` | `null` | null | 工作区删除前运行 |
| `agent.max_concurrent_agents` | `10` | `10` | 全局并发上限 |
| `agent.max_turns` | `20` | `20` | 同一 worker 内 turn 上限 |
| `agent.max_retry_backoff_ms` | `300000` | `300000` | 退避上限 5 分钟 |
| `agent.max_concurrent_agents_by_state` | `{}` | `{}` | 按状态限并发，如 `{"in progress": 2}` |
| `opencode.command` | `opencode run` | `opencode run` | |
| `opencode.agent` | `build` | `build` | opencode agent profile |
| `opencode.turn_timeout_ms` | `3600000` | `3600000` | 单 turn 超时 1 小时 |
| `opencode.stall_timeout_ms` | `300000` | `300000` | 停滞超时 5 分钟，`0` 禁用 |
| `router.enabled` | `false` | `false` | 飞书 route agent |
| `router.agent` | `triage` | `triage` | |
| `router.batch_size` | `20` | `20` | |
| `router.timeout_ms` | `120000` | `120000` | 2 分钟 |
| `feishu.enabled` | `false` | `false` | |
| `feishu.app_id` | `$FEISHU_APP_ID` | null | |
| `feishu.app_secret` | `$FEISHU_APP_SECRET` | null | |
| `feishu.verification_token` | `$FEISHU_VERIFICATION_TOKEN` | null | |
| `feishu.encrypt_key` | `$FEISHU_ENCRYPT_KEY` | null | |
| `server.port` | `null` | `null` | `null`=不启动；`8080`=启动 |
| `server.host` | `0.0.0.0` | `0.0.0.0` | `127.0.0.1`=仅本地 |
| `logging.file.path` | `null` | `null` | CLI 启动时默认 `./tasking.log` |
| `logging.file.max_bytes` | `10485760` | `10485760` | 10MB 轮转 |
| `logging.file.max_files` | `5` | `5` | 保留 5 个备份 |

原则：
- example 展示的值 = 代码默认值（用户删掉该字段后行为不变）
- 必填字段（`kind`、`api_key`、`project_key`）用占位值 + 注释标注 `(必填)`
- 密钥字段用 `$VAR` 引用 + 注释说明
- `max_turns` 当前默认 20（与 Symphony 一致），注释中提示"建议起步设 3 避免首次 token 消耗过大"

## Risks / Trade-offs

- **[风险] 注释过多影响 YAML 可读性** → 每字段一行注释，不过度展开；复杂字段(如 `max_concurrent_agents_by_state`)给一个示例即可
- **[权衡] example 和 init 模板内容不完全相同** → example 有注释(参考用)，init 无注释(起步用)，各有侧重
