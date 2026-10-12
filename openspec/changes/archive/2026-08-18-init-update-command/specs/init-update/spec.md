## Purpose

`tasking init --update` 的非破坏性升级操作与 `tasking init --restore` 回撤操作：升级 tasking 后把已发布技能同步到 `.opencode/skills/`（改过则备份+警告后覆盖），并以结构化报告展示 WORKFLOW.md 的漂移（新增 config 字段 + prompt body diff），永不写 WORKFLOW.md。

## ADDED Requirements

### Requirement: --update 同步全部已发布技能

`tasking init --update` SHALL 将 `assets/skills/` 下全部 6 个已发布技能（`land`、`install-glab`、`opsx-grill-with-docs`、`opsx-propose-with-tdd`、`opsx-implement`、`openspec-archive-change`）的已列文件同步到 WORKFLOW.md 同目录的 `.opencode/skills/<name>/`。目标文件不存在 SHALL 创建目录并拷贝。目标存在且与源字节一致 SHALL 跳过（报告 up to date）。目标存在且与源不一致 SHALL 先备份（复制为同目录 `<file>.bak`）再覆盖，并打印警告与备份路径。拷贝失败 SHALL 打印警告，SHALL NOT 阻断其余技能同步。

#### Scenario: 缺失技能被安装
- **WHEN** `.opencode/skills/land/` 不存在且运行 `tasking init --update`
- **THEN** 创建目录并拷贝 `SKILL.md` 与 `land_watch.py`，报告安装成功

#### Scenario: 一致技能被跳过
- **WHEN** 目标文件与 `assets/skills/` 源字节一致且运行 `tasking init --update`
- **THEN** 报告 up to date，不创建备份、不覆盖

#### Scenario: 改过的技能被备份后覆盖
- **WHEN** 目标文件与源字节不一致且运行 `tasking init --update`
- **THEN** 目标先复制为 `<file>.bak` 再覆盖为新版，打印警告并提示备份文件路径

#### Scenario: 备份只保留最近一次
- **WHEN** 同文件 `.bak` 已存在且再次 `tasking init --update` 覆盖该文件
- **THEN** `.bak` 被本次运行前的版本覆盖

#### Scenario: 拷贝失败不阻断
- **WHEN** 某技能文件拷贝因权限等原因失败
- **THEN** 打印警告，其余技能继续同步

### Requirement: --update 不写 WORKFLOW.md，只报告漂移

`tasking init --update` SHALL NOT 修改 WORKFLOW.md 内容。SHALL 打印结构化报告：(1) 新增 config 字段清单——模板 frontmatter 中存在而用户 frontmatter 缺失的字段（递归 dotted path，如 `opencode.variant`）及其默认值；(2) prompt body 的 unified diff（仅 `-`/`+` 行，frontmatter 不进 diff）。两者都无差异时 SHALL 分别报告 none/identical。报告模板 SHALL 按用户 WORKFLOW.md 的 prompt body 标记探测 workflow（含 `## 🔍 拷问 / Grill Questions` 视为 grill-openspec，否则 default）；`--workflow` 显式指定时 SHALL 覆盖探测。

#### Scenario: 列出新增 config 字段
- **WHEN** 用户 WORKFLOW.md 缺少模板中的某字段（如 `opencode.variant`）且运行 `tasking init --update`
- **THEN** 报告列出该字段路径及默认值，提示可手动加入（不加也能跑）

#### Scenario: 无新增字段
- **WHEN** 用户 frontmatter 已包含模板全部字段且运行 `tasking init --update`
- **THEN** 报告无新增字段（none）

#### Scenario: prompt body 有改动
- **WHEN** 用户 prompt body 与当前模板不同且运行 `tasking init --update`
- **THEN** 打印 prompt body 的行级 diff（`-`/`+`），不打印 frontmatter 内容

#### Scenario: prompt body 一致
- **WHEN** 用户 prompt body 与当前模板相同且运行 `tasking init --update`
- **THEN** 报告 body identical

#### Scenario: --workflow 覆盖模板选择
- **WHEN** 运行 `tasking init --update --workflow grill-openspec`
- **THEN** 用 `WORKFLOW.grill-openspec.md.example` 作为报告模板

### Requirement: --update 的入口约束

`tasking init --update` SHALL 要求 WORKFLOW.md 已存在，否则报错退出码 1。`--update` 与 `--force`、`--restore` 互斥：同时指定 SHALL 报错退出码 1。`--update` SHALL 无需交互输入。

#### Scenario: 缺少 WORKFLOW.md 报错
- **WHEN** 目录下无 WORKFLOW.md 且运行 `tasking init --update`
- **THEN** 打印错误（提示先运行 `tasking init`），退出码 1

#### Scenario: 与 --force 互斥
- **WHEN** 运行 `tasking init --update --force`
- **THEN** 打印互斥错误，退出码 1

#### Scenario: 与 --restore 互斥
- **WHEN** 运行 `tasking init --update --restore`
- **THEN** 打印互斥错误，退出码 1

### Requirement: --restore 还原技能备份

`tasking init --restore` SHALL 递归扫描 `.opencode/skills/**` 下的 `.bak` 备份文件，逐个还原：备份重命名为去 `.bak` 的原名，覆盖当前技能文件。无任何备份 SHALL 打印提示并以退出码 0 结束。还原的文件 SHALL 提示。

#### Scenario: 还原单个备份
- **WHEN** `.opencode/skills/land/SKILL.md.bak` 存在且运行 `tasking init --restore`
- **THEN** `.bak` 还原为 `SKILL.md`（覆盖当前内容），打印已还原提示

#### Scenario: 无备份可还原
- **WHEN** `.opencode/skills/` 下无 `.bak` 文件且运行 `tasking init --restore`
- **THEN** 打印无备份提示，退出码 0
