## Context

直连会话（`/chat`）目前是“一条用户消息 = 一轮”：`DirectSessionManager` 的 `runTurnLoop` 只在 `rt.queue` 有用户消息时继续，`executeTurn` 每个 turn 独立发一条结果消息。模型在长任务中提前总结/收尾时，直连没有 Jira 路径那样的 `agent.max_turns` 续轮，用户只能手动回“继续”。

本设计新增的 **Auto-continue** 是直连会话的一种模式：每轮结束后按行为信号决定继续、暂停或停止，不改变 turn settlement、不改变分段卡片、不改变结果消息。相关领域术语已写入 `CONTEXT.md`（Auto-continue / Auto-continue turn / Auto-continue prompt / Auto-continue budget / Auto-continue pause，并扩展了 Turn 的定义）。

当前工作区还有两个在途变更：`segment-turn-cards`（一轮可有多张分段卡片）和 `stuck-turn-settlement`（turn 结算以会话 idle 为准，并新增 `permission_timeout` 结算原因）。本设计基于它们之后的语义，不修改 turn settlement 本身。

关键约束：

- 结果消息是“结果面”（可引用、可搜索），过程卡是“过程面”；分段卡片可以有多张，停止章盖在哪一段会引入额外复杂度。
- 卡片更新不推送，文本消息推送；暂停/停止需要用户注意，适合用文本。
- `/auto` 已被权限姿态占用；`max_turns` 已被 Jira worker 占用；新术语必须唯一。
- 直连路径与 Jira 路径共享 turn-driver，但预算/生命周期必须彼此独立。

## Goals / Non-Goals

**Goals:**

- 直连会话显式开启的自动续跑：每轮结束后自动提交下一轮，直到停止条件。
- 完整、可解释的停止规则：低产出、重复、提问、预算、失败、超时、用户停止。
- 软暂停 vs 硬停：自动信号暂停并可被用户的下一条任务恢复；预算/失败/会话结束/用户停止是硬停。
- 会话级续跑提示词，配置默认 + 覆盖持久化。
- 过程卡 header 自动标记；结果消息保持纯回答；暂停/停止单独一条文本。
- Jira 路径零行为变化；`/loop` 不进入 Jira 评论。

**Non-Goals:**

- 外部 LLM 复核、`/accept` 验收命令、git 进度快照。
- 结论卡、停止章、卡片按钮、卡片 roundtrip。
- 结果消息抑制或内容改动。
- 在任务会话里注入完成协议（`[[DONE]]` 等）。
- Jira 路径自动续跑。
- 循环状态跨重启恢复。
- 超时专用提示词或独立超时重试计数器。

## Decisions

### 1. 循环放在 DirectSessionManager，而不是 turn-driver

`runTurnLoop` / `executeTurn` 是直连会话的编排层，Auto-continue 是直连专属模式；turn-driver 与 Jira worker 共享，放进去会影响 Jira 的 `max_turns` 语义。决定在 `src/direct/manager.ts` 增加 loop 状态与分支，规则抽到 `src/direct/auto-continue.ts` 纯函数。

被否决：在 turn-driver 内循环（会改变 Jira 行为、预算无法独立）；在 scheduler 层做（直连不经过 scheduler）。

### 2. 两个动词：`/loop on` 只 arm，`/loop start` 立即开干

`/loop on [N]` 只开启/恢复模式，等下一条用户任务；`/loop start [N]` 立即用当前续跑提示词发一轮。这样“先 `/loop on`，再发任务”成立，不会在旧上下文上自动跑；救急用 `/loop start`（或 `/loop start 1`）。

被否决：`/loop on` 空闲时立即发一轮（会在旧上下文上自动跑，和“先开启再发任务”冲突）；只保留 `/loop on` 并靠用户消息恢复（救急需要再发一句话）；`/loop once`（与 `/loop start 1` 重复）。

预算语义：

- 只计 Auto-continue turns；用户轮不消耗、不改变 `n/N`。
- 默认 5，范围 1–20；`/loop on N` / `/loop start N` 设置**会话级预算偏好**（runtime），不带 N 时沿用，重启回配置默认。
- 暂停保留剩余预算；硬停后，下一次 arm/start 仍可用会话偏好重新开预算（`used = 0`）。
- `agent.max_turns` 完全不动（Jira worker，默认 20）。

### 3. 行为驱动，不用任务内完成协议

不在任务 prompt 里加“完成时输出 DONE”。这会把模型推向收尾态，正好强化“提前结束”的问题，并污染上下文；模型自报也不是可信的外部证据。

