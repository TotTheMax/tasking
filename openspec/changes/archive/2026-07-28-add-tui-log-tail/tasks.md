## 1. LogRingBuffer 核心

- [x] 1.1 创建 `src/observability/log-buffer.ts`：`LogEntry` 接口（`ts`、`level`、`msg`、`fields`）和 `LogRingBuffer` 类（构造接受 `capacity`，默认 200）
- [x] 1.2 实现 `push(line: string)` 方法：解析 JSON 行为 `LogEntry`，解析失败存原始字符串 level 为 `"info"`，满时覆盖最旧条目
- [x] 1.3 实现 `recent(n: number): LogEntry[]` 方法：返回最近 n 条，按时间升序
- [x] 1.4 编写 `tests/log-buffer.test.ts`：正常 JSON 入缓冲、非法 JSON 入缓冲、满时覆盖、recent 读取、空 buffer 读取

## 2. 移除 rate-limits 死代码

- [x] 2.1 从 `src/shared/types.ts` 移除 `RateLimits` 接口、`createEmptyRateLimits`、`OrchestratorRuntimeState.rate_limits`、`RuntimeSnapshot.rate_limits`
- [x] 2.2 从 `src/observability/snapshot.ts` 移除 `rate_limits` 映射
- [x] 2.3 从 `src/observability/http-dashboard.ts` 移除响应中的 `rate_limits` 字段
- [x] 2.4 从 `src/observability/terminal-dashboard.ts` 移除 `formatRateLimits` 方法和 overview 中的 `Rate Limits` 显示
- [x] 2.5 更新所有引用 `rate_limits` 的测试文件

## 3. daemon 注入 buffer sink

- [x] 3.1 在 `src/cli/daemon.ts` 创建 logger 时实例化 `LogRingBuffer` 并作为额外 sink 注入（与 stderr/文件 sink 并行）
- [x] 3.2 将 buffer 引用传递给 `TerminalDashboard`（通过 options）

## 4. TUI Logs 区块渲染

- [x] 4.1 `TerminalDashboardOptions` 新增可选 `logBuffer?: LogRingBuffer`
- [x] 4.2 `formatOverview` 底部新增 `├─ Logs` 区块：从 `logBuffer.recent(6)` 取条目，按 level 着色（error 红、warn 黄、info 默认、debug 暗灰），显示短格式时间戳 + level + 截断消息
- [x] 4.3 `logBuffer` 未注入时跳过 Logs 区块
- [x] 4.4 编写 TUI 渲染测试：有日志时显示 Logs 区块、无 buffer 时不显示、level 着色正确

## 5. 验证

- [x] 5.1 运行 `npm run lint && npm run typecheck && npm test` 全绿
- [x] 5.2 更新 `docs/architecture.md`（若涉及架构描述变更）
