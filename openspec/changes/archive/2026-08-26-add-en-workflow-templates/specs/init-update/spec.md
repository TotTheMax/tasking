## MODIFIED Requirements

### Requirement: --update 不写 WORKFLOW.md，只报告漂移

`tasking init --update` SHALL NOT 修改 WORKFLOW.md 内容。SHALL 打印结构化报告：(1) 新增 config 字段清单——模板 frontmatter 中存在而用户 frontmatter 缺失的字段（递归 dotted path，如 `opencode.variant`）及其默认值；(2) prompt body 的 unified diff（仅 `-`/`+` 行，frontmatter 不进 diff）。两者都无差异时 SHALL 分别报告 none/identical。报告模板 SHALL 按用户 WORKFLOW.md 的 prompt body 标记探测 workflow（含 `## 🔍 拷问 / Grill Questions` 视为 grill-openspec，含 `<!-- tasking-workflow: code-mr -->` 视为 code-mr，否则 default）；`--workflow` 显式指定时 SHALL 覆盖探测。报告模板 SHALL 同时按语言选取：用户 WORKFLOW.md 含 `<!-- tasking-workflow-lang: en -->` 哨兵时用该变体的英文模板，否则用 zh 模板；`--lang` 显式指定时 SHALL 覆盖语言探测并在输出标注。漂移引用副本 `.tasking/WORKFLOW.md.reference` SHALL 复制自所选同语言模板。

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

#### Scenario: en 哨兵选用英文模板
- **WHEN** 用户 WORKFLOW.md 由英文模板生成（含 `<!-- tasking-workflow-lang: en -->`）且运行 `tasking init --update`
- **THEN** 用对应变体的英文模板作为报告模板，`.tasking/WORKFLOW.md.reference` 复制自英文模板

#### Scenario: 无哨兵默认中文模板
- **WHEN** 用户 WORKFLOW.md 不含语言哨兵且运行 `tasking init --update`
- **THEN** 用对应变体的 zh 模板作为报告模板

#### Scenario: --lang 覆盖语言探测
- **WHEN** 用户 WORKFLOW.md 为 zh 版但运行 `tasking init --update --lang en`
- **THEN** 用对应变体的英文模板作为报告模板，输出标注显式 `--lang`
