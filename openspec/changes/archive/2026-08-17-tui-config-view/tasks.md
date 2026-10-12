## 1. 配置序列化与脱敏

- [x] 1.1 实现 `buildConfigView(config, runtime)` / `serializeConfig` / 脱敏（红：在 `tests/config-view.test.ts` 断言 tracker.api_key、feishu.app_secret/verification_token/encrypt_key、env 段值为 `****`，active_states 等数组与 record 原样序列化，null 字段保留为 null；绿：新建 `src/observability/config-view.ts`，用 SECRET_KEYS 集合递归脱敏）

## 2. HTTP /api/v1/config 端点

- [x] 2.1 `HttpDashboardOptions` 加 `configView: () => ConfigView`，新增 `GET /api/v1/config` 路由，`started_at` 转 ISO 8601（红：`tests/observability.test.ts` 加用例——GET 返回 200 且含脱敏 config 与 runtime、POST 返回 405；绿：实现路由）

## 3. daemon 元信息与端口修复

- [x] 3.1 `DaemonInfo` 加 `workflow_path: string | null`，`readDaemonInfo` 兼容旧文件（红：`tests/cli.test.ts` 断言缺字段时降级 null、含字段时读回；绿：改 `src/cli/daemon-info.ts`）
- [x] 3.2 `runStart` 用 dashboard 实际绑定端口写 `daemon.json`，并写 `workflow_path`；构造 `configView` 源传给 dashboard 与进程内 TUI（红：断言 `--port 0` 场景下写入端口非 0——以 `writeDaemonInfo`/构建逻辑单测为主；绿：改 `src/cli/index.ts`）

## 4. TUI 配置视图

- [x] 4.1 `TerminalDashboard` 加 `"config"` 模式：`TuiMode` 扩展、overview 按 `c` 进入、Esc/q 返回、`j`/`k` 滚动（红：`tests/terminal-dashboard.test.ts` 断言渲染含运行时属性与配置分组、密钥显示 `****`、按 c 后 Esc/q 返回 overview；绿：实现按键与 `formatConfig`）
- [x] 4.2 `tui-helpers.ts` 加 `httpToConfigView`：把 `/api/v1/config` 的 ISO `started_at` 解析回 epoch（红：单测断言解析结果；绿：实现）

## 5. 文档同步

- [x] 5.1 `docs/usage.md`：`tasking tui` 说明补配置视图（按 `c` 查看当前有效配置，密钥脱敏）；`docs/architecture.md`：TUI 章节补配置视图、dashboard API 补 `/api/v1/config`、daemon.json 字段说明

## 6. 验证

- [x] 6.1 `npm run lint` 全绿
- [x] 6.2 `npm run typecheck` 全绿
- [x] 6.3 `npm test` 全绿

## 7. tui 手动指定端口（拷问 Q3 补充需求）

- [x] 7.1 `runTui` 支持 `--port <n>`：指定时跳过 daemon.json 依赖（host 用 daemon.json 若有、否则 127.0.0.1），非数值端口报错返回 1；进入 TUI 前探测 `/api/v1/state` 连通性，不可达报错返回 1（红：`tests/cli.test.ts` 加「无 daemon 无端口→1」「--port abc→1」「--port 1 不可达→1」；绿：改 `src/cli/index.ts` + USAGE）
- [x] 7.2 `docs/usage.md` 与 openspec cli-runtime delta spec 同步 `tasking tui [--port <n>]`
