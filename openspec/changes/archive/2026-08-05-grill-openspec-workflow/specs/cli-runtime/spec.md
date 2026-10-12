## MODIFIED Requirements

### Requirement: init 生成工作流骨架
`tasking init` SHALL 在当前工作目录生成一份入门 `WORKFLOW.md`(含 front matter + prompt body)及所需本地目录结构。未经确认 SHALL NOT 覆盖已存在的 `WORKFLOW.md`。`tasking init` SHALL 支持 `--workflow <name>` 选项，取值 `default`(默认) 或 `grill-openspec`；`default` 使用 `WORKFLOW.md.example` 模板，`grill-openspec` 使用 `WORKFLOW.grill-openspec.md.example` 模板；未知值 SHALL 报错并以非零码退出。当 stdin 为 TTY 且未指定 `--non-interactive` 时 SHALL 启动交互式凭据问答流程（含 workflow 选择，见 `interactive-init`）；当 stdin 非 TTY 或指定 `--non-interactive` 时 SHALL 按所选模板复制（非交互模式）。`tasking init` SHALL 从 `assets/skills/` 将技能拷贝到 init 目录的 `.opencode/skills/`：`default` 拷 `land`（`SKILL.md` + `land_watch.py`）；`grill-openspec` 拷 `land` + `opsx-grill-with-docs` + `opsx-propose-with-tdd` + `opsx-implement` + `openspec-archive-change`（共 5 个）。已存在的 skill 目录 SHALL 跳过（不覆盖）；拷贝失败 SHALL 仅记录不阻断。

#### Scenario: 在空目录交互式 init
- **WHEN** 在不含 `WORKFLOW.md` 的目录中、stdin 为 TTY 时调用 `tasking init`
- **THEN** 启动交互式问答，生成填入凭据的 `WORKFLOW.md`

#### Scenario: 在空目录非交互 init
- **WHEN** 调用 `tasking init --non-interactive` 或 stdin 非 TTY
- **THEN** 直接复制 `WORKFLOW.md.example` 为 `WORKFLOW.md`

#### Scenario: init 拒绝覆盖
- **WHEN** 在已存在 `WORKFLOW.md` 处调用 `tasking init`
- **THEN** 未经 `--force` 确认拒绝覆盖

#### Scenario: --force 覆盖
- **WHEN** 调用 `tasking init --force`
- **THEN** 覆盖已存在的 `WORKFLOW.md`

#### Scenario: init 安装 land skill
- **WHEN** 调用 `tasking init`（`--workflow default`，交互式或非交互式）且 `.opencode/skills/land/` 不存在
- **THEN** 将 `SKILL.md` 和 `land_watch.py` 拷贝到 `.opencode/skills/land/`，SHALL NOT 拷贝 opsx 技能

#### Scenario: init grill-openspec 安装五个技能
- **WHEN** 调用 `tasking init --workflow grill-openspec` 且各 skill 目录不存在
- **THEN** 将 `land`、`opsx-grill-with-docs`、`opsx-propose-with-tdd`、`opsx-implement`、`openspec-archive-change` 五个技能拷贝到 `.opencode/skills/`

#### Scenario: init 跳过已存在的 skill
- **WHEN** 调用 `tasking init` 且某 skill 目录已存在
- **THEN** 跳过该 skill 拷贝，不覆盖任何文件，继续拷贝其他 skill

#### Scenario: --workflow grill-openspec 选模板
- **WHEN** 调用 `tasking init --workflow grill-openspec`
- **THEN** 使用 `WORKFLOW.grill-openspec.md.example` 作为模板生成 `WORKFLOW.md`

#### Scenario: --workflow default 等价默认
- **WHEN** 调用 `tasking init --workflow default`
- **THEN** 使用 `WORKFLOW.md.example` 作为模板（与不传 `--workflow` 行为一致）

#### Scenario: --workflow 未知值报错
- **WHEN** 调用 `tasking init --workflow unknown`
- **THEN** 报错并以非零码退出，不生成 `WORKFLOW.md`
