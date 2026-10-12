# Proposal: fresh-intake-on-start

## Why

新机器跑完任务后切回旧机器继续运行时，旧机器本地持久化的飞书桥状态（`bindings.db` 的 `bridge_meta.intake_cursor` 与 binding 表）落后于新机器期间的消费进度：daemon 启动即 Sweep → `discoverIntake` 把「新机器已消费、对应 issue 已完成」的 intake 群根消息当作新消息重放 → 旧机器本地无 binding → 重复 `createIssue` → 调度器把新机器已完成的任务重复拉取派发。需要一个 `tasking start` 的一次性 option，让旧机器像新机器一样启动（ADR 0016 冷启动探测语义），不回放停机窗口历史。

## What Changes

- **`tasking start --fresh`（新 option）**：以「新机器方式」启动飞书桥，仅在 `feishu.enabled` 时生效——(1) 清空本地 `bridge_meta.intake_cursor`，下轮 Sweep 自然走既有冷启动探测，只消费当前时刻起的新消息，不回放停机窗口内的历史根消息；(2) 本地 active bindings 与 Jira 现状对账：issue 已处 terminal_states（或已从追踪器消失/404）的 binding 标 terminal 停止镜像，仍 active/review 的保留；(3) `feishu.enabled=false` 时打印提示并以 0 继续启动（no-op）
- **`BindingStore.deleteMeta(key)`** 新方法：删除 `bridge_meta` 键（清空 intake_cursor 以复用既有冷启动探测代码路径）
- **`CommentBridge.freshStartReset()`** 新公开方法：先清 intake_cursor，再批量按 Jira 现状对账 active bindings；对账查询失败时保守保留全部 binding（不误杀），仅日志 WARN
- help/usage/quickstart 双语文档与 ADR 同步

## Capabilities

### New Capabilities

无（不新增能力面，行为并入既有 `comment-bridge` 与 `cli-runtime`）

### Modified Capabilities

- `comment-bridge`: 新增「fresh start 重置本地桥状态」需求——清空 intake 游标走冷启动探测、按 Jira 现状对账 bindings（终态/缺失标 terminal、active/review 保留、查询失败保守保留）
- `cli-runtime`: `tasking start` 新增 `--fresh` option 及与 `feishu.enabled` 的关系（未启用飞书时提示 no-op）

## Impact

- **代码**：`src/bridge/binding-store.ts`（新增 `deleteMeta`）、`src/bridge/comment-bridge.ts`（新增 `freshStartReset`）、`src/cli/index.ts`（`--fresh` 解析与接线）、`src/cli/help.ts`（option 行与 help 文案）
- **测试**：`tests/binding-store.test.ts`（`deleteMeta`）、`tests/comment-bridge.test.ts`（`freshStartReset` 各分支：清游标/终态标记/缺失标记/保留/查询失败保守）、`tests/cli.test.ts`（help 覆盖 `--fresh`）
- **文档**：`CONTEXT.md` 术语、`docs/adr/0019-fresh-start-intake.md`、`docs/{zh,en}/usage.md`（start 选项表）、`docs/{zh,en}/feishu-quickstart.md`（回旧机器 FAQ）；`tests/docs-links.test.ts` 双语 parity 保持绿
- **不受影响**：scheduler、worker、workspace、MCP、config schema、event channel（`--fresh` 只改启动时本地桥状态；事件实时通道照常）
- **无依赖变更**：lockfile 不动，无需 pack-deps
