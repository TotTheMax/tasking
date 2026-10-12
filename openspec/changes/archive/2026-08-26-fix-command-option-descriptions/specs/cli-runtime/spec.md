## ADDED Requirements

### Requirement: 子命令帮助 option 描述与实际行为一致

每个公开子命令的 option 帮助描述 SHALL 与实际实现行为一致，不得遗漏或夸大该 option 触发的主要操作。`tasking init --update` 的选项描述 SHALL 同时覆盖技能同步与 WORKFLOW.md 漂移报告两部分真实行为（探测/打印 workflow 变体与模板语言、打印漂移报告：新增 config 字段 + prompt body diff、存在漂移时写入 `.tasking/WORKFLOW.md.reference` 并提示 `git diff --no-index`）；备份语义仍为 `<file>.bak`。`--workflow` 与 `--lang` 的描述 SHALL 同时说明其在 `--update` 模式下用于选择漂移报告模板。描述 SHALL 为英文、保持单行风格。

#### Scenario: init --update 帮助描述含 workflow 漂移报告

- **WHEN** 调用 `tasking init --help`
- **THEN** `--update` 的选项描述同时提及技能同步（modified files backed up as `<file>.bak`）与 WORKFLOW.md 漂移报告（workflow 相关逻辑），不再只写技能同步

#### Scenario: --workflow/--lang 帮助描述说明其在 --update 中的角色

- **WHEN** 调用 `tasking init --help`
- **THEN** `--workflow <name>` 与 `--lang <zh|en>` 的选项描述提及 `--update` 下用于选择漂移报告模板

#### Scenario: 其他子命令帮助描述与实现一致

- **WHEN** 对照 `start`/`status`/`logs`/`stop`/`tui` 的帮助文本与其实现（`src/cli/index.ts`、`src/cli/daemon-info.ts`）逐条核对
- **THEN** 各 option 描述均与实际行为一致，无遗漏或夸大
