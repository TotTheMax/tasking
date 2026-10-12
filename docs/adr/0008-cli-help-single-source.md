# CLI help 单一文案来源模块（不引入 CLI 框架）

`tasking` 的 CLI help 此前是 `src/cli/index.ts` 里的静态 usage 字符串，无命令/选项说明，`tasking <cmd> --help` 还会因 `parseArgs` strict 抛错。TAS-8 决定新增 `src/cli/help.ts` 作为全部 help 文案的唯一来源（`TOP_LEVEL_HELP` + `subcommandHelp(name)`），继续用 `node:util` 的 `parseArgs` 解析选项而**不引入** commander/yargs 等 CLI 框架——当前仅 6 个公开子命令、运行时依赖极少，框架收益不足以抵消依赖与风格不一致。help 文案为英文（与现有 CLI 输出一致，中文说明在 `docs/usage.md`）。帮助入口同时支持 `tasking <cmd> --help|-h` 与 `tasking help [cmd]`；显式 `--help`/`help` 输出到 stdout 且退出码 0，无子命令/未知子命令/未知 `help` 目标输出到 stderr 且退出码 1。`triage` 保持隐藏，不出现在任何 help 文本。