判定信号：

| 优先级 | 信号 | 条件 | 动作 |
|---|---|---|---|
| 1 | 用户停止 | `/stop`、`/loop off`、`/done`、`/new`、过期 | 硬停 |
| 2 | 失败/审批超时/用户中断 | `failed`、`permission_timeout`、非用户触发的 `interrupted` | 硬停 |
| 3 | 超时重试 | `turn_timeout` / `inactivity_timeout`，预算允许 | 普通自动轮重试 |
| 4 | 预算用完 | `used >= budget` | 硬停（优先于暂停信号） |
| 5 | 提问 | 最后文本以 `?`/`？` 结尾，或最后一句/分句含「请确认/需要你/是否/要不要/等你确认」或英文 `confirm/should I/do you want` | 暂停 |
| 6 | 重复 | 3-gram Dice ≥ 0.9 + 两轮无文件写操作，连续 2 轮 | 暂停 |
| 7 | 低产出 | `toolCalls === 0` + `outputTokens < 500` + `textChars < 600`，连续 2 轮 | 暂停 |
| 8 | 其他 | — | 继续 |

指标定义：

- `textChars`：本轮所有可见 assistant text 的总字符数。实现上在 `onEvent` 的 `text` 事件累加，**不要**从 `rt.turn.events` 计算——分段后它只保留活跃段。
- `outputTokens`：`result.usage.output_tokens`，不含 input/context、不含 reasoning。
- `fileMutations`：`write` / `edit` / `patch` / `apply_patch` / `multiedit` 计数；`bash` 不算写文件（否则反复跑测试的卡死场景抓不到）。
- `lastText`：最后一个非空 text 事件；用于提问和重复判断。
- `prevLastText`：上一个 Auto-continue turn 的 `lastText`；用户轮、`/loop on N`、`/loop start` 时重置。
- `prevFileMutations`：上一轮的写文件计数，用于满足“连续两轮都没有文件写操作”才判重复。
- 时长只记录，不参与判定（审批/延迟噪音太大）。

被否决：同会话模型自报 `DONE`（会被提前收尾偏差污染）；独立 LLM 裁判（每轮多一次调用，且同样不可靠，留作 v2）；`/accept` 验收命令（v2，出任务会话，不侵入）。

### 4. 软暂停：自动信号不关闭循环

低产出、重复、提问只进入 **Auto-continue pause**：不再调度下一轮，但保持 armed；用户的下一条任务（普通消息/附件、`/send`、卡片重试等会启动用户轮的动作）执行完后自动恢复。纯查看/控制命令（`/status`、`/help`、`/loop prompt`、`/collect` 仅收集）不恢复。`/loop start` 可立即恢复。

硬停：`/stop`、`/loop off`、预算用完、会话结束、`failed`、`permission_timeout`、用户/daemon 中断。硬停后需要 `/loop on` / `/loop start` 重新进入。

被否决：所有停止都 disarm（模型提问后回答完还要重新 `/loop on`）；所有停止都 pause（预算用完/失败后仍会被用户消息意外拉起）。

### 5. 超时按普通自动轮重试

`turn_timeout` / `inactivity_timeout` 说明任务大概率没完成，会话和工作区还在；用**同一份续跑提示词**再跑一轮，算一个 Auto-continue turn，受预算封顶。不加“拆小步/检查 git”的专用提示词（避免把任务编排塞进自动化流程），也不加独立重试计数器。

`permission_timeout`（等审批超时）、`failed`（opencode 错误/权限拒绝）、用户/daemon 中断不重试，直接硬停。

被否决：超时专用恢复提示词（用户明确不要任务编排）；独立超时重试上限（用户选择只靠预算）；所有超时都不重试（用户希望超时后继续）。

### 6. 预算与提示词分开持久化

- 预算偏好：runtime（`SessionRuntime`），重启回配置默认；`/loop on N` / `/loop start N` 设置。
- 提示词：配置默认 + 会话覆盖；覆盖写 `direct_sessions.loop_prompt`，重启后仍生效；`/loop prompt reset` 清空。
- 提示词最大 2000 字，空值拒绝；`/new` 不清除提示词覆盖（`cleanupSession` 只删 runtime）。

被否决：预算也持久化（多一列，且循环本身重启即关）；提示词只存内存（每次重启要重设）；只做全局配置（不同任务无法用不同续跑文案）。

### 7. UI：只改过程卡 header，结果面不动

