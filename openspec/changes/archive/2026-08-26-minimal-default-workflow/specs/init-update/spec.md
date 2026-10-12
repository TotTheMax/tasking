## REMOVED Requirements

### Requirement: --update 同步全部已发布技能

**Reason**: 改为按 `detectWorkflow` 探测的变体同步其技能集（`skillsForWorkflow(workflow)`），而非恒同步全量 6 个——最小 `default` 变体不装技能，恒同步全量会向最小 default 用户塞冗余技能。

**Migration**: 新行为由 `--update 按变体同步技能` 取代。`grill-openspec` 用户行为不变（仍同步全 6 个）；`code-mr` 用户同步 `land`+`install-glab`；`default` 用户不同步技能。

## ADDED Requirements

### Requirement: --update 按变体同步技能

`tasking init --update` SHALL 按 `skillsForWorkflow(detectedWorkflow)`（见 `workflow-templates`）确定的技能集，将 `assets/skills/<name>/` 下该集每个技能的已列文件同步到 WORKFLOW.md 同目录的 `.opencode/skills/<name>/`。`detectWorkflow` 优先级：prompt body 含 grill 标记 → `grill-openspec`；含 `<!-- tasking-workflow: code-mr -->` → `code-mr`；否则 → `default`。目标文件不存在 SHALL 创建目录并拷贝。目标存在且与源字节一致 SHALL 跳过（报告 up to date）。目标存在且与源不一致 SHALL 先备份（复制为同目录 `<file>.bak`）再覆盖，并打印警告与备份路径。拷贝失败 SHALL 打印警告，SHALL NOT 阻断其余技能同步。`default` 变体技能集为空时 SHALL 不安装任何技能并报告无同步。

#### Scenario: grill-openspec 同步全六个

- **WHEN** 用户 WORKFLOW.md 含 grill 标记且运行 `tasking init --update`
- **THEN** 同步 `land`、`install-glab` 及四个 opsx 技能

#### Scenario: code-mr 同步 land 与 install-glab

- **WHEN** 用户 WORKFLOW.md 含 `<!-- tasking-workflow: code-mr -->` 标记且运行 `tasking init --update`
- **THEN** 同步 `land` 与 `install-glab`，不安装 opsx 技能

#### Scenario: default 不同步技能

- **WHEN** 用户 WORKFLOW.md 无任一标记（探测为 `default`）且运行 `tasking init --update`
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

## MODIFIED Requirements

### Requirement: --update 不写 WORKFLOW.md，只报告漂移

`tasking init --update` SHALL NOT 修改 WORKFLOW.md 内容。SHALL 打印结构化报告：(1) 新增 config 字段清单——模板 frontmatter 中存在而用户 frontmatter 缺失的字段（递归 dotted path，如 `opencode.variant`）及其默认值；(2) prompt body 的 unified diff（仅 `-`/`+` 行，frontmatter 不进 diff）。两者都无差异时 SHALL 分别报告 none/identical。报告模板 SHALL 按用户 WORKFLOW.md 的 prompt body 标记三路探测 workflow（见 `workflow-templates`：含 `## 🔍 拷问 / Grill Questions` 视为 `grill-openspec`；含 `<!-- tasking-workflow: code-mr -->` 视为 `code-mr`；否则 `default`）；`--workflow` 显式指定时 SHALL 覆盖探测。

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

- **WHEN** 运行 `tasking init --update --workflow code-mr`
- **THEN** 用 `WORKFLOW.code-mr.md.example` 作为报告模板

#### Scenario: code-mr 标记触发 code-mr 模板

- **WHEN** 用户 WORKFLOW.md 含 `<!-- tasking-workflow: code-mr -->` 且运行 `tasking init --update`（未显式 `--workflow`）
- **THEN** 用 `WORKFLOW.code-mr.md.example` 作为报告模板
