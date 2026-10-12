## MODIFIED Requirements

### Requirement: --update 按变体同步技能

`tasking init --update [workflow-path]` SHALL 按 `skillsForWorkflow(detectedWorkflow)`（见 `workflow-templates`）确定的技能集，将 `assets/skills/<name>/` 下该集每个技能的已列文件同步到 workflow path 所在目录的 `.opencode/skills/<name>/`。workflow path 缺省为当前目录的 `./WORKFLOW.md`。`detectWorkflow` 优先级：prompt body 含 `<!-- tasking-workflow: feishu-direct -->` → `feishu-direct`；含 grill 标记 → `grill-openspec`；含 `<!-- tasking-workflow: code-mr -->` → `code-mr`；否则 → `minimal`。目标文件不存在 SHALL 创建目录并拷贝。目标存在且与源字节一致 SHALL 跳过（报告 up to date）。目标存在且与源不一致 SHALL 先备份（复制为同目录 `<file>.bak`）再覆盖，并打印警告与备份路径。拷贝失败 SHALL 打印警告，SHALL NOT 阻断其余技能同步。技能集为空的变体（`minimal`、`feishu-direct`）SHALL 不安装任何技能并报告无同步。

#### Scenario: grill-openspec 同步全六个
- **WHEN** 用户 WORKFLOW.md 含 grill 标记且运行 `tasking init --update`
- **THEN** 同步 `land`、`install-glab` 及四个 opsx 技能

#### Scenario: code-mr 同步 land 与 install-glab
- **WHEN** 用户 WORKFLOW.md 含 `<!-- tasking-workflow: code-mr -->` 标记且运行 `tasking init --update`
- **THEN** 同步 `land` 与 `install-glab`，不安装 opsx 技能

#### Scenario: minimal 不同步技能
- **WHEN** 用户 WORKFLOW.md 无任一标记（探测为 `minimal`）且运行 `tasking init --update`
- **THEN** 不安装任何技能

#### Scenario: feishu-direct 不同步技能
- **WHEN** 用户 WORKFLOW.md 含 feishu-direct 标记且运行 `tasking init --update`
- **THEN** 不安装任何技能

#### Scenario: 缺失技能被安装
- **WHEN** 探测变体的技能集中 `.opencode/skills/<name>/` 不存在且运行 `tasking init --update`
- **THEN** 创建目录并拷贝该技能的已列文件（含 land 的 `land_watch.py`）

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

#### Scenario: skills 跟随自定义 workflow path 所在目录
- **WHEN** 运行 `tasking init --update configs/my-flow.md`
- **THEN** skills 同步到 `configs/.opencode/skills/`，而非当前目录的 `.opencode/skills/`

### Requirement: --update 不写 WORKFLOW.md，只报告漂移

`tasking init --update [workflow-path]` SHALL NOT 修改该 workflow 文件内容。SHALL 打印结构化报告：(1) 模板 frontmatter 中存在而用户 frontmatter 缺失的字段（递归 dotted path，如 `opencode.variant`）及其默认值——措辞 SHALL 表述为「走 DEFAULTS 默认值」（可选段在生成文件中以注释/省略形式存在，缺失属正常，不是待补的新字段）；(2) prompt body 的 unified diff（仅 `-`/`+` 行，frontmatter 不进 diff）。两者都无差异时 SHALL 分别报告 none/identical。报告模板 SHALL 按用户 workflow 文件的 prompt body 标记四路探测 workflow（含 `<!-- tasking-workflow: feishu-direct -->` → `feishu-direct`；含 `## 🔍 拷问 / Grill Questions` → `grill-openspec`；含 `<!-- tasking-workflow: code-mr -->` → `code-mr`；否则 `minimal`）；`--workflow` 显式指定时 SHALL 覆盖探测。报告模板 SHALL 同时按语言选取：用户 workflow 文件含 `<!-- tasking-workflow-lang: en -->` 哨兵时用该变体的英文模板，否则用 zh 模板；`--lang` 显式指定时 SHALL 覆盖语言探测并在输出标注。漂移引用副本 SHALL 写到 workflow path 所在目录的 `.tasking/<basename>.reference`（`<basename>` 为目标文件名，缺省配置下即 `WORKFLOW.md.reference`），复制自所选同语言模板。

#### Scenario: 列出缺失的可选字段并标注默认值语义
- **WHEN** 用户 WORKFLOW.md 精简了可选段（如缺 `opencode.variant`）且运行 `tasking init --update`
- **THEN** 报告列出该字段并说明其走 `DEFAULTS` 默认值（可直接使用，无需补齐）

