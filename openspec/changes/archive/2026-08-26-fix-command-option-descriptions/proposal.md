## Why

一些命令的 option 描述与实际行为有出入。例如 `tasking init --update` 的帮助文本只写了"Re-sync tasking skills; modified files are backed up as <file>.bak"，但真实实现（`src/cli/init.ts` 的 `runUpdate`）除了同步技能，还会探测 workflow 变体与模板语言、打印 WORKFLOW.md 漂移报告（新增 config 字段 + prompt body diff）、在存在漂移时写入 `.tasking/WORKFLOW.md.reference` 并提示 `git diff --no-index`。描述缺失 workflow 相关操作，误导用户。

## What Changes

- 修正 `tasking init` 帮助文本中 `--update` 的 option 描述，补齐 workflow 漂移报告等真实行为（同步技能 + 报告 WORKFLOW.md 漂移，备份仍为 `<file>.bak`）。
- 同类问题：`--workflow` 与 `--lang` 在 `--update` 模式下还用于选择漂移报告模板，描述中补充该真实行为。
- 逐条核对全部 6 个子命令（`init`/`start`/`status`/`logs`/`stop`/`tui`）及其 option 帮助描述与真实实现（`src/cli/index.ts`、`src/cli/init.ts`、`src/cli/daemon-info.ts`）的一致性；除上述 `--update`/`--workflow`/`--lang` 外均确认无误，无需改动。
- 保持描述为一行英文、与帮助文本现有风格一致；不改变任何命令/flag 的实际行为。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `cli-runtime`: `init --update` 的帮助文本选项描述需要反映真实行为（技能同步 + WORKFLOW.md 漂移报告），新增一条 requirement 约束子命令帮助的 option 描述必须与实际行为一致（以 `--update` 为例）。

## Impact

- `src/cli/help.ts`：`init` 子命令的 `--update`/`--workflow`/`--lang` option description 文案修改。
- `tests/cli.test.ts`：现有断言只检查选项名出现，不受影响；新增对描述内容含 workflow 漂移报告及 `--update` 关联的断言。
- 不涉及运行时行为、配置 schema、文档（`docs/{en,zh}/usage.md` 已正确描述 `--update` 行为）。
