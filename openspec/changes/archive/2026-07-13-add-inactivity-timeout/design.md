## Context

tasking 的 worker 子进程（`opencode run`）当前有两层超时保护：

1. **`turn_timeout_ms`**（默认 1h）— 在 `runDefaultSubprocess` 中以 `setTimeout` 实现，是**硬墙钟超时**。到点即 `child.kill("SIGTERM")`，不区分子进程是否在持续输出。
2. **`stall_timeout_ms`**（默认 5min）— 在 scheduler 的 `reconcileStalledRuns` 中检查 `RunningEntry.last_event_at`，是**语义事件级 stall 检测**。每个 poll 周期（30s）检查一次。

Symphony 的对等层（`app_server.ex` 的 `receive_loop`）使用 Erlang 的 `receive ... after timeout_ms`——收到端口数据时递归重入 `receive_loop`，计时器随之重置。这是**不活跃超时**：只要持续有数据就不会触发，只在真正静默时才杀。

tasking 缺少这一层。后果：agent 在单 turn 内执行需要长时间持续工作的流程（如 land 技能的 CI 监控+review 处理循环）时，即使持续输出事件也会被硬墙钟到点强杀。

## Goals / Non-Goals

**Goals:**
- 在 `runDefaultSubprocess` 中新增不活跃超时层，收到 stdout/stderr 数据时重置计时器
- 保留现有 `turn_timeout_ms` 硬墙钟作为绝对上限
- 三层叠加，各层职责明确，默认值合理，全部可配置
- 与 Symphony 的超时语义对齐

**Non-Goals:**
- 不修改 scheduler 层的 `stall_timeout_ms` 逻辑（已实现且工作正常）
- 不引入新的进程模型（不模拟 Symphony 的 app-server 长连接）
- 不修改 multi-turn 循环逻辑

## Decisions

### 决策 1：不活跃超时在 `runDefaultSubprocess` 内实现，不新增层

**选择**：在现有 `runDefaultSubprocess` 函数内部实现 resetTimer 逻辑，不抽取为独立模块。

**理由**：`runDefaultSubprocess` 已经是子进程管理的唯一入口——它持有 `child` 引用、stdout/stderr data 监听器、close/error 处理器。在不干扰现有代码结构的前提下加一个可重置的 timer 是最小改动（~15 行）。

**备选**：抽取为独立的 `InactivityTimer` 类。过度工程化，当前场景一个闭包函数足够。

### 决策 2：stdout 和 stderr 都触发计时器重置

**选择**：`child.stdout.on("data")` 和 `child.stderr.on("data")` 都调用 `resetTimer()`。

**理由**：opencode 的 `--format json` 事件流走 stdout，但 opencode 自身的调试/进度信息可能走 stderr。两者都代表"子进程在活动"。Symphony 的 Erlang `receive` 监听端口的所有数据（stdout 和 stderr 都是 port message），行为一致。

### 决策 3：新增 `inactivity_timeout_ms` 配置项，默认 10 分钟

**选择**：`OpencodeConfig` 新增 `inactivity_timeout_ms: number`，默认 600000（10min），设为 0 禁用。

**理由**：
- opencode 与 Symphony 的 Codex app-server 输出模式不同：app-server 流式输出 token（推理期间持续有数据），而 opencode 在工具执行期间（如 `npm test`、`land_watch.py` 轮询）可能完全静默。5 分钟不足以覆盖常见长工具执行场景
- 10 分钟留够工具执行余量（多数测试/构建 < 10min），仍能抓住真正的 API hang 和网络断开
- 不活跃超时设比 stall 超时（5min）更宽，因为不活跃是字节级即时杀，需要更大容忍度；stall 是语义级 poll 检查，可以更严格
- 设为 0 禁用，与 `stall_timeout_ms` 的禁用语义一致

### 决策 4：新增 `inactivity_timeout` 错误分类，不复用 `turn_timeout`

**选择**：`AttemptResult.error` 在不活跃超时触发时标注 `inactivity_timeout`，与 `turn_timeout`（墙钟超时）区分。

**理由**：
- 不活跃超时 = "agent 静默了" → 可能是模型 API hang、网络断开
- 墙钟超时 = "agent 跑太久了" → 可能是死循环、无用功
- 不同原因可能需要不同的 retry 策略（未来）
- 日志中可区分两种超时，便于排查

**备选**：复用 `turn_timeout`。简单但丢失诊断信息。

### 决策 5：墙钟超时保留，不改为不活跃语义

**选择**：`turn_timeout_ms` 保持硬墙钟语义不变。新增 `inactivity_timeout_ms` 作为独立层。

**理由**：三层各有职责——不活跃（10min，快杀静默）+ stall（5min，语义事件检查）+ 墙钟（1h，绝对上限）。墙钟兜的是"agent 在做无用功但持续输出"场景（如死循环里不停调工具），不活跃和 stall 都抓不住。

### 决策 6：两个 timer 的优先级和清理

**选择**：两个 timer（墙钟 + 不活跃）独立运行，任一触发都设置 `timedOut = true` 并 `child.kill("SIGTERM")`。`close` 事件中清理两个 timer。

**理由**：两个 timer 互不干扰，先触发的先杀，后触发的在 `close` 时被 `clearTimeout` 清理。不活跃 timer 在每次 data 事件时重置，墙钟 timer 只设一次。

## Risks / Trade-offs

- **[风险] opencode stdout 缓冲导致误杀** → 如果 opencode 攒一批再 flush stdout，在 flush 间隙不活跃 timer 可能误触发。缓解：`--format json` 是 newline-delimited 设计，每条 event 立即 flush。10 分钟默认值留有充足余量（工具执行和模型推理通常在分钟级，不会 10 分钟零输出）。

- **[风险] 不活跃超时与 stall 超时功能重叠** → 两者都检测"agent 没活动"。区别在于盯的层不同（原始字节 vs 语义事件）和响应速度不同（即时 vs poll 周期）。在"opencode 完全 hang 死"场景下两者都会触发，不活跃先触发。这是 defense-in-depth，不是冗余。

- **[取舍] 配置项增多** → `OpencodeConfig` 从 5 个字段变 6 个。但三个超时各有明确职责，用户需要理解三者的区别。文档需要清晰说明。
