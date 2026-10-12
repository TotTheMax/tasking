## Why

TUI running 任务详情页把 `task.description` 全部行无上限渲染，长描述会撑高详情框超出终端高度，把上方 Title/State/Assignee 等字段顶出屏幕。用户看不到上半部分关键字段，且没有任何交互可以恢复查看。

## What Changes

- **描述默认折叠**：`formatRunningDetailFromState` 渲染 Description 时默认最多显示 6 个折行后的行（内容区宽 48 列）；超过则截断并显示 `… (N more lines)` 标记，同时提示可用 `e` 展开。空/`null` 描述仍不渲染 Description 区块。
- **`e` 键展开/收起**：在 `detail-running` 模式按 `e` 在"折叠 ↔ 完整"之间切换。展开时渲染描述全部行（沿用既有折行逻辑）；再按 `e` 收起回默认 6 行。折叠态 footer 提示 `e expand`、展开态提示 `e collapse`。
- **不记忆展开状态**：每次进入详情页均为默认折叠态（进入详情时重置），展开状态不跨任务、不跨详情会话记忆（推荐方案，见 TAS-26 拷问 Q3）。

## Capabilities

### New Capabilities

（无 —— 本变更是对既有 `terminal-dashboard` 能力的演化，按既有能力边界做 delta。）

### Modified Capabilities

- `terminal-dashboard`: "运行中详情视图全量显示描述" 需求改为"默认折叠 + 可展开"——描述默认最多显示 6 折行行、超出标记 `… (N more lines)`、`e` 键切换展开/收起、进入详情时重置展开状态。

## Impact

- `src/observability/terminal-dashboard.ts`：`formatRunningDetailFromState` 描述渲染块改为折叠输出；`processKey` 增加 `e` 键处理（`detail-running` 模式）；详情页 footer 提示更新。
- 测试：`tests/terminal-dashboard.test.ts` 更新"全量显示"既有用例为折叠语义，并新增折叠/展开/标记/`e` 键用例。
- 文档：`openspec/changes/fix-tui-description-truncation/specs/terminal-dashboard/spec.md` delta 需求；`docs/usage.md`（双语）running 详情页描述折叠/展开说明同步。
- `docs/adr/0015-task-detail-description-truncation.md`（本变更中创建）标记为 accepted 并补全最终决策。
