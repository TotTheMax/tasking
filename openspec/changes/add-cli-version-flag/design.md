## Context

`main()`（`src/cli/index.ts`）在子命令分发前处理 `--help`/`-h` 与 `help`；`--version`/`-v` 目前落入未知子命令错误。顶层帮助是 `help.ts` 中的手写模板串（`TOP_LEVEL_HELP`），含 `Options:` 区（现有 `-h, --help`）。`doctor.ts` 的 `runDoctor(cwd, out, deps)` 通过 `DoctorDeps` 注入外部依赖（`opencodeVersion`），输出头部无 tasking 自身版本。测试约定：CLI 行为在 `tests/cli.test.ts` 内进程内调 `main()` 并 spy stdout；doctor 在 `tests/doctor.test.ts` 用内存 Writable 流断言输出。

## Goals / Non-Goals

**Goals:**

- `tasking --version` / `-v` 在子命令分发前命中，向 stdout 打印裸 semver，退出码 0
- 顶层帮助 Options 区露出 `--version, -v`
- `tasking doctor` 输出头部第一行显示 `tasking <version>`
- README×2 与 `docs/{en,zh}/usage.md` 同步

**Non-Goals:**

- 不做 `tasking version` 子命令（保持子命令表纯动词）
- 不做 name 前缀输出、JSON 输出、更新检查
- 不给各子命令的 parseArgs 加 `-v`（顶层 flag 只在子命令位置生效）

## Decisions

1. **分发位置：与 `--help` 同层。** 在 `main()` 现有 `--help`/`-h` 判断旁增加 `--version`/`-v` 分支。备选：统一 parseArgs 预解析——放弃，现状是简单位置判断，保持一致最小改动。
2. **版本来源：`readFileSync` 读 package.json。** 新增 `src/cli/version.ts` 导出 `readTaskingVersion(): string`，用 `readFileSync(new URL("../../package.json", import.meta.url))` + `JSON.parse`，读失败时返回 `"unknown"`。备选：`resolveJsonModule` JSON import——Node 22 ESM 运行时需 import attributes，收益为零；硬编码版本——必然漂移。两个调用方（index.ts、doctor.ts）共用该 helper。路径推算在 dev（tsx）与 dist（`dist/cli/` → 仓库根/package.json）下均成立，npm 包必带 package.json。
3. **输出契约：裸 semver + 换行，无样式。** `process.stdout.write(\`${v}\\n\`)`，返回 0。不经过 `style.ts`（终端染色对管道/脚本不友好）。
4. **帮助文本：改 `TOP_LEVEL_HELP` 的 Options 区。** 与 `-h, --help` 并列加一行 `  -v, --version  Print the installed version`，对齐保持。
5. **doctor 头部：直接打印，不进 deps。** `runDoctor` 开头 `out.write` 一行 `tasking ${readTaskingVersion()}`。备选：仿 `opencodeVersion` 加 deps 注入——放弃，读本地文件确定性高，无进程 spawn 之类的不稳定源。
6. **测试断言用独立 semver 正则，不复述实现。** 断言输出匹配 `/^\d+\.\d+\.\d+\n$/` 而非"读 package.json 比对"（后者是同源复算，tautological）。doctor 断言头部含 `tasking \d+\.\d+\.\d+`。

## Risks / Trade-offs

- [package.json 读取失败（异常打包/裁剪）] → helper try/catch 返回 `unknown`，`--version` 仍退出 0，doctor 头部显示 `tasking unknown`
- [版本断言在 bump 后漂移] → 断言用正则形态而非字面量，bump 免维护
- [`tasking <sub> -v` 不生效可能引起困惑] → 帮助文本明示为顶层选项；属 Non-Goal，文档不宣传子命令内用法

## Migration Plan

纯新增，无迁移。回滚 = revert 单次提交。
