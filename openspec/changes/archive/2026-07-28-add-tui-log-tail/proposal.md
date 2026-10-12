## Why

TUI 激活后 `suppressStderr()` 关闭了 stderr sink，导致用户在 TUI 界面中完全看不到任何日志输出，必须另开终端执行 `tasking logs -f`。同时 overview 中的 `Rate Limits: unavailable` 是未接线的死功能（Jira DC 不返回限流头），始终显示无意义信息。

## What Changes

- 新增 `LogRingBuffer`：固定大小环形缓冲，作为 logger 的额外 sink，在内存中保留最近 N 条结构化日志
- TUI overview 底部新增 `├─ Logs` 区块，渲染最近 5-8 条日志，按 level 着色（error 红、warn 黄、info 默认、debug 暗灰）
- daemon 创建 logger 时注入 ring buffer sink
- 移除 overview 中的 `Rate Limits: ...` 显示
- 移除 `RuntimeSnapshot.rate_limits` 和 `OrchestratorRuntimeState.rate_limits` 字段及相关死代码（`RateLimits` 接口、`createEmptyRateLimits`、`formatRateLimits`）

## Capabilities

### New Capabilities
- `log-tail-buffer`: 内存环形日志缓冲，供 TUI 进程内读取最近日志条目

### Modified Capabilities
- `terminal-dashboard`: overview 新增 Logs 区块；移除 Rate Limits 显示
- `observability`: logger 支持注入 ring buffer sink

## Impact

- `src/observability/log-buffer.ts`（新文件）
- `src/observability/terminal-dashboard.ts`（新增 logs 区块、移除 rate limits）
- `src/observability/logger.ts`（无需改动，sink 架构已支持）
- `src/cli/daemon.ts`（创建 logger 时注入 buffer sink）
- `src/shared/types.ts`（移除 `RateLimits`、`rate_limits` 字段）
- `src/observability/http-dashboard.ts`（移除 `rate_limits` 序列化）
- `src/observability/snapshot.ts`（移除 `rate_limits` 映射）
- 相关测试文件更新
