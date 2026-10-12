## Context

TUI 使用 alt-screen 全屏渲染，激活后通过 `suppressStderr()` 关闭 stderr 日志 sink。日志仅写入 `tasking.log` 文件，用户在 TUI 中完全看不到运行时日志。`ConsoleLogger` 已有 sink 数组架构（`sinks: ((line: string) => void)[]`），支持注入额外 sink。

overview 中的 `Rate Limits` 显示依赖 `state.rate_limits`，该字段从未被填充（Jira DC 不返回限流头，worker 也未从 opencode 事件流提取），始终为 `null`，TUI 始终显示 `unavailable`。

## Goals / Non-Goals

**Goals:**
- TUI overview 底部显示最近日志条目，按 level 着色
- 移除 rate-limits 死代码（类型、字段、渲染、序列化）
- 零配置：daemon 启动即自动启用 log tail

**Non-Goals:**
- 全屏 logs 模式（独立滚动/过滤视图）
- 日志级别过滤交互（TUI 按键过滤）
- 从 opencode 事件流提取 rate-limit（功能本身移除）

## Decisions

### D1: LogRingBuffer 作为 logger sink

**选择**：新增 `LogRingBuffer` 类，实现 `(line: string) => void` sink 签名，内部维护固定大小数组。daemon 创建 logger 时将其作为第三个 sink 注入。

**替代方案**：
- TUI 直接 tail `tasking.log` 文件 → 需要 fs.watch/polling，跨平台复杂，且 TUI 可能在远程 HTTP 模式下运行（无文件访问）
- 在 `OrchestratorRuntimeState` 中存日志 → 污染编排器状态，违反"状态面由编排器状态驱动"原则

**理由**：sink 架构已就绪，零侵入；ring buffer 是纯内存结构，无 I/O；HTTP 远程 TUI 模式下可通过 snapshot 扩展传递（未来）。

### D2: buffer 容量 200 条

固定 200 条。overview 仅渲染最近 6 条，但 buffer 保留更多以支持未来全屏 logs 模式。内存开销：200 × ~500B ≈ 100KB，可忽略。

### D3: 日志条目结构化存储

`LogRingBuffer.push(line)` 解析 JSON 行，存储 `{ ts, level, msg, fields }` 结构化条目。解析失败时存原始字符串，level 视为 `"info"`。TUI 渲染时按 level 着色，截断过长消息。

### D4: 移除 rate-limits 全链路

移除 `RateLimits` 接口、`createEmptyRateLimits`、`state.rate_limits`、`snapshot.rate_limits`、HTTP 响应中的 `rate_limits` 字段、TUI `formatRateLimits`。observability spec 中的 "rate-limit 提取" requirement 标记为 REMOVED。

**理由**：从未接线，Jira DC 无此数据，opencode 事件流也未提取。保留死代码增加维护负担和误解。

### D5: TUI 通过 options 传入 buffer 引用

`TerminalDashboardOptions` 新增可选 `logBuffer?: LogRingBuffer`。overview 渲染时若 `logBuffer` 存在则渲染 Logs 区块，否则跳过。保持 TUI 对 buffer 的单向依赖（只读）。

## Risks / Trade-offs

- [高频日志下 ring buffer 覆盖快] → 200 条足够 overview 显示；未来全屏模式可加大
- [JSON 解析开销] → 每条日志一次 `JSON.parse`，daemon 日志频率低（~10/s），可忽略
- [移除 rate_limits 是 breaking change（HTTP API 响应字段消失）] → 该字段从未有值，无消费者依赖