- `TurnCardState.autoContinue?: { index, max }`；header 在 `ctx` 之后、`片段` 之前拼 `· 🔄 自动 n/N`。同一轮的所有分段都显示（它们共享同一状态）；用户轮不显示。
- 结果消息完全不变，每轮照发纯回答 + 统计行（`sendCompletion` 不改）。
- 暂停/停止是单独一条普通文本，只写原因 + 怎么继续；不重复上一轮答案；最后一张过程卡不封存、不盖停止章、按钮保留。
- `/loop` 及其子命令回执用无按钮信息卡（`buildInfoCard` + `replyInfoCard`，失败回落文本），和 `/auto`、`/help`、`/agent` 一致。
- `quiet` / `summary` 无过程卡，所以无自动标记；结果仍是文本；停止文本照发；命令卡可用则卡片，否则文本。

被否决：结论卡（新增卡片结构、与分段卡并存）；停止章盖最后一段（需要 footer 优先级和 24KB 预算测试）；结果消息加自动 label（污染结果面，且 detailed 下与过程卡重复）；卡片按钮（需要动作、去重、换卡、活跃段守卫和 roundtrip）。

### 8. `/loop` 只在直连话题生效

- intake 群：提示“请在 /chat 话题内使用 `/loop`”。
- Jira 绑定话题：提示“仅直连会话支持 `/loop`”，且**不桥成 Jira 评论**。该守卫放在 `CommentBridge` 的命令处理路径，命中 `/loop` 前缀即回提示并返回。
- 终态直连会话：提示重新 `/chat`。
- `/loop start` 在还没有任务的会话（`turns === 0` 且 `last_prompt == null`）：拒绝“先发任务消息”；`/loop on` 允许 arm。

被否决：静默忽略（Jira 话题里的 `/loop` 仍会被桥成评论）；intake 群预开启再 `/chat` 继承（跨命令状态和清理复杂）。

### 9. 配置面最小化

只暴露运行参数：

```yaml
feishu:
  direct:
    auto_continue:
      budget: 5              # 1–20
      no_progress_streak: 2  # 正整数
      prompt: "继续未完成的部分。不要重复已完成的内容，也不要总结。"
```

低产出阈值（500/600）、重复相似度（0.9）、提问启发式、3-gram 长度写成常量，并记录在 `auto_continue_turn` 日志里。先跑一周看日志，再决定是否暴露。

被否决：全部阈值进配置（配置面/文档/测试膨胀）；只配置 prompt（连预算都要改代码）。

### 10. 状态模型与运行循环

`SessionRuntime` 增加：

```ts
autoContinue: {
  used: number;
  lowWorkRun: number;
  repeatRun: number;
  prevLastText: string | null;
  pausedReason: AutoContinuePauseReason | null;
} | null;
autoContinueBudget: number | null; // 会话偏好；null = 配置默认
```

- `null` = 未开启（硬停/未 arm）；非 null 且 `pausedReason` 非空 = 暂停；否则运行/armed。
- 预算偏好独立于 arming，`/loop off` 不清除，`/new`/重启清除（runtime）。
- `runTurnLoop` 每轮结束后调用纯函数 `classifyAutoTurn(metrics, state, budget)`，返回 `continue | pause | stop | retry`。
- 用户队列非空时优先执行用户轮，`auto = false`，重置 `lowWorkRun` / `repeatRun` / `prevLastText`；该轮结束后若仍 armed，再进入自动轮。
- 自动轮把 `autoContinue: { index: used + 1, max: budget }` 传给 `startTurnCard`；`used` 在开始时或结束时递增，保证卡片显示当前轮。
- `executeTurn` 返回本轮指标（status / toolCalls / fileMutations / outputTokens / textChars / lastText），或在 runtime 上记录；停止决策在 `runTurnLoop`，不塞进 `executeTurn` 的 UI 逻辑。
- 自动轮不写 `direct_sessions.last_prompt`，保证卡片「🔁 重试」仍重跑原始任务。
- 不加定时器；`turnInFlight` 跨自动轮保持 true，`whenIdle` / `stop` 语义不变；`stop()` 的 `halted` 和 `rt.stopRequested` 在每次迭代顶部检查。
- `cleanupSession` 删除 runtime；`/stop` 显式清空 autoContinue；`/loop off` 只清 autoContinue（保留预算偏好）。

### 11. 命令与卡片渲染

`src/bridge/commands.ts` 增加 `parseLoop`：

