## Why

直连会话对同一目录施加**无条件互斥**：同一路径同时只能有一个 turn，第二个话题（哪怕只是读代码/查历史）也必须排队到前一轮完整结束。这个默认值保护了共享工作树，但用户没有任何显式放开的手段。是否接受同目录并发带来的文件/git 竞态，应当由用户显式决定；同时放开后必须能被观测到。

## What Changes

- 新增 `feishu.direct.max_concurrent_turns_per_dir`（整数 ≥1，默认 `1`）：同一目录可同时占用的 turn 数。默认值保持现有串行行为；`2+` 为显式放开。
- 目录锁从布尔互斥改为**计数信号量**：按 realpath 分目录，FIFO 排队、不抢占、一次释放移交一个 waiter；上限在 acquire 时现读配置，热重载只影响之后进入的 turn，不主动唤醒排队者。
- 生效并发取 `min(max_concurrent_turns_per_dir, feishu.direct.max_concurrent)`；等待权限审批的 turn 继续占用目录槽位。
- 可观测性：`max_concurrent_turns_per_dir > 1` 时启动记 WARN（含 `auto_approve` 提醒）；热重载 `≤1 → >1` 再记一次；每轮 `direct turn starting` 携带生效值；`/api/v1/state` 顶层新增 `direct_dirs`（始终输出，空为 `[]`），只含有活动的目录，字段 `{path, active, limit, waiters}`。
- 文档与决策：8 个 WORKFLOW 模板（4 变体 × 中英）加键与注释；`docs/{zh,en}/configuration.md` 加表格行并修正“同目录始终串行”；新增 ADR 0040，并在 ADR 0022 顶部标注 amended；`CONTEXT.md` 新增 **Per-directory turn limit (目录并发上限)** 术语。
- 不做：按项目覆盖、只读识别/读写锁、动态扩容唤醒、TUI 展示、doctor/init 新交互、usage/architecture/README 改动。

## Capabilities

### New Capabilities

（无——全部为既有 capability 的需求变更）

### Modified Capabilities

- `direct-sessions`: “同目录串行”改为受 `max_concurrent_turns_per_dir` 控制的并发预算（默认 1），并新增 `/api/v1/state` 的目录占用可观测契约

## Impact

- 代码：`src/config/config-types.ts`（`DirectConfig`/`DEFAULTS`）、`src/config/resolver.ts`、`src/direct/manager.ts`（计数信号量、`dirConcurrencyLimit`、WARN、日志、目录占用快照）、`src/shared/types.ts`（`RuntimeDirectDir` / `RuntimeSnapshot.direct_dirs`）、`src/observability/snapshot.ts`、`src/observability/http-dashboard.ts` 的接线
- 配置面：新增一个全局键；无 BREAKING、无迁移；旧 WORKFLOW 跑 `--update` 会报告该键缺失（仅报告，不写入）
- 模板：`assets/workflows/WORKFLOW.{minimal,code-mr,feishu-direct,grill-openspec}{,.en}.md.example`（8 个）
- 文档：`docs/{zh,en}/configuration.md`、`docs/adr/0040-opt-in-same-directory-turn-concurrency.md`、`docs/adr/0022-...md`（Status）、`CONTEXT.md`
- 测试：`tests/config.test.ts`、`tests/direct-sessions.test.ts`、`tests/observability.test.ts`、`tests/en-templates.test.ts`
- 门禁：lint / typecheck / `npm test` / `npm run build` / `npm run test:e2e`；真实 API 集成测试在内网可达时跑
