## MODIFIED Requirements

### Requirement: workflow 选择问答

`tasking init` 交互式流程 SHALL 询问使用哪个 workflow，选项为 `default`、`code-mr` 与 `grill-openspec`。当用户已通过 `--workflow` 指定时 SHALL 跳过此问答。所选 workflow SHALL 决定使用哪个模板生成 `WORKFLOW.md`：`default` → `WORKFLOW.md.example`（最小），`code-mr` → `WORKFLOW.code-mr.md.example`（全-MR），`grill-openspec` → `WORKFLOW.grill-openspec.md.example`。问答 SHALL 在选项旁显示各变体简述（`default`＝最小：工作目录完成任务→上传 Jira→转终态；`code-mr`＝写码＋建 MR；`grill-openspec`＝拷问→propose→implement→archive）。`default` SHALL 为默认选中项。

#### Scenario: 未指定 --workflow 时询问

- **WHEN** stdin 为 TTY 且未指定 `--workflow` 时调用 `tasking init`
- **THEN** 交互式询问选择 workflow（`default` / `code-mr` / `grill-openspec`）

#### Scenario: 已指定 --workflow 跳过问答

- **WHEN** 调用 `tasking init --workflow code-mr` 且 stdin 为 TTY
- **THEN** 跳过 workflow 选择问答，直接用 `code-mr` 模板

#### Scenario: 选择 default 用最小模板

- **WHEN** 用户在交互式问答中选择 `default`
- **THEN** 使用 `WORKFLOW.md.example` 模板生成 `WORKFLOW.md`，其 prompt body 不含 git 分支/MR/glab 步骤

#### Scenario: 选择 code-mr 用全-MR 模板

- **WHEN** 用户在交互式问答中选择 `code-mr`
- **THEN** 使用 `WORKFLOW.code-mr.md.example` 模板生成 `WORKFLOW.md`

#### Scenario: 选择 grill-openspec 用 grill 模板

- **WHEN** 用户在交互式问答中选择 `grill-openspec`
- **THEN** 使用 `WORKFLOW.grill-openspec.md.example` 模板生成 `WORKFLOW.md`

### Requirement: land skill 安装

交互式 init SHALL 按 `skillsForWorkflow(workflow)`（见 `workflow-templates`）安装技能到 WORKFLOW.md 同目录下的 `.opencode/skills/<name>/`。对含 `land` 的变体（`code-mr`、`grill-openspec`），SHALL 将 `assets/skills/land/` 下的 `SKILL.md` 和 `land_watch.py` 拷贝到 `.opencode/skills/land/`，SHALL NOT 拷贝 `__pycache__`。最小 `default` 变体 SHALL NOT 安装任何技能（`skillsForWorkflow(default)` 为空）。目标目录或文件已存在 SHALL 跳过拷贝（永不覆盖）。拷贝失败 SHALL 打印警告，SHALL NOT 阻断 init 流程。

#### Scenario: default 不装技能

- **WHEN** 调用 `tasking init --workflow default` 且 `.opencode/skills/` 为空
- **THEN** 不安装任何技能，`.opencode/skills/` 仍为空

#### Scenario: code-mr 装 land skill

- **WHEN** 调用 `tasking init --workflow code-mr` 且 `.opencode/skills/land/` 不存在
- **THEN** 创建目录并拷贝 `SKILL.md` 和 `land_watch.py`，`__pycache__` 不拷贝

#### Scenario: skill 已存在则跳过

- **WHEN** 调用 `tasking init` 且 `.opencode/skills/land/` 已存在
- **THEN** 跳过拷贝，保留已有文件

#### Scenario: 拷贝失败不阻断

- **WHEN** skill 拷贝因权限不足等原因失败
- **THEN** 打印警告，init 继续执行
