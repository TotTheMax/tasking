## Context

tasking CLI 有 5 个子命令（`init`/`start`/`status`/`logs`/`triage`），但 `start` 只能前台运行（`new Promise(() => {})` 阻塞），`status` 只读 PID 文件不查实时状态，`logs` 全量 dump 日志文件，`triage` 打印一行不触发任何操作。缺少 `stop` 和 `tui` 子命令。`--detach` 后台运行后又无法附加 TUI 查看指标——`TerminalDashboard` 现在是 `runStart` 内部直接读 `scheduler.state`（内存引用），只能跟 daemon 同进程。

HTTP dashboard 已有 `GET /api/v1/state` 端点返回运行中任务、retry 队列、聚合总量的 JSON 快照，可作为 `status` 和 `tui` 的数据源。

## Goals / Non-Goals

**Goals:**
- `start --detach` 后台运行：父进程 spawn 子进程后退出，子进程脱离终端
- `tui` 子命令：连接运行中 daemon HTTP API，轮询渲染 TUI（复用 `TerminalDashboard` 渲染逻辑）
- `status` 完整可用：HTTP API 查询 + 格式化输出 + `--json` + PID 回退
- `logs` 完整可用：tail N 行 + `--follow` + `--level` 过滤
- `stop` 完整可用：SIGTERM + 超时 SIGKILL + 元信息清理
- `triage` 从帮助文本隐藏，调用时提示 not yet available

**Non-Goals:**
- `triage` 子命令完善（依赖 route-agent 接线，单独变更）
- route-agent 计数 bug 修复（单独变更）
- route-agent 接入 daemon tick 循环
- 飞书 webhook HTTP 服务器
- 日志着色/搜索
- `init` 子命令改动
- systemd/launchd/pm2 服务文件生成

## Decisions

### D1: `start --detach` 自我 re-spawn

`--detach` 时父进程用 `child_process.spawn` 重新启动自身（去掉 `--detach` 参数），子进程 `detached: true` + `stdio: "ignore"`，父进程 `child.unref()` 后退出。子进程继承 `process.cwd()` 和环境变量，独立运行前台逻辑。

```
tasking start --detach
  → spawn(node, ["cli/index.js", "start", ...argsWithoutDetach], { detached: true, stdio: "ignore" })
  → child.unref()
  → console.error(`daemon started (pid ${child.pid})`)
  → return 0  (父进程退出)
```

子进程走正常前台流程：写 `daemon.json`、启动 scheduler、阻塞等 SIGINT/SIGTERM。

**替代方案**：`nohup`/`systemd` 外部手段——可用但非原生，`--detach` 提供零依赖的开箱体验。

### D2: CLI↔daemon 通信通过 HTTP dashboard API

`status` 和 `tui` 通过 HTTP dashboard API 与运行中 daemon 交互。`stop` 通过元信息文件读 PID 后直接发信号。

- `status`：读 `daemon.json` → 若有 `port` 则 `GET /api/v1/state` → 格式化输出
- `tui`：读 `daemon.json` → 若有 `port` 则轮询 `GET /api/v1/state` → 渲染 TUI
- `stop`：读 `daemon.json` → `process.kill(pid, "SIGTERM")`

### D3: daemon 元信息文件升级为 JSON

当前 `.tasking/daemon.pid` 仅含 PID 字符串。改为 `.tasking/daemon.json` 写入 `{ pid, port, host, started_at }`，供 `status`/`stop`/`tui` 读取。

**迁移**：`readDaemonInfo` 在 `daemon.json` 不存在时回退读 `daemon.pid`（仅 PID，无 port）。

### D4: `status` 格式化输出

无参数时输出人类可读格式：
```
Tasking Daemon (pid 12345, http://127.0.0.1:8080)

Running: 2
  ABC-123  [处理中]  turn 3  elapsed 45s   in:1.2k  out:3.4k
  DEF-456  [待办]    turn 1  elapsed 10s   in:0.5k  out:0.8k

Retrying: 1
  GHI-789  attempt 2  due in 30s  error: turn 1 exited with code 1

Totals:  in:1.7k  out:4.2k  total:5.9k  uptime: 120s
```

`--json` 时直接输出 API 原始 JSON（管道友好）。

### D5: `logs` tail + follow + level 过滤

- 无参数：`readFileSync` → split → 最后 100 行
- `--lines N`：最后 N 行
- `--level error|warn|info|debug`：按 JSON 日志行的 `level` 字段过滤（非 JSON 行始终保留）
- `--follow`：500ms 轮询，从上次 offset 读新内容，`SIGINT` 退出。与 `--lines` 组合时先输出初始 N 行再 follow

### D6: `stop` 优雅停止 + 强制兜底

1. 读 `daemon.json` → 取 PID
2. `process.kill(pid, "SIGTERM")`（检查进程存在：`process.kill(pid, 0)`）
3. 轮询等待退出，超时 10s → `process.kill(pid, "SIGKILL")`
4. 清理 `daemon.json`
5. 进程不存在时清理过期文件并报告

### D7: `tui` 子命令复用 TerminalDashboard

`tasking tui` 读 `daemon.json` → 获取 host/port → 每 1s 轮询 `GET /api/v1/state` → 渲染 TUI。

`TerminalDashboard` 重构数据源为可插拔：
- **模式 A（in-process）**：`start --tui` 传 `state: () => OrchestratorRuntimeState`，TUI 内部调 `buildSnapshot(state())` 渲染（现有行为不变）
- **模式 B（HTTP remote）**：`tasking tui` 传 `fetchSnapshot: () => Promise<RuntimeSnapshot>`，TUI 每 1s await 该函数获取快照渲染

HTTP API 返回的 JSON 与 `RuntimeSnapshot` 格式有差异（ISO 时间戳 vs epoch ms，`codex_totals` vs `totals`）。`fetchSnapshot` 适配器将 HTTP 响应归一化回 `RuntimeSnapshot`（ISO → epoch，`codex_totals` → `totals`）。

退出时 TUI 不影响 daemon（仅关闭本地终端渲染）。

### D8: `triage` 隐藏

- `USAGE` 文本移除 `triage` 行
- switch 中保留 `case "triage"`，输出 `"triage is not yet available (route-agent not wired)"`，退出码 1

## Risks / Trade-offs

- [`--detach` 子进程 orphan] → 子进程被 init 接管，正常行为；`daemon.json` 记录 PID 供 `stop` 管理
- [`daemon.json` 格式变更] → 保留 `daemon.pid` 回退读取
- [`status`/`tui` 依赖 HTTP dashboard] → 无 `server.port` 时 `status` 回退到 PID-only，`tui` 报错退出
- [`--follow` 轮询占用 CPU] → 500ms 间隔，日志不大时开销可忽略
- [`--level` 过滤需解析 JSON] → 非 JSON 行直接保留，不报错
- [`--detach` + `--tui` 互斥] → detach 后台运行无终端，`--tui` 无意义；检测到同时使用时报错退出
- [`tui` HTTP 轮询延迟] → 1s 间隔与现有 in-process TUI 一致，运维无感知差异
- [HTTP 响应 → RuntimeSnapshot 适配] → 字段映射简单（ISO→epoch、rename `codex_totals`），无信息丢失
