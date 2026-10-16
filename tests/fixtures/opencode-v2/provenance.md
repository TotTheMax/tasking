# opencode v2 fixtures

| 文件 | provenance | 内容 |
|---|---|---|
| `run-error.ndjson` | captured | v2.0.29 `run --format json --server`，模型端点不可达（provider.auth 403）——NDJSON 封皮与 error 事件形状（`{type,timestamp,sessionID,error{...}}`，sessionID 驼峰） |
| `run-success-text.ndjson` | captured | 纯文本 turn：`step_start` + `text`（part 快照，带 messageID/time） |
| `run-success-tool.ndjson` | captured | 工具 turn 全谱：`step_start → tool_use（state{status,title,metadata.exit,time} 终态快照）→ step_finish（tokens{input,output,reasoning,cache}，**无 total**）→ text`。与 v1 事件名同构，tasking 解析层仅 `total` 需自行求和 |
| `sse-session-created.txt` | captured | `POST /api/session` 触发的 SSE 流：`server.connected`、heartbeat、`session.created`（含 `durable.seq`） |
| `sse-session-lifecycle.txt` | captured | 失败 turn 生命周期（至 step.failed/execution.failed），含两次 `mcp.status.changed {server:"jira"}`（tasking jira-server.js 在 v2 成功挂载的证据） |
| `sse-success-tool-permission.txt` | captured | **成功 turn + 权限全谱 SSE**（35 种事件类型）：增量流（`session.reasoning.delta`/`text.delta`）、终态（`session.tool.called{input}`/`tool.success{content,metadata.exit}`/`step.ended{finish,tokens}`/`usage.updated{tokens,cost}`/`execution.succeeded`）、权限（`permission.asked{id:per_*,action,resources,save 建议,source}` → `permission.replied{requestID,reply:"once"}`） |

| `run-interrupted.ndjson` | captured | turn 运行中经 `opencode api session.interrupt` 中断：30 个命令仅执行 10 个，尾部 `error.type:"aborted"`（与真失败可判别）；run 客户端中断后不退出 |

采集环境：2026-10-14，spike 分支 `spike/opencode-v2-adaptation`，v2.0.29 独立安装（`opencode-v2` wrapper，`OPENCODE_CONFIG_DIR`/`OPENCODE_DB` 沙箱隔离），真实模型 turn（zhipuai-coding-plan/glm-5.3，凭据经 serve 进程 env `ZAI_API_KEY` 注入）；采集方法与脚本见 `openspec/changes/opencode-v2-adaptation/{research.md,capture-live-v2.sh}`。

剩余缺口（低风险）：interrupt × pending permission 联动、Code Mode 下 jira 工具命名、后台任务完成判定——`capture-live-v2.sh` 第 2/3 段可补。

## REST 载荷（`rest/`，captured）

由真实 v2 会话抓取（`opencode api` 调用逐条落盘，见下），供 `tests/helpers/opencode-fixtures.ts` 派生 mock 响应——**mock 的字段名一律来自这些真实载荷**，任何“代码读了 v1 字段名”的错误都会在单测里失败（本目录的建立即当场抓出 `durationMs` 读 `state.time` 而真实在条目级 `time` 的错配）。

| 文件 | 内容 |
|---|---|
| `session-create.json` | `session.create` 响应：`data.{id,projectID,model{id,providerID,variant},cost,tokens{input,output,reasoning,cache{read,write}},time,...}` |
| `session-get-running.json` / `session-get-terminal.json` | `session.get` 响应：运行中（`outcome:null`）与终态（`outcome:"succeeded"`） |
| `message-list-pending.json` | 待审批期间的消息列表：工具条目 `state.status:"running"` |
| `message-list-settled.json` | 完成后的消息列表：assistant 消息（`content[]` 含 `type:"tool"`，`name`、`state.{status,input,content[],metadata.{status,truncated,exit}}`、**条目级 `time.{created,ran,completed}`**）、`tokens`、`time.{created,streamed,completed}`；类型含 `idle/assistant/system/user` |
| `permission-list-pending.json` | `session.permission.list`：`data[{id:"per_…",sessionID,action,resources,save,source{type,messageID,id}}]` |
| `session-active.json` | `session.active`：`data` 为 **sessionID 为键的 map**（`{ "<ses>": {type:"running"} }`） |
| `interrupt.json` | `session.interrupt`：`{interrupted:true}` |
| `session-update.json` | `session.update` 空响应（204 类） |
| `session-remove.json` | `session.remove` 空响应 |

抓取方式：临时工作区（含 `ask` 规则）建会话 → 提交 shell 任务 → 逐项 `opencode api …` 落盘（含待审批、完成、中断、更新、删除）；脚本见 `openspec/changes/opencode-v2-adaptation/capture-live-v2.sh` 的同类做法。
