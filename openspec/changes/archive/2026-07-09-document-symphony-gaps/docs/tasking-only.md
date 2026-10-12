# 只有 tasking 有的能力

> 以下能力在 tasking 中存在但 Symphony 参考实现中没有。这些大多源于 tasking 的双源双调度设计(飞书 route agent)和 opencode MCP 集成模型。

## 1. 飞书非结构化任务源

**tasking 位置:** `src/adapters/feishu/`、`src/router/`

飞书 IM 文本消息 @mention 机器人后,幂等接入持久 inbox(SQLite),route agent 按 tick 有界运行,将聊天消息分诊为归一化 `Task` + 派发决策。

Symphony 是单源(Linear),无 inbox/routing 概念。

**增量价值:** 使 tasking 能处理非结构化聊天驱动的工作流,而非仅工单驱动。

## 2. Route agent 分诊

**tasking 位置:** `src/router/route-agent.ts`

route agent 本身通过 `opencode run` 启动,使用 triage agent profile,按 tick 有界运行。通过 `inbox.pop_untriaged`/`inbox.mark_decision`/`feishu.reply` 工具读取、决策、回复。

Symphony 无 LLM 分诊——所有工作都从 Linear 直接拉取。

## 3. Inbox 持久化(SQLite)

**tasking 位置:** `src/router/inbox-store.ts`

非结构化 triage 的 inbox 是 SQLite 文件,`source_msg_id` UNIQUE 键保证幂等接入。未分诊条目跨 route-agent 与 daemon 重启存活。

Symphony 无 inbox——这是相比 Symphony 的唯一持久化增量。

## 4. MCP 配置注入

**tasking 位置:** `src/mcp/inject.ts`、`src/mcp/jira-server.ts`

通过写入 `.opencode/opencode.json` MCP server 配置,在 agent 工作区内暴露 `jira_rest` 和 `jira_upload_attachment` 工具。agent 通过 MCP 协议调用。

Symphony 用 app-server 动态工具协议(`dynamicTools` + `item/tool/call` 回调)暴露 `linear_graphql`——不同的集成模型。

**增量价值:** MCP 是 opencode 原生工具扩展机制,无需实现 JSON-RPC 回调协议。

## 5. `jira_upload_attachment` 工具

**tasking 位置:** `src/mcp/jira-server.ts`

base64 + 手动 multipart/form-data 上传,`X-Atlassian-Token: no-check`,10MB 上限。

Symphony 的 Linear 适配器无附件上传概念。

## 6. `TaskSource` 多源模型

**tasking 位置:** `src/shared/types.ts` `TaskSource = "jira" | "feishu"`

`Task.source` 字段标识任务来源。Jira 归一化与 route agent 产出都生成同一 `Task` 类型。

Symphony 是单源(Linear),无 `source` 字段。

## 7. `trackerStateChecker` worker 内状态检查

**tasking 位置:** `scheduler.ts:216-226`

worker 运行中,每个 turn 结束后通过 `trackerStateChecker` 回调重新 fetch issue 状态,若不再活跃则 worker 自行退出。这是 in-worker 的主动状态检查。

Symphony 的 reconcile 纯粹由 orchestrator 驱动,worker 不自检。

## 8. `spawnRunner` 依赖注入

**tasking 位置:** `scheduler.ts:243`

`SchedulerDeps.spawnRunner` 可选注入,使测试能用 mock 替代真实子进程。

Symphony 的 `AgentRunner.run` 是直接模块调用,测试用 Memory tracker + mock app-server。

## 9. `AttemptStatus` 细粒度状态枚举

**tasking 位置:** `shared/types.ts:37-46`

`preparing_workspace`/`building_prompt`/`launching_agent`/`finishing`/`succeeded`/`failed`/`timed_out`/`stalled`/`canceled_by_reconciliation`。

Symphony 无等效枚举——orchestrator 只看 `:normal` vs 异常退出原因。

## 10. `RetryEntry.continuation` 布尔标记

**tasking 位置:** `shared/types.ts:85`

持久化在 retry entry 上,区分 continuation retry 和 failure retry。

Symphony 用 `metadata[:delay_type] == :continuation`——ephemeral,不存储在 entry 上。

## 11. `AbortController` 协作取消

**tasking 位置:** `scheduler.ts:112-125` `stop()`、`RunningEntry.abort`

graceful shutdown 时 abort 所有运行中 worker + 清所有 retry timer。

Symphony 用 `Process.exit(:shutdown)` 强制 kill——不同模型。

## 12. 多子命令 CLI

**tasking 位置:** `cli/index.ts`

`start`/`status`/`logs`/`triage`/`init` 五个子命令。

Symphony 是单一 escript 入口(`symphony start path-to-WORKFLOW.md`)。

**增量价值:** `init` 生成 starter WORKFLOW.md;`status` 读 pid 文件;`logs` cat 日志;`triage` 手动队列化 route agent。

## 13. Session sidecar 文件 `.tasking-session.json`

**tasking 位置:** `workspace/manager.ts` `writeSessionSidecar`/`readSessionSidecar`

工作区内记录 last session ID,`removeWorkspace` 读取该文件执行 `opencode session delete`。

Symphony 无需 sidecar——app-server 长连接,session 生命周期与进程绑定。

**增量价值:** 解决 `opencode run` 一次性进程模型下 session 清理的问题。
