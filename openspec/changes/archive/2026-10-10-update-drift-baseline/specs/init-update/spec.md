## MODIFIED Requirements

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
