# 优化 CLI help 显示

## Context

`tasking` 的 CLI 入口在 `src/cli/index.ts`：help 是一个静态 `USAGE` 字符串（`index.ts:30-40`），只有用法行，无命令/选项说明。各子命令用 `node:util` 的 `parseArgs`（strict 模式）解析且未注册 `help` 选项，因此 `tasking <cmd> --help` 会抛 `ERR_PARSE_ARGS_UNKNOWN_OPTION`。现有测试 `tests/cli-commands.test.ts:148` 捕获 stderr 断言顶层 help 含 `tui`/`stop` 且不含 `triage`。

拷问结论（TAS-8 Jira 评论 11426/11427/11428/11429）：英文文案、手写轻量 help 模块（不引入框架）、同时支持 `tasking <cmd> --help|-h` 与 `tasking help [cmd]`、显式 help 走 stdout 退出码 0。

## Goals / Non-Goals

**Goals:**
- 顶层 help：命令列表 + 一句话说明 + “详情见 `tasking <cmd> --help`”。
- 每个公开子命令（`init`/`start`/`status`/`logs`/`stop`/`tui`）有独立帮助：usage、参数说明、选项表（短选项、默认值、互斥提示）。
- 两个帮助入口：`tasking <cmd> --help|-h` 与 `tasking help [cmd]`。
- 显式 `--help`/`help` → stdout、退出码 0；无子命令/未知子命令/未知 `help <target>` → stderr、退出码 1。
- `triage` 保持隐藏，不出现在任何 help 文本。

**Non-Goals:**
- 不引入 commander/yargs 等 CLI 框架。
- 不改子命令行为/选项语义，仅新增帮助展示。
- 不本地化（不产出中文 help）。
- 不生成 help 的 markdown/man 文档。

## Decisions

### D1：新增 `src/cli/help.ts` 作为唯一文案来源
顶层 help 与各子命令帮助全部集中在一个模块，导出 `TOP_LEVEL_HELP`、`subcommandHelp(name)`。`index.ts` 只负责路由。
- 备选：在 `index.ts` 内联多段模板字符串——文件膨胀、测试与修改互相干扰；每个命令 handler 内各自拼写——文案散落、易漂移。
- 理由：单一来源便于测试与保持一致；`subcommandHelp()` 返回 `string | undefined`，未知命令时 `index.ts` 打印错误。

### D2：手写帮助文本，不引入 CLI 框架
继续用 `node:util` 的 `parseArgs` 解析选项，帮助文本为手写的紧凑文本块，不尝试从选项定义自动生成。
- 备选：commander/yargs —— 自动帮助/子命令路由/校验，但给仅 6 个公开子命令的 CLI 增加运行时依赖，且与现有 `parseArgs` 风格不一致。
- 理由：依赖最少、改动局部、可完全控制格式。帮助文本与选项语义对齐的验证靠测试而非生成器。

### D3：帮助路由在 `parseArgs` 之前判定
`index.ts` 顶层把 `--help`/`-h` 与 `help` 子命令在进入 `parseArgs` 前拦截；各子命令 handler 入口先检查 `--help|-h`（返回 0），再做选项解析。
- 备选：给每个子命令的 parseArgs options 注册 `help`——会进入各 handler 的选项流，且 `init` 的 `--force/--update/--restore` 互斥校验、`start` 的 `--detach` spawn 逻辑都要先排掉 help。
- 理由：help 是展示层，提前短路最简单、不会与业务选项互斥逻辑纠缠。

### D4：显式 help 走 stdout、退出码 0；错误走 stderr、退出码 1
`tasking --help|-h`、`tasking help [cmd]`、`tasking <cmd> --help|-h` 输出到 stdout 且返回 0。无子命令、未知子命令、`help` 后跟未知命令输出到 stderr 且返回 1（沿用现有“无子命令/未知子命令打印 usage 退出 1”的行为）。
- 备选：维持全走 stderr——与 Unix 惯例（显式请求的输出到 stdout）不符，脚本 `tasking --help | grep` 会读到错误流。
- 理由：Unix CLI 惯例；显式请求的信息是可编程消费的 stdout。

### D6：进程退出码透传（修复既有缺陷）
实现时发现既有缺陷：`src/cli/index.ts` 底部的 `main(process.argv).catch(...)` 从不把 `main` 的返回值透传给 `process.exit`，导致 `tasking status`（无 daemon）、`tasking bogus`、无参数等本应退出 1 的路径在 OS 层面都以 0 退出（与 `docs/usage.md` 文档化的退出码不符）。修复为入口守卫：仅当本模块作为 CLI 入口被执行时（`process.argv[1]` 解析后等于本文件路径），`main(...).then((code) => process.exit(code))`；作为模块被测试导入时不触发退出。`start` 前台路径返回永不 resolve 的 Promise，进程退出仍由 SIGINT/SIGTERM 处理器负责，不受影响。

### D5：文案为英文、与现有 CLI 输出一致
描述句与选项表用英文（现有 `--help`/错误/日志均为英文）；详细中文说明仍由 `docs/usage.md` 承担。

## Risks / Trade-offs

- [帮助文本与真实选项语义漂移] → 每个子命令的帮助由测试断言关键选项存在；改动选项时更新对应 help 测试。
- [帮助文本手工对齐 parseArgs 选项容易漏短选项] → 选项表以“长选项（短选项） 说明”格式书写，测试覆盖各子命令的短选项。
- [`console.error` 被替换为 `process.stdout.write` 破坏现有测试] → 按任务更新 `tests/cli-commands.test.ts` 的捕获方式（改为捕获 stdout）。

## Migration Plan

无迁移：纯 CLI 展示层改动，`tasking start` 运行时逻辑不变。回滚 = 回退本 MR。

## Open Questions

无。
