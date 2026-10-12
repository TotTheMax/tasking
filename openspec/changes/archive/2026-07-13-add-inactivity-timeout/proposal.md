## Why

tasking 的 worker 子进程超时模型目前只有两层：`turn_timeout_ms`（硬墙钟，到点必杀）和 `stall_timeout_ms`（scheduler 层，检查语义事件）。硬墙钟超时不区分"agent 在持续工作"和"agent 卡死"——agent 即使在持续输出事件也会被到点强杀。Symphony 的对等层是不活跃超时（收到数据就重置计时器），允许 agent 在持续活动时无限期存活，只在真正静默时才触发。缺少这一层导致 agent 无法在单 turn 内完成需要长时间持续工作的流程（如 PR 落地、CI 监控）。

## What Changes

- 新增 `opencode.inactivity_timeout_ms` 配置项（默认 600000 = 10 分钟，设为 0 禁用），控制子进程不活跃超时
- `runDefaultSubprocess` SHALL 在收到 stdout/stderr 数据时重置不活跃计时器；计时器触发时以 SIGTERM 终止子进程并标记 `timedOut`
- 保留现有 `turn_timeout_ms` 作为硬墙钟上限——无论活动状态如何，到点必杀
- 新增 `inactivity_timeout` 错误分类，与现有 `turn_timeout`（墙钟）区分
- 三层叠加：不活跃（10min，快杀静默进程）→ stall（5min，scheduler 层语义事件检查）→ 墙钟（1h，硬上限）

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `opencode-worker`: 新增不活跃超时要求；修改失败分类以包含 `inactivity_timeout` 类别；明确三层超时模型的分层职责

## Impact

- `src/config/config-types.ts` — `OpencodeConfig` 新增 `inactivity_timeout_ms` 字段 + DEFAULTS
- `src/config/resolver.ts` — 解析新配置项
- `src/worker/runner.ts` — `runDefaultSubprocess` 实现不活跃计时器重置逻辑；`runAttempt` 识别不活跃超时并分类
- `src/shared/types.ts` — `AttemptStatus` 新增 `inactivity_timeout`（如需与 `timed_out` 区分）
- `tests/worker.test.ts` — 新增不活跃超时相关测试
- `docs/configuration.md` — 文档化新配置项
- `docs/architecture.md` — 更新超时模型描述
