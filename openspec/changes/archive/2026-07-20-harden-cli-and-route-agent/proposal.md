## Why

CLI 子命令 `status` 只读 PID 文件不查实时状态，`logs` 全量 dump 日志文件，`triage` 是占位空壳且依赖未接线的 route-agent。缺少 `stop` 和 `tui` 子命令。`start` 只能前台运行，无法后台化；`--detach` 后台运行后又无法附加 TUI 查看指标。这些命令需要全面优化为可用状态，同时隐藏尚未就绪的 `triage`。

## What Changes

- `tasking start --detach` 新增后台运行支持：父进程 spawn 子进程后退出，子进程脱离终端独立运行
- `tasking status` 改为通过 HTTP dashboard API 查询运行中 daemon 的实时状态，格式化输出运行任务（标识符、状态、turn 数、elapsed、token）、retry 队列（标识符、attempt、due_at、error）、聚合总量；`--json` 输出原始 API JSON；无 HTTP 端口时回退到 PID 检查
- `tasking logs` 改为 tail 近期日志（默认 100 行，`--lines N` 可配），`--follow` 持续跟踪，`--level debug|info|warn|error` 按日志级别过滤
- 新增 `tasking stop` 子命令：读 daemon 元信息获取 PID，发 SIGTERM 等待优雅退出（超时 10s 后 SIGKILL），清理元信息文件
- 新增 `tasking tui` 子命令：连接运行中 daemon 的 HTTP API，轮询 `GET /api/v1/state` 渲染 TUI 仪表板（复用 `TerminalDashboard` 渲染逻辑），随时可退出不影响 daemon
- 隐藏 `triage` 子命令：从 USAGE 帮助文本移除，switch 中保留但输出"not yet available"提示

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cli-runtime`: 新增 `start --detach` 后台运行、`stop` 子命令、`tui` 子命令需求；细化 `status`/`logs` 与运行中 daemon 的交互方式与输出格式；明确 `triage` 子命令在 route-agent 未接线前的隐藏行为

## Impact

- `src/cli/index.ts` — `runStart` 新增 `--detach` 分支；重写 `runStatus`/`runLogs`，新增 `runStop`/`runTui`，更新 USAGE 文本
- `src/cli/daemon-info.ts`（新建）— daemon 元信息文件读写
- `src/observability/terminal-dashboard.ts` — 重构数据源为可插拔（内存引用或 HTTP 轮询）
- `tests/cli-commands.test.ts`（新建）— CLI 子命令测试（含 detach/tui）
- `tests/regression.test.ts` — daemon.json 向后兼容测试
- `docs/usage.md` — 更新 CLI 子命令文档（含 `--detach`/`tui`）
