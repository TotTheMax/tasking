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
