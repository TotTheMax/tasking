# Tasks

## 1. help 文案模块

- [x] 1.1 新增 `src/cli/help.ts`：导出 `TOP_LEVEL_HELP`（简介 + usage + 命令列表 + `-h, --help` + “详情见 tasking <cmd> --help”）与 `subcommandHelp(name)`（返回 `init`/`start`/`status`/`logs`/`stop`/`tui` 的帮助文本，未知命令返回 `undefined`）。

## 2. 顶层 help 路由（TDD）

- [x] 2.1 写失败测试：`tasking --help`/`-h` 输出到 stdout、退出码 0，且含六个子命令名与 `--help`（改 `tests/cli-commands.test.ts:148` 捕获 stdout），运行确认红。
- [x] 2.2 在 `src/cli/index.ts` 顶层拦截 `--help|-h` → 输出 `TOP_LEVEL_HELP` 到 stdout、返回 0，运行确认绿。
- [x] 2.3 写失败测试：`tasking help`（无目标）与 `tasking help logs` 输出对应帮助到 stdout、退出码 0；`tasking help bogus` 输出错误到 stderr、退出码 1，运行确认红。
- [x] 2.4 新增 `help` 子命令路由（`help [cmd]`：无目标→顶层；已知命令→子命令帮助；未知→stderr 错误 + 顶层帮助、返回 1），运行确认绿。

## 3. 子命令帮助（TDD）

- [x] 3.1 写失败测试：`tasking init --help`、`tasking status --help`、`tasking logs --help`、`tasking stop --help`、`tasking tui --help`、`tasking start -h` 各自输出对应帮助到 stdout、退出码 0，且覆盖关键选项（init: `--force`/`--update`/`--restore`/`--non-interactive`/`--workflow`；start: `workflow-path`/`--port`/`--tui`/`--detach`；status: `--json`；logs: `--lines`/`--follow`/`--level`；tui: `--port`），运行确认红。
- [x] 3.2 在各子命令 handler 入口短路 `--help|-h` → 输出 `subcommandHelp(name)` 到 stdout、返回 0，运行确认绿。
- [x] 3.3 补回归断言：`tasking --help` 与各子命令帮助均不含 `triage`；无子命令仍走 stderr 退出 1；未知子命令仍走 stderr 退出 1。
- [x] 3.4 修复进程退出码透传：入口守卫 `main(...).then((code) => process.exit(code))`，仅作为 CLI 入口执行时生效（测试导入不触发）；补进程级子进程测试断言 `--help` 退出 0、`bogus`/无参数/`status` 无 daemon 退出 1。

## 4. 文档

- [x] 4.1 新增 `docs/adr/0008-cli-help-single-source.md`：手写 help 模块（不引入 CLI 框架）、英文文案、`help [cmd]` 与 `<cmd> --help` 双入口、显式 help 走 stdout。
- [x] 4.2 `docs/usage.md` 命令详解处补充“帮助入口”说明（`tasking <cmd> --help` 与 `tasking help [cmd]`）。

## 5. 验证

- [x] 5.1 `npm run lint && npm run typecheck && npm test` 全绿。
