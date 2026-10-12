## Why

activity 页（TUI 活动视图）只能看到工具调用的名字（`bash`/`write`）或 `step` 标记，回车展开后也看不到具体执行——命令、参数、输出全被丢弃。用户无法确认 agent 到底做了什么，违背"对用户透明友好"的目标。

## What Changes

- **worker 捕获完整工具执行详情**：`parseOpencodeLine` 对 `tool_use` 事件除工具名外，同时提取 `part.state` 中的参数（`input`）、stdout（`output`）、退出码（`metadata.exit`）、友好摘要（`title`）、状态（`status`）与耗时（`time.start/end`）。
- **`ActivityEvent` 模型扩展**：新增可选的工具执行字段（`input`/`output`/`exit`/`title`/`status`/`duration`），TUI 与 HTTP API（`/api/v1/<id>/activity`）共享同一丰富模型。
- **活动列表行显示摘要**：`tool_use` 行显示 `🔧 <工具> · <摘要>`，摘要取 opencode 自带 `title`（bash→命令、write/read→文件路径），按终端宽度截断。
- **回车展开显示结构化详情**：详情浮层对工具调用展示状态与退出码（失败高亮）、工具名、参数/命令（格式化）、stdout 输出（可滚动）、耗时；不再是无文本的空浮层。
- **大输出截断**：详情视图对超长输出设展示上限并标记 `… (truncated)`；opencode 自身截断（`metadata.truncated`）同样标记。

## Capabilities

### New Capabilities

（无 —— 本变更是对既有 activity 能力的演化，按既有能力边界拆分为两个 delta，避免能力碎片化。）

### Modified Capabilities

- `task-activity`: `tool_use` 事件捕获从仅工具名扩展为完整执行详情（参数 `input`/输出 `output`/退出码 `exit`/摘要 `title`/状态 `status`/耗时 `durationMs`）；`ActivityEvent` 模型与 `ActivityStore` 承载这些新可选字段。
- `activity-text-expand`: 工具调用列表行渲染与回车展开内容改变——列表行显示 `🔧 <工具> · <摘要>` 一行摘要（失败红色 `✗` 标记），详情浮层对工具调用渲染结构化执行详情（状态/退出码/参数/输出/耗时），大输出按尾部截断并标记。

## Impact

- `src/worker/runner.ts`：`OpencodeEvent`/`parseOpencodeLine` 扩展，`runAttempt` 的 activity 上报携带新字段。
- `src/observability/activity-store.ts`：`ActivityEvent` 接口扩展（新增可选字段，兼容既有字段）。
- `src/observability/terminal-dashboard.ts`：`formatActivity` 列表行渲染、`formatActivityDetail`/`getActivityDetailBody` 详情渲染、大输出截断逻辑。
- `src/observability/http-dashboard.ts`：`/api/v1/<id>/activity` 透出丰富字段（同源模型，无代码改动或极小）。
- 测试：`tests/worker.test.ts`、`tests/observability.test.ts`、`tests/terminal-dashboard.test.ts` 新增/更新用例。
- 文档：`docs/{usage,architecture}.md`（双语）与 `openspec/specs/{task-activity,activity-text-expand}.md` 需同步。
