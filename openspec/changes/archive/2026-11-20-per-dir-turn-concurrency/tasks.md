## 1. 配置面

- [x] 1.1 新增 `feishu.direct.max_concurrent_turns_per_dir`（先写失败测试：`tests/config.test.ts` 覆盖默认 1、显式 2、`2.9 → 2`、`0/-1/NaN/字符串 → 1`；再在 `src/config/config-types.ts` 增加 `DirectConfig` 字段与 `DEFAULTS`，在 `src/config/resolver.ts` 解析、取整、回退）
- [x] 1.2 确认 `serializeConfig` / `/api/v1/config` 自动带出新键，补一条 `tests/config-view.test.ts` 断言（失败测试先行）

## 2. 调度核心

- [x] 2.1 目录锁改计数信号量（先写失败测试：`tests/direct-sessions.test.ts` 覆盖默认串行、`limit=2` 三会话前二并行第三 FIFO、`max_concurrent=1` 时仍串行、审批等待继续占槽；再在 `src/direct/manager.ts` 实现 `{active, waiters}`、`dirConcurrencyLimit()`、release 移交与空闲清理）
- [x] 2.2 热重载语义（先写失败测试：运行中把值从 1 改为 2，正在跑的 turn 不打断、之后的新 turn 按新值并行；再把 limit 改为每次 acquire/release 现读，不主动唤醒 waiter）
- [x] 2.3 卡片排队判定（先写/补失败断言：`limit=2` 且已占 1 槽时显示运行中而非排队；已达 `limit` 或全局上限时显示排队中；再改 `runTurnLoop` 的 `busy` 条件）

## 3. 可观测性

- [x] 3.1 WARN 与日志（先写失败测试：`max_concurrent_turns_per_dir > 1` 启动出现带 `auto_approve` 提醒的 WARN、`=1` 不出现、热重载 `≤1 → >1` 再出现一次；再实现 `start()` 与 `ConfigManager.onReload` 监听，并在 `direct turn starting` 加字段）
- [x] 3.2 `direct_dirs` 快照（先写失败测试：`tests/observability.test.ts` + `tests/direct-sessions.test.ts` 覆盖形状、只含有活动目录、`active` 含等全局名额的占槽者、`waiters` 只算目录等待、按 path 排序、空闲清理、无活动时为 `[]`；再在 `src/shared/types.ts` 增加 `RuntimeDirectDir`/`RuntimeSnapshot.direct_dirs`，在 `manager` 暴露 `listDirectDirs()`，经 `SnapshotExtras` → `buildSnapshot` → `http-dashboard`/TUI 接线）
- [x] 3.3 TUI 回归（补断言：TUI 快照渲染不因新增 `direct_dirs` 字段变化；不改 TUI 消费逻辑）

## 4. 文档与模板

- [x] 4.1 8 个模板（`assets/workflows/WORKFLOW.{minimal,code-mr,feishu-direct,grill-openspec}{,.en}.md.example`）加 `max_concurrent_turns_per_dir: 1` 与注释，修正 `max_concurrent` 旁“同目录始终串行”的措辞；在 `tests/en-templates.test.ts` 断言该键默认值为 1
- [x] 4.2 `docs/zh/configuration.md` / `docs/en/configuration.md` 增加表格行并修正 `max_concurrent` 描述；确认 `tests/docs-links.test.ts` 双语文档门禁绿
- [x] 4.3 ADR 0040 新增、ADR 0022 Status 标注、`CONTEXT.md` 增加 Per-directory turn limit 术语（grill 会话已落）

## 5. 门禁与验收

- [x] 5.1 定向测试：`npx vitest run tests/config.test.ts tests/direct-sessions.test.ts tests/observability.test.ts tests/en-templates.test.ts tests/config-view.test.ts`
- [x] 5.2 `npm run lint` + `npm run typecheck`
- [x] 5.3 `npm test` + `npm run build`
- [x] 5.4 `npm run test:e2e`；`npm run test:integration` 在内网可达时跑，不可达则在提交说明记录原因
- [x] 5.5 `openspec validate per-dir-turn-concurrency`（如命令可用）并核对 spec delta 覆盖默认值清单、并发预算与 `direct_dirs` 契约
