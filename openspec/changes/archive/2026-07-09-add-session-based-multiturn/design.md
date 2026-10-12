## Context

tasking 的 worker 层已有续轮循环(`runner.ts:182-248`),但存在两个结构性缺陷:

1. **失忆续轮**: 每个 turn 启动全新 `opencode run` 进程,无 `-s` 参数,agent 丢失前序对话上下文。续轮指引(`buildContinuationGuidance`)被迫冗长——"review the current workspace state and resume from where you left off"——因为 agent 只能从文件系统推断进度。
2. **token 统计全零**: `extractUsage` 扫描 stdout 中的 JSON 行,但当前未使用 `--format json`,stdout 是 ANSI 格式化文本,不含任何 JSON 行,导致 token 统计始终返回零值,仪表板数据失真。

opencode 原生提供三项能力此前未被利用:

- `--format json`: 输出结构化事件流(每行一个 JSON 对象),含 `sessionID`、`part.tokens`、`part.reason` 等
- `-s <sessionID>`: 续接已有 session,agent 享有完整对话上下文,prompt cache 命中后续轮成本极低
- `session delete <sessionID>`: 删除 session,释放磁盘空间

`RunningEntry.session_id`(types.ts:62)和 `RuntimeSnapshot` 中的 `session_id`(types.ts:143)字段在 bootstrap 阶段已预留,但从未被填充。

## Goals / Non-Goals

**Goals:**

- 续轮循环改为 session 续接: turn 2+ 使用 `-s <sessionID>` 续接同一 session,agent 跨 turn 保持完整上下文
- 修复 token 统计: 统一使用 `--format json` 输出,按真实事件 schema 解析
- session 生命周期管理: 创建(turn 1 提取)→ 续接(turn 2+ 与 continuation retry)→ 清理(terminal 时 delete)
- continuation retry 续接 session: worker 正常退出后,短续轮 retry 继续同一 session
- 充分利用 session 机制优化整体流程: 续轮指引精简、仪表板 session 可见、失败 retry 全新 session

**Non-Goals:**

- 跨 daemon 重启的 session 恢复(不做 sidecar 文件持久化;重启后全新 session)
- 失败 retry 续接 session(失败意味着可能走错路,全新 session = 全新思路)
- opencode session 的全局 GC 策略(仅在任务 terminal 时清理对应 session,不做全局扫描)
- 修改 `max_turns` 默认值(保持 20,由用户按需配置)

## Decisions

### D1: `--format json` 作为唯一输出模式

**决策**: 所有 `opencode run` 调用统一使用 `--format json`。

**理由**: `--format json` 同时解决两个问题——session ID 提取与 token 统计。非 JSON 模式的输出是 ANSI 格式化文本,既无 session ID 也无 token 数据,无法机器解析。`--format json` 输出的事件流(agent 可正常执行工具调用与文件操作)对 tasking 这种自动化编排场景是天然匹配。

**替代方案**: 保持非 JSON 输出 + 单独运行 `opencode session list` 查找 session ID。否决:额外子进程开销、无法解决 token 统计问题、session list 匹配不可靠。

### D2: 内存传播 session ID,不做磁盘持久化

**决策**: session ID 通过 `AttemptResult` → `RetryEntry` → `RunningEntry` → `RunAttemptOptions` 在内存中传播。daemon 重启后不恢复 session。

**理由**:

```
                  Turn 循环内   Retry 跨轮   Daemon 重启
内存传播             ✓            ✓            ✗
Sidecar 文件         ✓            ✓            ✓
```

内存传播覆盖 90% 场景(多轮续接 + continuation retry),代码改动最小(复用现有字段)。daemon 重启是边缘场景(编排器状态本就是内存态,重启后 tracker 驱动重新发现任务,全新 session 是安全默认)。Sidecar 文件引入文件 I/O 复杂度(原子写、竞态、格式校验),收益不抵成本。

**替代方案**: workspace 级 sidecar 文件(`.tasking-session.json`)。否决:可作为未来增量,当前不引入。

### D3: continuation retry 续接 session,失败 retry 全新 session

**决策**: `RetryEntry.continuation` 为 `true` 时传播 session ID;为 `false` 时传 null。

```
场景                  continuation    session_id  含义
─────────────────────────────────────────────────────────
Turn 循环内           N/A             续接        agent 正在工作中
成功续轮 retry        true            续接        agent 正常完成,任务仍活跃
失败 retry            false           null(全新)  上次可能走错路,全新思路
停滞 retry            false           null(全新)  session 可能卡在坏状态
Daemon 重启           N/A             null(全新)  无前序信息,安全起步
```