#### Scenario: 无缺失字段
- **WHEN** 用户 frontmatter 已包含模板全部字段且运行 `tasking init --update`
- **THEN** 报告无缺失字段（none）

#### Scenario: prompt body 有改动
- **WHEN** 用户 prompt body 与当前模板不同且运行 `tasking init --update`
- **THEN** 打印 prompt body 的行级 diff（`-`/`+`），不打印 frontmatter 内容

#### Scenario: prompt body 一致
- **WHEN** 用户 prompt body 与当前模板相同且运行 `tasking init --update`
- **THEN** 报告 body identical

#### Scenario: --workflow 覆盖模板选择
- **WHEN** 运行 `tasking init --update --workflow code-mr`
- **THEN** 用 `WORKFLOW.code-mr.md.example` 作为报告模板

#### Scenario: feishu-direct 标记触发直连模板
- **WHEN** 用户 WORKFLOW.md 含 `<!-- tasking-workflow: feishu-direct -->` 且运行 `tasking init --update`（未显式 `--workflow`）
- **THEN** 用 `WORKFLOW.feishu-direct.md.example` 作为报告模板

#### Scenario: en 哨兵选用英文模板
- **WHEN** 用户 WORKFLOW.md 由英文模板生成（含 `<!-- tasking-workflow-lang: en -->`）且运行 `tasking init --update`
- **THEN** 用对应变体的英文模板作为报告模板，`.tasking/<basename>.reference` 复制自英文模板

#### Scenario: 无哨兵默认中文模板
- **WHEN** 用户 WORKFLOW.md 不含语言哨兵且运行 `tasking init --update`
- **THEN** 用对应变体的 zh 模板作为报告模板

#### Scenario: --lang 覆盖语言探测
- **WHEN** 用户 WORKFLOW.md 为 zh 版但运行 `tasking init --update --lang en`
- **THEN** 用对应变体的英文模板作为报告模板，输出标注显式 `--lang`

#### Scenario: 漂移参考副本按目标文件名命名
- **WHEN** 运行 `tasking init --update configs/my-flow.md` 且存在漂移
- **THEN** 参考副本写到 `configs/.tasking/my-flow.md.reference`，提示的 `git diff --no-index` 命令使用该路径

### Requirement: --update 的入口约束

`tasking init --update [workflow-path]` SHALL 要求该 workflow 文件已存在，否则报错退出码 1。`--update` 与 `--force`、`--restore` 互斥：同时指定 SHALL 报错退出码 1。`--update` SHALL 无需交互输入。

#### Scenario: 缺少 WORKFLOW.md 报错
- **WHEN** 目录下无 WORKFLOW.md 且运行 `tasking init --update`
- **THEN** 打印错误（提示先运行 `tasking init`），退出码 1

#### Scenario: 缺少自定义路径文件报错
- **WHEN** 运行 `tasking init --update /does/not/exist.md`
- **THEN** 打印错误（指名该路径，提示先运行 `tasking init`），退出码 1

#### Scenario: 与 --force 互斥
- **WHEN** 运行 `tasking init --update --force`
- **THEN** 打印互斥错误，退出码 1

#### Scenario: 与 --restore 互斥
- **WHEN** 运行 `tasking init --update --restore`
- **THEN** 打印互斥错误，退出码 1

### Requirement: --restore 还原技能备份

`tasking init --restore [workflow-path]` SHALL 还原 workflow path 所在目录的 `.opencode/skills/**` 下的 `.bak` 备份文件，逐个还原：备份重命名为去 `.bak` 的原名，覆盖当前技能文件。workflow path 缺省为当前目录的 `./WORKFLOW.md`。显式给定路径而该文件不存在 SHALL 报错退出码 1（缺省路径缺失则不报错，仅按无备份处理）。无任何备份 SHALL 打印提示并以退出码 0 结束。还原的文件 SHALL 提示。

#### Scenario: 还原单个备份
- **WHEN** `.opencode/skills/land/SKILL.md.bak` 存在且运行 `tasking init --restore`
- **THEN** `.bak` 还原为 `SKILL.md`（覆盖当前内容），打印已还原提示

#### Scenario: 无备份可还原
- **WHEN** `.opencode/skills/` 下无 `.bak` 文件且运行 `tasking init --restore`
- **THEN** 打印无备份提示，退出码 0

#### Scenario: 还原自定义路径所在目录的备份
- **WHEN** 运行 `tasking init --restore configs/my-flow.md`
- **THEN** 还原 `configs/.opencode/skills/` 下的备份，而非当前目录
