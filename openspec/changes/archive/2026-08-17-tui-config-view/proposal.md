## Why

daemon 运行中所使用的具体配置与运行时属性无法在 TUI 中查看——TUI 只显示任务运行态、token、日志，用户无法确认当前生效的配置（polling 间隔、并发上限、opencode model/variant、tracker 状态集合、密钥是否配置等），也不便于监控/调试后台 daemon。后台 daemon（`--detach`）虽然可用 `tasking tui` 附加查看，但 daemon 元信息缺少 workflow 路径，且 `--port 0`（临时端口）时 daemon.json 写入的是 0 而非实际端口，导致附加定位失败。

## What Changes

- TUI 新增全屏「配置视图」模式：按 `c` 进入，Esc/q 返回。展示 daemon 当前**有效配置**（EffectiveConfig——原始 WORKFLOW.md 前文经默认值补齐、环境变量展开、路径解析后的实际运行值，热重载实时反映）+ 运行时属性（pid、启动时长、workflow 路径、workspace 根、tasking.log 路径、daemon host:port）。
- 密钥统一脱敏：`tracker.api_key`、`feishu.app_secret` / `verification_token` / `encrypt_key`、`env` 段的值显示为 `****`（配置存在时标注 set/unset）。
- HTTP dashboard 新增 `GET /api/v1/config` 端点，由 daemon 侧序列化脱敏后的有效配置 + 运行时属性，供附加 TUI（`tasking tui`）拉取（与 `/api/v1/state` 同一通道，ADR 0005）。
- `daemon.json` 元信息新增 `workflow_path` 字段；修复 `--port 0` 时写入 0 而非实际端口的 bug（写入 dashboard 实际绑定端口）。
- 进程内 TUI（`start --tui`）直接从 `ConfigManager.current` 读配置，无需 HTTP。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `terminal-dashboard`: TUI 新增配置视图模式（`c` 进入、Esc/q 返回），展示有效配置 + 运行时属性，密钥脱敏。
- `observability`: HTTP dashboard 新增 `GET /api/v1/config` 端点，返回 daemon 侧脱敏后的有效配置 + 运行时属性（pid、started_at、workflow_path、workspace_root、log_path、host/port）。
- `cli-runtime`: `daemon.json` 元信息新增 `workflow_path`；`--port 0` 时写入实际绑定端口而非 0；`tasking tui` 在 `--port 0` 启动的 daemon 上也能正常附加。

## Impact

- 改：`src/cli/index.ts`（构造 dashboard/TUI 时传 config/runtime 源；`writeDaemonInfo` 写实际端口与 workflow_path）
- 改：`src/cli/daemon-info.ts`（`DaemonInfo` 加 `workflow_path`；兼容读取旧文件）
- 改：`src/observability/http-dashboard.ts`（新增 `GET /api/v1/config` 路由）
- 新增：`src/observability/config-view.ts`（序列化有效配置 + 运行时属性、密钥脱敏，供 dashboard 与 TUI 共用）
- 改：`src/observability/terminal-dashboard.ts`（新增 config 模式渲染与按键）
- 改：`src/cli/tui-helpers.ts`（远程 config 快照解析）
- 改：`tests/observability.test.ts`、`tests/terminal-dashboard.test.ts`、`tests/cli.test.ts`、`tests/cli-commands.test.ts`；新增 `tests/config-view.test.ts`
- 改：`docs/usage.md`、`docs/architecture.md`（TUI 配置视图 + `/api/v1/config` 端点 + daemon.json 字段）
- 不动：调度器、worker、tracker、feishu、session/token 记账、MCP 注入。
