## Why

`tasking init` 的输出是一串平铺纯文本，无视觉层次——关键信息（通过/失败状态、必须编辑的字段、下一步动作）淹没在提示文字中，用户无法快速扫到重点。TUI 已有成熟的 ANSI 样式词汇（`╭─│╰` 边框、颜色、图标），但 init 没有复用。

## What Changes

- 新增 `src/cli/style.ts` 共享样式模块：ANSI 常量（`RESET`/`BOLD`/`DIM`/`CYAN`/`GREEN`/`YELLOW`/`RED`/`GRAY`）+ 辅助函数（`boxHeader`/`boxLine`/`boxFooter`/`statusIcon`/`stripAnsi`）。TUI 不动，以后可迁移。
- init 交互模式输出按阶段分节：`Prerequisites` → `Jira Setup` → `Connection Test` → `Initialization` → `Next Steps`。每节用 `╭─` / `│` / `╰──` 左边框包裹（匹配 TUI logs 视图风格，无右边框）。
- 前置检查（opencode/glab/GitLab token）从末尾提前到最前，全部非阻断，用 `✓`(GREEN)/`✗`(RED)/`⚠`(YELLOW) 状态图标标记。
- 交互提问行也加 `│` 边框，问题文本用 `BOLD`，提示用 `GRAY DIM`。
- 连接测试结果用状态图标标记成功/失败，项目状态列表用 `·` 前缀。
- "Next Steps" 节字段说明用 `GRAY DIM` 压低，`tasking start` 用 `GREEN BOLD` 突出。
- 非交互模式：轻量成功 banner（`✓` + 路径列表），无边框。`isTTY` 检测，非 TTY 时自动去色输出纯文本。

## Capabilities

### New Capabilities

无新能力。

### Modified Capabilities

- `interactive-init`: init 交互式输出增加分节边框、状态图标、前置检查提前、提问样式、Next Steps 视觉层次
- `cli-runtime`: 非交互式 init 输出增加轻量成功 banner + isTTY 自动去色

## Impact

- 新增 `src/cli/style.ts` 模块
- 修改 `src/cli/init.ts`：重构 `runInteractiveInit` 输出流、重排前置检查顺序、改写各检查/提示函数的输出格式
- 修改 `src/cli/prompts.ts`：`ask`/`askSelect` 的提问格式串加 `│` 前缀和 `BOLD` 样式
- 修改 `tests/init.test.ts`：断言从匹配纯文本改为匹配去色后的文本内容（`stripAnsi`）
- 无新增运行时依赖