- `/loop` → status
- `/loop on [N]` → arm
- `/loop start [N]` → start
- `/loop off` → disarm
- `/loop prompt` / `/loop prompt <text>` / `/loop prompt reset`

`src/direct/manager.ts` 的 `handleThreadMessage` 在未知命令分支前处理；回执用 `replyInfoCard` + `buildInfoCard`。

状态卡内容：

- 状态：开启 / 暂停 / 关闭
- 预算：`used/budget`，剩余，来源（默认 / 会话设置）
- 下一次自动轮：`index/budget`
- 计数：低产出 `x/2`，重复 `y/2`
- 提示词：截断显示 + 来源（会话 / 配置）
- 规则摘要 + 上次暂停原因
- 用法一行

暂停/停止文本示例：

```text
🔄 自动续跑已暂停：连续 2 轮低产出（工具 0 · 输出 180/210 tokens · 文本 320/280 字）
回复任意消息自动继续，或 /loop off 关闭。
```

```text
🔄 自动续跑已停止：预算用完（5/5）
/loop start 重新开干，或 /loop on N 设置新预算。
```

## Risks / Trade-offs

- **最坏情况下多次 1 小时超时**：`turn_timeout` 默认 1 小时、预算 5，最坏约 5 小时。用户已确认只靠预算封顶；日志记录 `duration_ms`，可随时 `/stop`。未来若要加独立超时重试上限，可在同一触发点加计数器。
- **误暂停分析型任务**：低产出要求 `toolCalls === 0`，只读文件/跑 `git status` 不算低产出；真正的 0 工具 + 短输出连续两轮才暂停。即使误暂停，软暂停成本是一句话，不是硬停。
- **误继续（只读空转）**：模型连续读文件不写，低产出不触发，靠预算停。日志记录 `toolCalls` / `fileMutations`，一周后可决定是否加“无文件写入”规则。
- **重复误判/漏判**：3-gram Dice 0.9 + 文件写操作门槛；误判成本是软暂停；漏判由预算兜底。短文本退化为相等，空文本不参与重复（交给低产出）。
- **结果消息推送较多**：每轮都发结果消息（5 轮 = 5 条推送）。这是为了不碰 `dropFinalText`/结果面；用户可 `/loop off` 或改用更短预算。后续若需要，可单独做“抑制中间结果”的变更。
- **控制流回归**：`runTurnLoop` / `executeTurn` 是直连热路径。所有新行为在 `autoContinue === null` 时跳过；规则纯函数化；测试覆盖用户抢占、`/stop`、`/loop off`、失败、预算、暂停恢复、`last_prompt` 保护。
- **Jira 守卫触及 comment-bridge**：需要 `tests/comment-bridge.test.ts` 或 `tests/bridge-flow.test.ts`，并按 AGENTS 跑 `npm run test:e2e`。守卫只匹配 `/loop` 前缀，不影响其他命令/自由文本。
- **持久化迁移**：`loop_prompt` 列用既有 `ALTER TABLE` try/catch 模式；旧库无需回填，`null` = 配置默认。循环状态不持久化，重启即关，回滚安全。
- **依赖在途变更**：`segment-turn-cards` 决定 header 渲染位置；`stuck-turn-settlement` 决定 `timed_out` / `permission_timeout` 的结算原因。本变更基于当前工作区，不改 settlement；若两者顺序变化，header 合并点和 timeout 分类需同步调整。

## Migration Plan

1. 新增 `direct_sessions.loop_prompt TEXT`（`ALTER TABLE`，已存在则忽略）；`updateDirectSession` 增加可选 patch 字段；`rowToDirectSession` 读取。
2. 新增配置默认值与 resolver；旧 WORKFLOW.md 无需修改，缺失块使用默认值；功能仍默认关闭（必须 `/loop`）。
3. 代码合并后先跑 `npm run lint` / `npm run typecheck` / `npm test` / `npm run build`；触及 bridge 时跑 `npm run test:e2e`；真实环境可达时跑 `INTEGRATION=1 npm run test:integration`。
4. 上线后用单个会话 `/loop on` 观察 `auto_continue_turn` / `auto_continue_stop` 日志一周，再决定是否调整常量或上 v2 复核。
5. 回滚：删除 `/loop` 分支即可；`loop_prompt` 列保留无害；无循环状态需要清理。

## Open Questions

（无——设计决策已在访谈中逐项确认。剩余实现细节（具体常量、卡片文案排版）在 tasks / 实现阶段按本设计落。）
