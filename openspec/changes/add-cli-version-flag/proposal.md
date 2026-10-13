## Why

安装后的 `tasking` 无法报告自身版本：`tasking --version` 落入未知子命令报错，用户（尤其 npm 安装的用户）排障时无法回答"我装的是哪个版本"；`tasking doctor` 的输出显示了 opencode 与 Jira 的版本，却唯独没有 tasking 自己的版本，贴出来的体检报告无法定位版本。

## What Changes

- 新增顶层 flag `--version` / `-v`：在子命令分发之前处理，向 stdout 打印裸 semver（取自 `package.json` 的 `version`，无样式、无颜色），退出码 0
- 顶层帮助文本（`help.ts` 单一来源）的全局选项区新增 `--version, -v` 一行
- `tasking doctor` 输出头部新增一行 tasking 自身版本（如 `tasking 0.6.17`）
- 同步文档：`README.md`、`README.zh-CN.md`、`docs/{en,zh}/usage.md` 的命令表

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `cli-runtime`: 新增"版本查询"需求（`--version`/`-v` 顶层 flag 行为）；doctor 体检输出需求增加显示自身版本的场景

## Impact

- 代码：`src/cli/index.ts`（顶层参数分发）、`src/cli/help.ts`（顶层帮助）、`src/cli/doctor.ts`（头部输出）
- 测试：`tests/cli.test.ts`、`tests/cli-commands.test.ts`、`tests/doctor.test.ts`
- 文档：`README.md`、`README.zh-CN.md`、`docs/en/usage.md`、`docs/zh/usage.md`
- 无 breaking change：`--version`/`-v` 当前均落入"未知子命令"错误路径，不存在既有行为被覆盖
