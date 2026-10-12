## 1. Daemon 元信息文件

- [x] 1.1 新建 `src/cli/daemon-info.ts`：`writeDaemonInfo(path, { pid, port, host, started_at })`、`readDaemonInfo(path)`、`removeDaemonInfo(path)`，写入 `.tasking/daemon.json`（JSON 格式）
- [x] 1.2 `src/cli/index.ts`：`runStart` 中 `writePidFile()` 改为 `writeDaemonInfo()`（含 `port`/`host`），`shutdown` 中 `removePidFile()` 改为 `removeDaemonInfo()`
- [x] 1.3 向后兼容：`readDaemonInfo` 在 `daemon.json` 不存在时回退读 `daemon.pid`（仅 PID，无 port）

## 2. start --detach 后台运行

- [x] 2.1 `src/cli/index.ts` `runStart`：`parseArgs` 新增 `detach: { type: "boolean", default: false }`
- [x] 2.2 `--detach` 与 `--tui` 同时使用时报错退出：`"detach and tui are mutually exclusive"`
- [x] 2.3 `--detach` 分支：`spawn(process.execPath, [__filename, "start", ...argsWithoutDetach], { detached: true, stdio: "ignore" })` → `child.unref()` → 输出 `daemon started (pid N)` → `return 0`
- [x] 2.4 非 detach 时走正常前台逻辑（不变）

## 3. status 子命令

- [x] 3.1 `src/cli/index.ts` `runStatus`：`parseArgs` 支持 `--json`（boolean）
- [x] 3.2 读 `daemon.json` → 若有 port 则 `GET http://host:port/api/v1/state` → 格式化输出运行/retry/totals；无 port 则报 PID + "HTTP dashboard 未配置"；无 daemon 则报非零退出
- [x] 3.3 格式化输出：运行中任务（identifier、state、turn_count、elapsed、tokens）、retry 队列（identifier、attempt、due_at、error）、聚合总量（input/output/total tokens、uptime）
- [x] 3.4 `--json` 时直接输出 API 原始 JSON（跳过格式化）
- [x] 3.5 错误处理：daemon.json 存在但进程已不存在 → 报"daemon is not running"并清理；HTTP 请求失败 → 报连接错误

## 4. logs 子命令

- [x] 4.1 `src/cli/index.ts` `runLogs`：`parseArgs` 支持 `--lines`（默认 100）、`--follow`（boolean）、`--level`（string）
- [x] 4.2 无 `--follow` 时：`readFileSync` → split → 取最后 N 行 → 若有 `--level` 则过滤 JSON 行的 `level` 字段 → 打印
- [x] 4.3 `--follow` 时：先输出初始 N 行，然后 500ms 轮询文件从上次 offset 读新内容，`--level` 同样过滤，`SIGINT` 退出
- [x] 4.4 `--level` 过滤逻辑：解析 JSON 行取 `level` 字段，匹配则保留；非 JSON 行始终保留
- [x] 4.5 日志文件不存在 → "no logs found" 非零退出

## 5. stop 子命令

- [x] 5.1 `src/cli/index.ts` 新增 `runStop`：读 `daemon.json` → 取 PID
- [x] 5.2 检查进程存在：`process.kill(pid, 0)` → 不存在则清理 `daemon.json`，报"daemon is not running"非零退出
- [x] 5.3 发 SIGTERM：`process.kill(pid, "SIGTERM")`，轮询等待退出（每 200ms 检查一次）
- [x] 5.4 超时 10s 未退出 → `process.kill(pid, "SIGKILL")`，输出"force killed"
- [x] 5.5 退出后清理 `daemon.json`，以 0 退出
- [x] 5.6 `main` switch 新增 `case "stop": return runStop()`

## 6. tui 子命令

- [x] 6.1 `src/observability/terminal-dashboard.ts` 重构数据源为可插拔：`TerminalDashboardOptions` 新增可选 `fetchSnapshot?: () => Promise<RuntimeSnapshot>`；渲染时优先用 `fetchSnapshot`（async），否则 fallback 到 `buildSnapshot(state())`（sync）
- [x] 6.2 新建 `src/cli/tui-helpers.ts`（或在 `index.ts` 内联）：`httpToSnapshot(json): RuntimeSnapshot` 适配器——HTTP 响应（ISO 时间戳、`codex_totals`）归一化为 `RuntimeSnapshot`（epoch ms、`totals`）
- [x] 6.3 `src/cli/index.ts` 新增 `runTui`：读 `daemon.json` → 若有 port 则创建 `TerminalDashboard`（`fetchSnapshot` 轮询 `GET /api/v1/state`，1s 间隔）→ `tui.start(1000)` → 阻塞等 `SIGINT`/`q` 退出
- [x] 6.4 无 daemon 或无 HTTP 端口 → 报错非零退出
- [x] 6.5 `main` switch 新增 `case "tui": return runTui()`

## 7. triage 隐藏

- [x] 7.1 `USAGE` 文本移除 `triage` 行，新增 `tui` 行
- [x] 7.2 switch 中 `case "triage"` 改为输出 `"triage is not yet available (route-agent not wired)"`，返回 1

## 8. 测试

- [x] 8.1 `tests/cli-commands.test.ts`（新建）：`runStart --detach` → 父进程退出 0，子进程被 spawn
- [x] 8.2 `tests/cli-commands.test.ts`：`runStart --detach --tui` → 报错非零退出
- [x] 8.3 `tests/cli-commands.test.ts`：`runStatus` 无 daemon → 非零退出
- [x] 8.4 `tests/cli-commands.test.ts`：`runStatus` 有 daemon + HTTP mock → 查询 API 并格式化输出
- [x] 8.5 `tests/cli-commands.test.ts`：`runStatus --json` → 输出原始 JSON
- [x] 8.6 `tests/cli-commands.test.ts`：`runStatus` 无 HTTP 端口 → 报 PID + 提示
- [x] 8.7 `tests/cli-commands.test.ts`：`runLogs` 无文件 → 非零退出；有文件 → tail N 行
- [x] 8.8 `tests/cli-commands.test.ts`：`runLogs --level error` → 仅打印 error 级别行
- [x] 8.9 `tests/cli-commands.test.ts`：`runLogs --follow` → 轮询新内容
- [x] 8.10 `tests/cli-commands.test.ts`：`runStop` 无 daemon → 非零退出；有 daemon → 发 SIGTERM 并清理
- [x] 8.11 `tests/cli-commands.test.ts`：`runStop` 超时 → SIGKILL
- [x] 8.12 `tests/cli-commands.test.ts`：`runTui` 无 daemon → 非零退出
- [x] 8.13 `tests/cli-commands.test.ts`：`runTui` 有 daemon + HTTP mock → 创建 TerminalDashboard 并轮询
- [x] 8.14 `tests/cli-commands.test.ts`：`httpToSnapshot` 适配器——ISO→epoch、`codex_totals`→`totals` 字段映射正确
- [x] 8.15 `tests/cli-commands.test.ts`：`triage` → 输出 not yet available + 非零退出；`--help` 不含 triage 含 tui
- [x] 8.16 `tests/regression.test.ts`：daemon.json 向后兼容——旧 `daemon.pid` 文件仍可被 `readDaemonInfo` 读取

## 9. 文档

- [x] 9.1 `docs/usage.md`：更新 CLI 子命令章节，补充 `--detach`/`stop`/`tui`/`status`/`logs` 的实际行为与参数，移除 `triage` 文档
- [x] 9.2 运行 `npm run lint && npm run typecheck && npm test` 全部通过
