## Why

`tasking` 移植了 Symphony SPEC 约 80% 的协调模型。经过对 Symphony 仓库全部文件(SPEC 2182 行、22 个 Elixir 源文件、6 个 agent 技能、16 个测试文件、CI/PR 模板、架构图、文档)与 tasking 全部源码(31 个 TS 文件、16 个测试文件)的逐行比对,识别出约 100 项差异,分为:Symphony 独有(~50 项)、两边都有但 tasking 有 bug(~25 项)、实现机制不同(~20 项)、tasking 独有(~13 项)。需要将这些差异系统化记录为 6 份文档,并生成基于实际情况的优先级修复清单,以便后续逐项补齐。

## What Changes

### 生成差异文档(6 份)
- `docs/gap-analysis.md` — 全部差异总览 + 文档索引 + 有意取舍声明
- `docs/symphony-only.md` — Symphony 有而 tasking 完全没有的 50 项能力
- `docs/bugs-and-incomplete.md` — 两边都有但 tasking 有 bug/不完善的 25 项
- `docs/implementation-differences.md` — 两边都有但实现机制不同的 20 项
- `docs/tasking-only.md` — 只有 tasking 有的 13 项能力
- `docs/recommendations.md` — 按 P0-P6 分级的修复/补齐清单,含明确不补齐项

### spec delta(覆盖修复项)
- `workspace-management` MODIFIED — symlink 安全校验
- `structured-scheduler` ADDED — turn_count 递增、refresh 触发
- `observability` ADDED — HTTP 端点补齐、文件日志、rate_limits、pub/sub、字段对齐
- `opencode-worker` ADDED — turn 事件发射、错误分类
- `terminal-dashboard` 新能力 — 终端 TUI 状态面板

## Capabilities

### New Capabilities
- `terminal-dashboard`: 终端 TUI 状态面板

### Modified Capabilities
- `workspace-management`: symlink 安全路径校验 + `workspace_equals_root` 守卫
- `structured-scheduler`: per-tick 预校验、turn_count 递增、refresh 触发、统一终止清理、continuation retry 守卫、退避指数封顶、`normalize_state` 一致性、per-state 回退
- `observability`: `GET /api/v1/:id`、真 refresh、405、query-string 修复、文件日志、rate_limits、token 去重、pub/sub、字段对齐、`workspace_path` 暴露
- `opencode-worker`: turn 事件发射、错误分类、`session_id` 运行中更新、`last_message` 更新

## Impact

- `src/workspace/manager.ts` — `isWithinRoot` + `workspace_equals_root`
- `src/scheduler/scheduler.ts` — `tick()` 预校验、`onEvent` 递增/去重/更新、`terminateRunning` 统一、`requestRefresh`、退避封顶、`normalizeState`
- `src/worker/runner.ts` — `turn_started`/`turn_completed` 事件、rate-limit 提取、try/finally
- `src/observability/http-dashboard.ts` — `GET /:id`、真 refresh、405、query-string
- `src/observability/snapshot.ts` — 字段对齐、`workspace_path`、ISO 8601
- `src/observability/logger.ts` — 文件 sink
- `src/observability/terminal-dashboard.ts` — 新文件
- `src/config/config-types.ts` — `server.host`、`logging.file`
- `src/adapters/jira/tracker.ts` — `blocked_by` 大小写、`url` 填充
- `tests/` — 各修复项回归测试
