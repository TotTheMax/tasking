## Test seams（实现前确认）

- `src/direct/auto-continue.ts` 纯函数：指标、低产出/重复/提问、优先级、计数重置。
- `src/bridge/commands.ts` 的 `parseLoop`。
- `DirectSessionManager.handleThreadMessage` / `runTurnLoop`（沿用现有 deps 注入与 fake turn driver）。
- `buildTurnCard` 的 header 渲染（`tests/direct-card.test.ts`）。
- `BindingStore.updateDirectSession` / `getDirectSession` 的 `loop_prompt` 读写。
- `CommentBridge` 的 Jira 话题消息处理（`/loop` 守卫）。
- config resolver / validator。

## 1. 基础：术语、配置、持久化

- [x] 1.1 核对 `CONTEXT.md` 的 Auto-continue 术语与 Turn 定义（proposal 阶段已写入；补齐遗漏）
- [x] 1.2 新增 `feishu.direct.auto_continue` 配置 schema / DEFAULTS / resolver（先写失败的 config + resolver 测试，再实现 `budget` 1–20、`no_progress_streak` 正整数、`prompt` 非空 ≤2000 的解析与校验）
- [x] 1.3 新增 `direct_sessions.loop_prompt` 列与 store patch（先写失败的 binding-store 迁移/读写测试，再实现 `ALTER TABLE`、`updateDirectSession`、`rowToDirectSession`）
- [x] 1.4 新增 `parseLoop` 与 `/loop` help 文案（先写失败的 commands 测试，再实现 `on|start|off|prompt|status` 解析与用法错误）

## 2. 纯规则引擎 `src/direct/auto-continue.ts`

- [x] 2.1 实现归一化与 3-gram Sørensen–Dice（先写失败单测：相同、近似、完全不同、短文本、代码块/标点差异）
- [x] 2.2 实现指标模型与低产出判定（先写失败单测：0 工具 + 短输出命中；1 个 read 不命中；`textChars` 汇总整轮文本）
- [x] 2.3 实现重复判定与文件写操作门槛（先写失败单测：相同/近似文本命中；有 `edit`/`write` 不命中；`bash` 不算写文件）
- [x] 2.4 实现提问启发式（先写失败单测：`?`/`？`、中文关键词、英文关键词、正文中间提问但结尾是结论不命中）
- [x] 2.5 实现 `classifyAutoTurn` 的优先级与预算硬停（先写失败单测：用户/失败/超时重试/预算/提问/重复/低产出/继续；预算优先于提问）
- [x] 2.6 实现计数重置规则（先写失败单测：用户轮、文件写、非重复文本、`/loop on N`、`/loop start`、超时重试）

## 3. 生命周期接入 `DirectSessionManager`

- [x] 3.1 增加 runtime loop 状态与会话预算偏好（先写失败的 direct-sessions 测试：arm / paused / off、用户轮不消耗预算）
- [x] 3.2 改 `runTurnLoop`：队列空时按 loop 状态继续/暂停/停止（先写失败测试：成功后续轮、用户抢占、暂停后用户轮恢复、纯命令不恢复）
- [x] 3.3 自动轮不覆盖 `last_prompt`（先写失败测试：自动轮后「🔁 重试」仍重跑最近用户任务）
- [x] 3.4 超时重试与失败硬停（先写失败测试：`turn_timeout`/`inactivity_timeout` 用同一提示词重试并消耗预算；`permission_timeout`/`failed`/用户中断不重试；预算用完硬停）
- [x] 3.5 `/stop`、`/loop off`、`/new`、`/done`、TTL、restart 的清理与预算偏好保留（先写失败测试）
- [x] 3.6 `/loop on|start|off|prompt` 的处理（先写失败测试：`on` 不发轮、`start` 立即发轮、running 时延后、无任务拒绝、prompt 持久化、`/loop off` 软停）
- [x] 3.7 暂停/停止原因文本（先写失败测试：低产出/重复/提问/预算/失败/审批超时；不重复上一轮答案；带恢复方式）

## 4. UI

- [x] 4.1 `TurnCardState.autoContinue` 与 header 标记（先写失败的 direct-card 测试：有/无标记、位置在 `ctx` 与 `片段` 之间）
- [x] 4.2 `startTurnCard` 传递自动标记（先写失败的 direct-sessions 测试：自动轮所有分段显示 `自动 n/N`，用户轮不显示）
- [x] 4.3 `/loop` 状态卡与子命令回执（先写失败测试：无按钮信息卡、状态/预算/计数/提示词/规则/上次暂停原因、卡片失败回落文本）
- [x] 4.4 `quiet` / `summary` 行为（先写失败测试：无过程卡自动标记、结果仍为纯文本、暂停/停止文本照发）

## 5. 入口守卫

- [x] 5.1 intake 群 `/loop` 提示（先写失败测试：回复“请在 /chat 话题内使用”，不创建会话）
- [x] 5.2 Jira 绑定话题 `/loop` 不桥接（先写失败的 comment-bridge 测试：回“仅直连会话支持”、不写 Jira、不重复消费；按 AGENTS 跑 `npm run test:e2e`）
- [x] 5.3 终态会话 `/loop` 提示（先写失败测试：done/expired 提示重新 `/chat`）

## 6. 文档与翻译

- [x] 6.1 `src/translate/dict.ts` 补齐所有新文案双语（先跑 `tests/translate-coverage.test.ts` 失败，再补齐）
- [x] 6.2 更新 `docs/{zh,en}/{usage,configuration,architecture}.md`（`tests/docs-links.test.ts` 通过）
- [x] 6.3 新增 `docs/adr/0044-auto-continue-direct-session-loop.md`
- [x] 6.4 更新 direct help / unknown command / `/chat` help 中的 `/loop` 入口

## 7. 门禁与冒烟

- [x] 7.1 `npm run lint` / `npm run typecheck` / `npm test` / `npm run build`
- [x] 7.2 `npm run test:e2e`（bridge 守卫）
- [x] 7.3 真实环境可达时 `INTEGRATION=1 npm run test:integration`
- [ ] 7.4 人工冒烟：普通 `/chat`（不 `/loop`）；`/loop on` → 发任务；`/loop start`；自动轮中插话；暂停后恢复；`/loop prompt`；`/loop off`；`/stop`；daemon 重启（未执行：需要真人在飞书 UI 操作；自动化门禁与真实 API 集成已通过）
