# Tasks: fresh-intake-on-start

## 1. BindingStore.deleteMeta（红→绿）

- [x] 1.1 `tests/binding-store.test.ts` 写失败测试：`setMeta("intake_cursor", "1700000005")` 后 `deleteMeta("intake_cursor")`，`getMeta` 返回 `null`；删除不存在的键不抛错；其它键不受影响。然后 `src/bridge/binding-store.ts` 实现 `deleteMeta(key: string): void`（DELETE bridge_meta WHERE key=?）

## 2. CommentBridge.freshStartReset（红→绿）

- [x] 2.1 `tests/comment-bridge.test.ts` 写失败测试：预置 `bridge_meta.intake_cursor` 与 active binding，`freshStartReset()` 后 intake_cursor 为 null；然后实现 `src/bridge/comment-bridge.ts` 的 `freshStartReset()`（先 `deleteMeta("intake_cursor")`）
- [x] 2.2 写失败测试（mock Jira server 返回终态 issue）：对账把 issue 处 `terminal_states` 的 active binding 标 terminal（`listActive` 不再返回）；再补实现对账分支（`fetchIssueStatesByIds` 批量取状态，`isTerminalState` → `markTerminal`）
- [x] 2.3 写失败测试：issue 未出现在返回集（缺省）的 active binding 被标 terminal（同 404「binding cleaned」语义）
- [x] 2.4 写失败测试：issue 仍 active/review 态的 binding 保留 active；终态与存活混排时各自正确
- [x] 2.5 写失败测试：`fetchIssueStatesByIds` 抛错（mock 500）→ 无 binding 被标 terminal、日志 WARN、方法正常返回；实现保守分支

## 3. CLI --fresh 接线（红→绿）

- [x] 3.1 `tests/cli.test.ts`：`start -h` 覆盖 `--fresh`；然后 `src/cli/help.ts` start options 加 `--fresh` 行
- [x] 3.2 `src/cli/index.ts` `runStart` 解析 `--fresh`：`feishu.enabled=false` 时打印提示并继续（0）；`feishu.enabled=true` 时在 `bridge.start()` 前 `await bridge.freshStartReset()`（日志记录 fresh mode）。类型检查 + 既有测试保持绿（daemon 长跑不在单测范围）

## 4. 文档、术语与 ADR（收尾）

- [x] 4.1 `CONTEXT.md` 增补术语（如「Fresh start reset（新机模式重置）」：一次性的 `tasking start --fresh` 启动行为——清本地 intake 游标 + 按 Jira 现状对账 bindings，不回放停机窗口历史；`_Avoid_`: machine takeover、reset-to-fresh）
- [x] 4.2 新增 `docs/adr/0019-fresh-start-intake.md`：记录决策（回旧机器 `--fresh` 复用冷启动探测 + 对账；GQ1/GQ2=方案 b/GQ3 决议）
- [x] 4.3 `docs/{zh,en}/usage.md` start 段补 `--fresh` 选项行与说明；`docs/{zh,en}/feishu-quickstart.md` FAQ「换新机器」条目补「切回旧机器用 `tasking start --fresh`」反向场景；跑 `tests/docs-links.test.ts` 确认双语 parity
- [x] 4.4 全量门禁：`npm run lint` → `npm run typecheck` → `npm test`（含 test:e2e、bridge-flow）；本变更只触及 Feishu bridge/CLI start 面，真实集成不可达时在 MR 注明原因
