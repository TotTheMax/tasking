## Context

`tasking init` 的交互式输出当前是一串平铺纯文本，通过 `output.write()` 直接写入，无视觉层次。TUI（`terminal-dashboard.ts`）已有成熟的 ANSI 样式词汇——颜色常量（`RESET`/`BOLD`/`DIM`/`CYAN`/`GREEN`/`YELLOW`/`RED`/`GRAY`）、`╭─│╰` 左边框、braille spinner——但 init 没有复用。项目运行时依赖仅 2 个（`@opencode-ai/plugin`、`better-sqlite3`），TUI 用原始 ANSI 码而非第三方库。

init 流程当前顺序：凭据收集 → 连接测试 → 写文件 → 前置检查（opencode/glab/GitLab token）→ 编辑器打开 → 完成提示。前置检查在最后，用户填完凭据才发现缺工具。

## Goals / Non-Goals

**Goals:**
- init 输出有清晰的视觉层次——分节边框、状态图标、颜色分级
- 前置检查提前到最前，用户一上来就知道环境缺什么
- 关键动作（`tasking start`）突出，说明文字退到背景
- 非交互模式输出简洁、CI 友好（纯文本可 grep）
- 共享样式模块为未来 TUI 迁移留路

**Non-Goals:**
- 不重构 TUI 的 ANSI 常量（TUI 保持现状，以后可迁移到 `style.ts`）
- 不引入第三方颜色库（chalk/picocolors 等）
- 不改变 init 的功能行为（凭据收集逻辑、连接测试逻辑、文件生成逻辑不变）
- 不做 i18n 多语言支持
- 不改变非交互模式的文件生成逻辑（仍复制 `WORKFLOW.md.example`）

## Decisions

### 1. 原始 ANSI 码 + 共享 `style.ts` 模块，不引第三方库

**选择：** 新建 `src/cli/style.ts`，导出 ANSI 常量和辅助函数。不引入 chalk/picocolors。

**理由：** TUI 已用原始 ANSI 码证明了这条路可行。项目运行时依赖仅 2 个，引第三方库为一个 CLI 引导输出增加依赖不划算。`style.ts` 导出与 TUI 同名的常量，TUI 以后想迁移时 import 替换即可。

**替代方案：** picocolors（3.8KB，自动 TTY 检测）——被否决，因为 init 已有 `isTTY` 判断逻辑可复用，不需要为此引依赖。

### 2. ╭─│╰ 左边框分节，无右边框

**选择：** 每节用 `╭─ Title ───` 开头、`│` 行前缀、`╰──────` 结尾。无右侧 `│` 边框。

**理由：** 匹配 TUI logs 视图的现有风格（`formatLogs()` 第 737-773 行）。右边框需要终端宽度对齐，中文字符宽度计算复杂，容易错位——TUI 也不用右边框。

### 3. 状态图标 ✓/✗/⚠/· 语义化

**选择：** `✓`(GREEN) 通过、`✗`(RED) 失败、`⚠`(YELLOW) 警告、`·`(GRAY) 信息。

**理由：** TUI 用 `●` 圆点表示状态，但 init 的检查清单语义更适合对勾/叉号。`·` 用于非状态信息（如"工作区根目录已存在"），与状态图标区分。

### 4. 前置检查提前到凭据收集之前

**选择：** 交互模式流程改为：Prerequisites → Jira Setup → Connection Test → Initialization → Next Steps。opencode/glab/GitLab token 检查提前到最前。

**理由：** 如果 opencode 未安装，用户填完凭据才发现 daemon 跑不了是浪费时间。前置检查是毫秒级非交互操作，提前不增加负担。全部非阻断——opencode 缺失也只警告不退出（用户可能之后装）。

### 5. 交互提问加 │ 边框 + BOLD 问题 + GRAY DIM 提示

**选择：** readline 提问格式串加 `│` 前缀。问题文本用 `BOLD`，提示文字用 `GRAY DIM`。

**理由：** `│` 边框贯穿所有阶段保持一致风格。`readline.question()` 传入带 `│` 前缀的格式串，用户输入紧跟 `: ` 之后，不影响交互。`BOLD` 让问题文本从提示中突出，`GRAY DIM` 让 tip 退到背景。

### 6. 非交互模式轻量 banner + isTTY 自动去色

**选择：** 非交互模式只打 `✓ tasking initialized` + 路径列表，无边框。交互模式检测 `output.isTTY`，非 TTY（管道/重定向）时自动去色。

**理由：** CI/脚本场景输出简洁优先，`│` 边框增加噪音。非 TTY 时纯文本便于 `grep`/`awk`。`style.ts` 的辅助函数接受 `useColor: boolean` 参数，`false` 时输出纯文本。

### 7. 全英文输出

**选择：** 所有 init 输出保持英文，与 TUI、日志、错误信息一致。

**理由：** CLI 工具输出英文是行业惯例，日志搜索/grep 更方便。文档（`docs/`）保持中文，但 CLI 输出与文档分离。

## Risks / Trade-offs

- **[测试断言变更]** → 现有 `tests/init.test.ts` 断言匹配纯文本，加入 ANSI 码后断言会失败。缓解：`style.ts` 导出 `stripAnsi()` 函数，测试用 `stripAnsi` 预处理输出后再匹配文本内容。
- **[readline │ 边框与用户输入交错]** → `readline.question()` 把格式串写到 output，用户输入在同一行。`│` 前缀出现在格式串中不影响输入。但如果终端有回显延迟，`│` 可能短暂可见——可接受。
- **[终端兼容性]** → ✓/✗/⚠/· 和 ╭─│╰ 是 Unicode 字符，极旧终端可能显示乱码。缓解：目标用户是 Node 22+ 开发者，终端兼容性不是问题。
- **[style.ts 与 TUI 常量重复]** → `style.ts` 和 `terminal-dashboard.ts` 有同名常量。缓解：已记录为已知技术债，TUI 以后可迁移。本次不碰 TUI。
