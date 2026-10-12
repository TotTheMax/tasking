## Purpose

`tasking init --update` 的非破坏性升级操作与 `tasking init --restore` 回撤操作：升级 tasking 后把已发布技能同步到 `.opencode/skills/`（改过则备份+警告后覆盖），并以结构化报告展示 WORKFLOW.md 的漂移（新增 config 字段 + prompt body diff），永不写 WORKFLOW.md。
## Requirements
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

`tasking init --update [workflow-path]` SHALL NOT 修改该 workflow 文件内容。SHALL 打印结构化报告：(1) **漂移基线**中有而用户 frontmatter 缺失的字段（递归 dotted path）及其默认值——漂移基线 SHALL 为「对探测到的（或显式覆盖的）variant × lang 走当前 `init` 同一生成路径产出的配置键集合」，**只比键、不比值**，且 feishu 段的形态 SHALL 镜像用户文件中的 `feishu.enabled`（生成器按设计裁剪/省略的段——非本变体的可选段、zh 版的 `interface_language` 等——SHALL NOT 计为缺失）；措辞 SHALL 表述为「走 DEFAULTS 默认值」；(2) prompt body 的 unified diff（仅 `-`/`+` 行，frontmatter 不进 diff），比对基准为所选同语言模板。两者都无差异时 SHALL 分别报告 none/identical。变体探测：按用户 prompt body 标记四路（含 `<!-- tasking-workflow: feishu-direct -->` → `feishu-direct`；含 `## 🔍 拷问 / Grill Questions` → `grill-openspec`；含 `<!-- tasking-workflow: code-mr -->` → `code-mr`；否则 `minimal`），`--workflow` 显式指定时 SHALL 覆盖探测**并同时切换漂移基线与报告模板**；语言探测：用户文件含 `<!-- tasking-workflow-lang: en -->` 哨兵时用英文模板，否则 zh 模板，`--lang` 显式指定时 SHALL 覆盖并在输出标注（同样切换基线语言）。漂移引用副本 SHALL 仅在存在真实漂移（新基线下存在缺失字段 **或** prompt body diff）时写入 workflow path 所在目录的 `.tasking/<basename>.reference`，复制自所选同语言模板；无漂移的运行 SHALL 删除残留的旧引用副本。

#### Scenario: fresh 生成文件零缺失且不写 reference
- **WHEN** 刚以某变体完成 `tasking init`、未手改文件，随即运行 `tasking init --update`
- **THEN** 报告 `no missing config fields` 与 body `identical`，且 `.tasking/` 下不存在（或被清除）`<basename>.reference`

#### Scenario: 生成器裁剪的段不列为缺失
- **WHEN** 用户文件为 minimal 变体（`opencode`/`polling` 等段按设计注释）且运行 `tasking init --update`
- **THEN** 报告不列出 `opencode.*`、`polling`、`interface_language` 等被裁剪/省略的键

#### Scenario: active 段缺失字段照报并标注默认值语义
- **WHEN** 用户删掉了所在变体 active 段中的某字段（如 minimal 的 `hooks.timeout_ms`）且运行 `tasking init --update`
- **THEN** 报告按 dotted path 列出该字段并说明其走 `DEFAULTS` 默认值

#### Scenario: feishu 启用镜像——桥用户的 feishu 段缺失被报
- **WHEN** 用户文件 `feishu.enabled: true`（或 feishu-direct 变体）但缺失 feishu 段某键，且运行 `tasking init --update`
- **THEN** 该键按漂移基线（启用形态）列为缺失

#### Scenario: feishu 未启用不报段内键
- **WHEN** 用户文件 `feishu.enabled: false`（该段仅 enabled 行 active）且运行 `tasking init --update`
- **THEN** feishu 段内其余键（app_id、direct 等）不列为缺失

#### Scenario: --workflow 覆盖同时切换基线
- **WHEN** 运行 `tasking init --update --workflow code-mr` 于 feishu-direct 文件
- **THEN** 漂移基线按 code-mr 生成（hooks/env 为 active），缺失按该基线报告；body diff 用 `WORKFLOW.code-mr.md.example`

#### Scenario: prompt body 有改动仍触发 reference
- **WHEN** 用户 prompt body 与当前模板不同（config 零缺失）且运行 `tasking init --update`
- **THEN** 打印 prompt body 行级 diff，并写入 `.tasking/<basename>.reference`（复制自所选同语言模板）

#### Scenario: en 哨兵选用英文模板
- **WHEN** 用户 WORKFLOW.md 由英文模板生成（含 `<!-- tasking-workflow-lang: en -->`）且运行 `tasking init --update`
- **THEN** body diff 与漂移基线均取英文模板口径，`.tasking/<basename>.reference` 复制自英文模板

#### Scenario: --lang 覆盖语言探测
- **WHEN** 用户 WORKFLOW.md 为 zh 版但运行 `tasking init --update --lang en`
- **THEN** 报告模板与漂移基线切换为英文口径，输出标注显式 `--lang`

#### Scenario: 不写用户文件
- **WHEN** 任意 `tasking init --update` 运行完成
- **THEN** 用户 workflow 文件内容字节不变

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
