## Why

`docs/known-issues.md` 的高优先级两项实际问题：① 终端 TUI 的任务详情框里 Description 只显示前 200 字符/前 5 行，超长描述被截断；② 飞书 `/issue` 建 issue 时，原始消息（标题+描述）除了写进 description 字段，还被额外写成该 issue 的首条 comment，与 summary/description 字段内容重复。两者均为明确的 UX 缺陷，按文档要求修复。

## What Changes

- **TUI 详情全量显示描述**：running 任务详情视图（`formatRunningDetailFromState`）的 Description 区块不再截断——移除 200 字符截断与 5 行上限，逐行完整渲染 `task.description`（含多行）。该变更仅影响详情视图，overview 列表保持原样。
- **移除 `/issue` 首条冗余 comment**：`executeIssue` 建 issue 成功后不再把原始消息（标题+描述）作为首条 comment 写入。issue 的 summary/description 字段已承载全部内容，comment 属于重复信息。桥接循环安全性不受影响（防环靠 sentinel 与 binding，不依赖该首条 comment）。

## Capabilities

### New Capabilities

### Modified Capabilities

- `terminal-dashboard`: running 任务详情视图的 Description 区块全量显示，不再截断（移除 200 字符/5 行上限）。
- `feishu-source`: 移除 `/issue` 建 issue 后写首条 sentinel comment 的行为。

## Impact

- 改：`src/observability/terminal-dashboard.ts`（详情描述全量渲染）、`src/bridge/comment-bridge.ts`（删除 executeIssue 内 postComment 调用）。
- 文档：`docs/known-issues.md`（勾除两项高优先级问题）、`docs/usage.md`（删首条 comment 描述）、`docs/feishu-quickstart.md`（同步删首条 comment 描述）、`docs/adr/`（新增反转首条 comment 设计的 ADR）。
- 测试：`tests/terminal-dashboard.test.ts`（长描述全量显示）、`tests/comment-bridge.test.ts`（删除首条 comment 相关断言）。
- 不动：`src/scheduler/*`、`src/worker/*`、`src/mcp/*`、桥接的 binding/同步/命令逻辑主线、`wrapDescription`（description 落库逻辑保留）。
