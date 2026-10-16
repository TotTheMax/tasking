# Token 记账规则

> **0.7 更新**：token 来源已从 `opencode run --format json` 事件流改为轮询 v2 会话消息（`session.message.list` / `session.get`）。v2 的 tokens 为 `{input, output, reasoning, cache}`（**无 `total`**），合计口径 = `input + output + reasoning`，cache 单列（ADR 0037）。下文事件流模型对应 0.6.x。

> 适配 tasking 的 `opencode run --format json` 事件模型。

## 基本原则

tasking 从 `opencode run --format json` 的 stdout 解析事件流,提取 token 用量。

### 事件类型与 token 来源

| 事件类型 | token 字段 | 用途 |
|---|---|---|
| `step_finish` | `part.tokens.{input, output, total}` | 每个 step 的 token 用量 |

`step_finish` 上报的是单次请求用量,其中 `total = input + output + reasoning + cache.read + cache.write`;每次请求都会重读整个会话上下文,因此 `total` 随请求单调增长。tasking 有意对这些原始 `total` 求和用于成本记账(cache 重读同样计费),见 ADR 0013。

### 经 `step_usage` 实时累计

worker 对每个携带 tokens 的 `step_finish` 事件上报一个 `step_usage` worker 事件。scheduler 每收到一个 `step_usage` 立即累计到运行中 entry,使 per-task token 在 **turn 进行中** 就实时更新(而非仅在 turn 结束)。`turn_completed` 不再携带 `usage`,保证一个 turn 的 token 只计一次——其所有 `step_usage` 之和等于该 turn 的 `extractSessionAndUsage` 总量。

### 会话级持久化

每次 turn 结束后,累计 token 写入 workspace 的 `.tasking-session.json` sidecar(与 `session_id`/`turn_count` 同文件)。scheduler 派发时从 sidecar 恢复到新建的运行 entry,使重试与 daemon 重启后仍保留会话生命周期累计值而非清零。旧版 sidecar 无 token 字段时按 0 恢复。

### 聚合总量

- **运行中 entry**: `entry.input_tokens`/`output_tokens`/`total_tokens` — 由 `step_usage` 实时累计、派发时从 sidecar 恢复,供快照展示
- **全局总量**: `state.totals.*` — worker 退出时从 `AttemptResult.usage` 累加

### 与 Symphony 的差异

Symphony 从 Codex app-server 事件流提取多种 token 载荷(`thread/tokenUsage/updated`、`turn/completed` usage、`codex/event/token_count`),并区分绝对值(`total_token_usage`)和增量(`last_token_usage`)。tasking 使用 `opencode run` 的一次性 stdout,只有 `step_finish` 事件携带 token,模型更简单:每个 `step_finish` 的 token 报告都视为增量并累加。