## Context

TUI（`src/observability/terminal-dashboard.ts`）现有 overview / detail-running / detail-retry / logs 四种模式，数据源支持两种形态：进程内 `state()`（`start --tui`）与远程 `fetchSnapshot()`（`tasking tui` 经 HTTP dashboard `GET /api/v1/state`）。`ConfigManager.current` 持有 daemon 当前**有效配置**（EffectiveConfig），由 `resolveConfig` 对 WORKFLOW.md frontmatter 应用默认值、环境变量展开、路径解析得到，且随文件 watcher 热重载。

`daemon.json`（`.tasking/`）目前只存 `pid / port / host / started_at`，`tasking tui` / `status` / `stop` 都靠它在当前目录定位 daemon（用户要求的「当前目录配置文件对应」）。已发现问题：`--port 0` 时 `daemon.json` 写入 `0` 而非实际绑定端口，导致后续 `tui` / `status` 连接失败。

## Goals / Non-Goals

**Goals:**

- TUI 新增全屏「配置视图」：按 `c` 进入、Esc/q 返回，展示有效配置 + 运行时属性，密钥脱敏。
- 配置视图在进程内（`start --tui`）与附加（`tasking tui`）两种形态下都可用，且数据一致（都是 daemon 当前运行的有效配置）。
- `daemon.json` 补 `workflow_path`；`--port 0` 时写入实际端口。
- 密钥（tracker.api_key、feishu.app_secret / verification_token / encrypt_key、env 段值）永不明文离开 daemon 序列化边界。

**Non-Goals:**

- 不新增无 `--port` 时的附加通道（维持「需 `--port`」，见 grill Q3 选项 a）。
- 不改调度器 / worker / tracker / feishu / token 记账 / MCP 注入。
- 不在 TUI 中编辑配置（纯只读）。
- 不做配置 diff / 历史。

## Decisions

1. **配置视图数据来自 daemon 的有效配置，而非本地 WORKFLOW.md**（ADR 0005）。进程内 TUI 直接读 `ConfigManager.current`；附加 TUI 经新增 `GET /api/v1/config` 拉取。理由：原始文件与运行配置在热重载/默认值/环境变量展开后可能不一致，且运行时属性（pid、实际端口、日志路径）只有 daemon 自知。

2. **共享序列化器 `buildConfigView(config, runtime)` 在 `src/observability/config-view.ts`**，返回 `ConfigView = { config: 分组脱敏配置, runtime: {pid, started_at, workflow_path, workspace_root, log_path, host, port} }`。序列化与脱敏只做一次，HTTP 端点与 TUI 共用同一份数据，保证两种形态渲染一致。`started_at` 在序列化层用 epoch（TUI 好算时长），HTTP 层转 ISO 8601（遵循既有 `/api/v1/state` 约定），`tasking tui` 端再解析回 epoch——复用 `httpToSnapshot` 的既有模式。

3. **脱敏在 daemon 侧序列化边界完成**：`tracker.api_key`、`feishu.app_secret / verification_token / encrypt_key` 置为 `****`（null/空 → `(unset)` 标记由 TUI 渲染层处理）；`env` 段所有值一律 `****`（环境变量值可能含任意密钥）。`required_labels` / `active_states` / `terminal_states` 等数组与 `max_concurrent_agents_by_state` 等 record 原样序列化，由 TUI 拼成单行。

4. **TUI 配置模式复用既有形态**：`TuiMode` 加 `"config"`，overview 按 `c` 进入（与 logs 的 `L` 同层级）、Esc/q 返回。数据源镜像 `state`/`fetchSnapshot`：`configView?: () => ConfigView`（进程内）+ `fetchConfig?: () => Promise<ConfigView>`（附加）。因配置行数可能超过终端高度，配置模式支持 `j`/`k` 滚动（复用 logs 的滚动模型，锚定偏移）。

5. **`daemon.json` 补字段 + 修端口**：`DaemonInfo` 加 `workflow_path: string | null`（旧文件缺字段时降级 null）。`runStart` 中 `writeDaemonInfo` 改为写入 dashboard 实际绑定端口 `actualPort`（`--port 0` 时是随机端口，非 0）与 `workflowPath`。运行时属性里的 `port` 用实际端口，`config.server.port` 保持用户配置值——运行时栏展示事实，配置分组展示配置意图。

6. **`tasking tui` 附加路径的 config 源**：`runTui` 构造 `TerminalDashboard` 时新增 `fetchConfig: () => fetch /api/v1/config → httpToConfigView(json)`；`runStart` 的进程内路径传 `configView: () => buildConfigView(configMgr.current, runtimeInfo)`。

## Risks / Trade-offs

- **[配置含路径等私有信息经 HTTP 暴露]** `/api/v1/config` 与 `/api/v1/state` 同属一个未鉴权的 dashboard 服务，暴露了 endpoint、workspace 根、log 路径等。→ 与既有 dashboard 相同的信任边界（绑定地址由 `server.host` 控制，默认 `0.0.0.0`，与既有端点一致），仅密钥脱敏；如需更严可后续加鉴权，本次不做。
- **[env 段全量脱敏降低可读性]** 非密钥 env（如 `NODE_ENV`）也被 `****`。→ 可接受，密钥字段集合在 schema 上不完整，全量脱敏最安全；用户需要具体值可直接看 WORKFLOW.md。
- **[配置视图无 `--port` 时不可用]** 附加 TUI 依赖 HTTP dashboard。→ grill 已采纳选项 a（维持需 `--port`），README/docs 已注明。
- **[热重载期间 /api/v1/config 短暂不一致]** 进程内读 `configMgr.current`、HTTP 读同一引用，重载是同步替换，天然一致；无竞态窗口。

## Migration Plan

无需数据迁移。部署：升级 daemon 后重启，`tasking start` 即写新 daemon.json。回滚：`daemon.json` 新增字段向后兼容（旧 CLI 读新文件忽略未知字段；新 CLI 读旧文件缺 `workflow_path` 降级 null），TUI 配置视图缺失 config 源时静默跳过该模式。
