## Why

直连 `/chat` 会话目前是“一条用户消息 = 一轮”；模型在长任务中经常提前总结收尾，把未完成的工作留在工作区，用户必须每轮手动回“继续”。Jira 路径已有 `agent.max_turns` 有界续轮，但直连没有。

需要一个**显式开启、行为驱动、可随时关闭**的自动续跑模式：不往任务会话里注入完成协议，不依赖模型自报，按“有没有新动作 / 是否重复 / 是否在提问”决定暂停或停止，并给用户明确的停止原因。

## What Changes

- 新增直连会话的 **Auto-continue** 模式：`/loop on [N]` 只 arm（等下一条任务）；`/loop start [N]` 立即开干；`/loop off` 软停；`/loop` 状态；`/loop prompt` 查看/设置/重置续跑提示词。
- 预算只计 Auto-continue turns，默认 5（范围 1–20）；用户轮不消耗预算；`/loop on N` / `/loop start N` 设置会话级预算偏好（runtime，重启回配置默认）。
- 判定规则：连续 2 轮低产出（0 工具调用 + output < 500 + 可见文本 < 600 字）、连续 2 轮最终文本相似（3-gram Dice ≥ 0.9）且无文件写操作、最后文本像提问 → **软暂停**；`/stop`、`/loop off`、预算用完、会话结束、`failed`、`permission_timeout`、用户/daemon 中断 → **硬停**。
- `turn_timeout` / `inactivity_timeout` 按**普通 Auto-continue turn** 重试（同一续跑提示词，受预算封顶）；`permission_timeout` / `failed` / 用户中断不重试。
- 软暂停保持 armed：普通消息/附件、`/send`、卡片重试等“会启动用户轮”的动作在该轮结束后恢复；纯查看/控制命令不恢复；`/loop start` 可立即恢复。
- 续跑提示词：配置默认 + 会话覆盖，覆盖持久化到 `direct_sessions.loop_prompt`；最大 2000 字；`/loop prompt reset` 回默认。
- UI：过程卡 header 加 `· 🔄 自动 n/N`（所有分段、仅自动轮）；结果消息完全不变、每轮照发；暂停/停止是单独一条普通文本，不盖停止章、不改卡片 footer/按钮；`/loop` 命令回执用无按钮信息卡（`buildInfoCard`）。
- `/loop` 仅在直连话题生效；intake 群提示“请在 /chat 话题内使用”；Jira 绑定话题提示“仅直连会话支持”，且不桥成 Jira 评论。
- **BREAKING**：无。默认关闭；未 `/loop` 的会话行为与今天一致。

## Capabilities

### New Capabilities

（无——全部是既有 capability 的需求变更。）

### Modified Capabilities

- `direct-sessions`: 新增 Auto-continue 模式、`/loop` 命令、预算与暂停/停止规则、超时重试、会话级续跑提示词、过程卡 header 自动标记、暂停/停止文本；结果消息与分段逻辑不变。
- `comment-bridge`: Jira 绑定话题中的 `/loop` 不再作为普通评论桥接，回“仅直连会话支持”提示。
- `workflow-config`: 新增 `feishu.direct.auto_continue.{budget, no_progress_streak, prompt}` 配置块及默认值/校验。

## Impact

- 代码：`src/direct/manager.ts`（loop 状态、`/loop` 分支、`runTurnLoop` 续跑/暂停/停止、指标、停止文本、清理）、`src/direct/auto-continue.ts`（新增纯规则函数）、`src/direct/card.ts`（header 自动标记）、`src/bridge/commands.ts`（解析/help）、`src/bridge/comment-bridge.ts`（Jira 话题守卫）、`src/bridge/binding-store.ts`（`loop_prompt` 列）、`src/config/{config-types,resolver}.ts`、`src/translate/dict.ts`。
- 数据：`direct_sessions` 新增 `loop_prompt` 列（既有 `ALTER TABLE` 模式，旧库可迁移）；循环状态仅在内存。
- 配置：新增 `feishu.direct.auto_continue` 块；无必填项，默认关闭（需 `/loop` 显式开启）。
- 文档：`CONTEXT.md`（Auto-continue 术语已加入）、`docs/adr/0044-...`、`docs/{zh,en}/{usage,configuration,architecture}.md`、help 文案、spec delta。
- 测试：新增 `tests/direct-auto-continue.test.ts`；扩展 `tests/direct-sessions.test.ts`、`tests/direct-card.test.ts`、`tests/commands.test.ts`、`tests/binding-store.test.ts`；`tests/translate-coverage.test.ts`、`tests/docs-links.test.ts`；`comment-bridge` 守卫 + `npm run test:e2e`；真实 API 可达时跑 `npm run test:integration`。
- 依赖：当前工作区有 `segment-turn-cards` 与 `stuck-turn-settlement` 两个在途变更；本提案基于它们之后的语义，不改 turn settlement 本身。
- 非目标：外部 LLM 复核、`/accept` 验收命令、git 进度快照、结论卡/停止章、卡片按钮、Jira 路径自动续跑、循环状态跨重启恢复、结果消息抑制或内容改动。
