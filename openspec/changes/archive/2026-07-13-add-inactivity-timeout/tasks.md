## 1. 配置层

- [x] 1.1 `OpencodeConfig` 接口新增 `inactivity_timeout_ms: number` 字段（`src/config/config-types.ts`）
- [x] 1.2 `DEFAULTS.opencode` 新增 `inactivity_timeout_ms: 600000`（`src/config/config-types.ts`）
- [x] 1.3 resolver 解析 `inactivity_timeout_ms`，校验 >= 0，设为 0 禁用（`src/config/resolver.ts`）

## 2. 子进程不活跃超时

- [x] 2.1 `runDefaultSubprocess` 新增不活跃计时器：启动时启动 timer，stdout/stderr data 事件重置 timer，触发时 `timedOut = true` + `child.kill("SIGTERM")`（`src/worker/runner.ts`）
- [x] 2.2 `runDefaultSubprocess` 返回值区分墙钟超时与不活跃超时：`SubprocessResult` 新增 `timedOutReason?: "wall_clock" | "inactivity"` 字段（`src/worker/runner.ts`）
- [x] 2.3 `runAttempt` 读取 `timedOutReason`，将不活跃超时分类为 `inactivity_timeout`，墙钟超时分类为 `turn_timeout`（`src/worker/runner.ts`）

## 3. 测试

- [x] 3.1 测试：不活跃超时禁用（`inactivity_timeout_ms = 0`）时不启动计时器
- [x] 3.2 测试：子进程持续输出时不活跃计时器不触发（mock spawnRunner 模拟连续 data 事件）
- [x] 3.3 测试：子进程静默后不活跃计时器触发，错误分类为 `inactivity_timeout`
- [x] 3.4 测试：墙钟超时仍正常工作，错误分类为 `turn_timeout`
- [x] 3.5 测试：两个 timer 独立运行，先触发者先杀

## 4. 文档

- [x] 4.1 `docs/configuration.md` 新增 `inactivity_timeout_ms` 配置项说明（默认值、语义、与 turn_timeout_ms / stall_timeout_ms 的区别）
- [x] 4.2 `docs/architecture.md` 更新超时模型描述（三层叠加图）
- [x] 4.3 `WORKFLOW.md.example` 中 opencode 配置区块新增 `inactivity_timeout_ms` 注释说明

## 5. 验证

- [x] 5.1 运行 `npm run lint && npm run typecheck && npm test`，确保全部通过
