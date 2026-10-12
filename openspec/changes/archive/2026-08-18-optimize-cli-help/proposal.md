# 优化 CLI help 显示

## Why

当前 `tasking` 的 help 是 `src/cli/index.ts` 里的一个静态 usage 字符串：只有用法行，没有命令说明、没有选项说明，也没有每个子命令的帮助。`tasking <cmd> --help` 目前甚至会抛 `ERR_PARSE_ARGS_UNKNOWN_OPTION`，对用户不友好（TAS-8 反馈）。

## What Changes

- 顶层 `tasking --help` / `tasking help`：命令列表 + 一句话说明 + “详情见 `tasking <cmd> --help`”，保持紧凑。
- 每个子命令帮助（`tasking <cmd> --help|-h` 与 `tasking help <cmd>`）：usage、参数说明、选项表（含短选项、默认值、互斥提示）。
- 显式 `--help` 输出到 stdout、退出码 0；无子命令/未知子命令的错误仍走 stderr、退出码 1。
- 新增 `src/cli/help.ts` 作为全部 help 文案的唯一来源。
- 文案为英文（与现有 CLI 输出一致）。
- 帮助入口支持 `tasking help [cmd]` 与 `tasking <cmd> --help|-h` 两种。
- `triage` 保持隐藏，不出现在任何 help 文本中。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cli-runtime`: CLI help 输出行为 —— 顶层 help 增加命令说明与子命令帮助指引；每个子命令支持 `--help|-h` 与 `help <cmd>`；显式 help 走 stdout 退出码 0。

## Impact

- `src/cli/index.ts`：删除静态 `USAGE` 常量，接入 help 路由（顶层 `--help`/`help` 子命令/每子命令 `--help`）。
- `src/cli/help.ts`（新增）：顶层 help 与各子命令帮助文案、`subcommandHelp()` 查询函数。
- `tests/cli.test.ts` / `tests/cli-commands.test.ts`：帮助相关断言改为捕获 stdout；新增各子命令帮助与 `help <cmd>` 测试。
- 无新增依赖、无配置项、无数据模型变更。

## 拷问结论（TAS-8 Jira 评论 11426/11427/11428/11429）

- Q1 语言：英文。
- Q2 实现方式：手写轻量 help 模块（不引入 commander/yargs）。
- Q3 帮助入口：支持 `tasking <cmd> --help|-h` 与 `tasking help [cmd]`；显式 `--help` 输出到 stdout 且退出码 0，错误/未知命令走 stderr 退出码 1。