**理由**: 复用现有 `RetryEntry.continuation` 布尔字段,无需新增配置。成功续轮是 Symphony 核心模型(§7.1: worker 正常退出后调度 1s 续轮 retry)。失败 retry 全新 session 让 agent 从文件系统重新评估,有机会走不同思路。

### D4: session 清理与工作区清理联动

**决策**: `removeWorkspace` 接收可选 `sessionId` 参数。非空时,在删除工作区目录前执行 `opencode session delete <sessionId>`。失败记录警告但不阻塞工作区删除。

**理由**: opencode session 持久化存储在磁盘上,不随工作区删除而消失。长期运行后 session 会累积。在任务 terminal(工作区被清理)时同步清理 session 是自然时机。session delete 失败不应阻塞业务流程(最差情况是留下孤立 session,可后续手动清理)。

**清理时机**:

- `reconcileTrackerStates`: 任务变 terminal → 终止 worker → 清理工作区(含 session)
- `reconcileTerminalIssues`: 启动时发现 terminal 任务 → 清理工作区(无 session ID,因 daemon 可能刚重启)
- `reconcileStalledRuns`: 停滞终止 → 不清理工作区 → session 保留(可能续轮 retry 还要用)

### D5: 续轮指引精简

**决策**: session 续轮模式下,`buildContinuationGuidance` 从 4 行缩减为 1 行。

**当前**(失忆模式):
```
Continue working on LJWOS-5.
This is attempt 1, turn 2.
Review the current workspace state and resume from where you left off.
Do not restate the original task; pick up the work in progress.
```

**改为**(session 模式):
```
Continue.
```

**理由**: session 续接时 agent 有完整对话上下文,知道在做什么、做到哪了。冗长指引浪费 token、干扰 agent。"Continue." 足以触发 agent 继续上一轮的工作。attempt/turn 编号对 agent 无用(它不关心编排器内部状态)。

### D6: token 累加策略——累加所有 step_finish

**决策**: 遍历所有 `step_finish` 事件,累加 `part.tokens.input`、`part.tokens.output`、`part.tokens.total`。

**opencode JSON 事件流示例**(一次 `opencode run`,两个 step):
```json
{"type":"step_finish","part":{"tokens":{"total":11170,"input":11068,"output":13,...}}}
{"type":"step_finish","part":{"tokens":{"total":11215,"input":127,"output":16,"cache":{"read":11072}}}}
```

Step 2 的 `cache.read=11072` ≈ Step 1 的 `total=11170`(prompt cache 命中)。累加后 `total = 11170 + 11215 = 22385` 包含缓存读取的重复计算,但这对"统计 agent 消耗的 token 总量"是合理的(缓存读取也是 API 调用的一部分)。精确去重需要额外的 cache 逻辑,不值得当前引入。

**替代方案**: 仅取最后一个 step_finish 的 tokens。否决:丢失中间步骤的 token 消耗。

### D7: session ID 提取——从第一个事件获取

**决策**: 遍历 JSON 事件行,取第一个包含 `sessionID` 字段的事件的值。session ID 在每个事件中都出现(`step_start`、`tool_use`、`text`、`step_finish` 均含顶层 `sessionID`),取第一个即可。

**实现**: `extractSessionAndUsage(stdout)` 返回 `{ session_id, usage }`,一次遍历同时提取两者。

## Risks / Trade-offs

**[Risk] `--format json` 输出量大于格式化文本** → 对 tasking 场景影响可忽略(worker stdout 只被 `extractSessionAndUsage` 解析,不实时显示给用户;JSON 事件流体量在 KB 级别)。

**[Risk] session delete 失败留下孤立 session** → 记录警告日志,不阻塞工作区删除。可后续添加全局 session GC 作为增量改进。

**[Risk] 续轮时 session 不存在(session 已过期或被手动删除)** → opencode `run -s <不存在的 ID>` 会自动创建新 session(已验证),不会报错。最差情况是 agent 丢失上下文,退化为失忆续轮(与当前行为等价)。

**[Risk] `--format json` 为 BREAKING 变更,依赖格式化输出的外部集成会中断** → tasking 的 worker stdout 只在内部解析,不对外暴露。仪表板展示的是结构化数据(JSON API),不是原始 stdout。无外部集成依赖。

**[Trade-off] daemon 重启后 session 丢失** → 全新 session 是安全默认。agent 从文件系统重新评估,可能比续接一个过时上下文更可靠。如未来需要,可增量加入 sidecar 持久化。

**[Trade-off] 累加 token 包含 cache 重复计算** → 导致报告的 token 总量略高于实际 API 计费量。对 tasking 的可观测性目的(趋势分析、异常检测)足够。精确计费需额外 cache 去重逻辑。
