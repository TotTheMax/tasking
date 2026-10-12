## MODIFIED Requirements

### Requirement: init 生成工作流骨架
`tasking init` SHALL 在当前工作目录生成一份入门 `WORKFLOW.md`(含 front matter + prompt body)及所需本地目录结构。未经确认 SHALL NOT 覆盖已存在的 `WORKFLOW.md`。当 stdin 为 TTY 且未指定 `--non-interactive` 时 SHALL 启动交互式凭据问答流程；当 stdin 非 TTY 或指定 `--non-interactive` 时 SHALL 直接复制 `WORKFLOW.md.example`(非交互模式)。交互式和非交互式 SHALL 将 `land` skill 拷贝到 WORKFLOW.md 同目录下的 `.opencode/skills/land/`，已存在则跳过，拷贝失败不阻断。非交互模式 SHALL 输出轻量成功 banner（`✓` + 配置文件路径 + 工作区根路径 + skill 安装路径），SHALL NOT 使用边框分节。非 TTY 时 SHALL 自动去除颜色，输出纯文本。

#### Scenario: 在空目录交互式 init
- **WHEN** 在不含 `WORKFLOW.md` 的目录中、stdin 为 TTY 时调用 `tasking init`
- **THEN** 启动交互式问答，生成填入凭据的 `WORKFLOW.md`

#### Scenario: 在空目录非交互 init
- **WHEN** 调用 `tasking init --non-interactive` 或 stdin 非 TTY
- **THEN** 直接复制 `WORKFLOW.md.example` 为 `WORKFLOW.md`，输出轻量成功 banner

#### Scenario: 非 TTY 自动去色
- **WHEN** stdout 非 TTY 时调用 `tasking init --non-interactive`
- **THEN** 输出不含 ANSI 转义码，为纯文本

#### Scenario: init 拒绝覆盖
- **WHEN** 在已存在 `WORKFLOW.md` 处调用 `tasking init`
- **THEN** 未经 `--force` 确认拒绝覆盖

#### Scenario: --force 覆盖
- **WHEN** 调用 `tasking init --force`
- **THEN** 覆盖已存在的 `WORKFLOW.md`

#### Scenario: init 安装 land skill
- **WHEN** 调用 `tasking init`（交互式或非交互式）且 `.opencode/skills/land/` 不存在
- **THEN** 将 `SKILL.md` 和 `land_watch.py` 拷贝到 `.opencode/skills/land/`

#### Scenario: init 跳过已存在的 land skill
- **WHEN** 调用 `tasking init` 且 `.opencode/skills/land/` 已存在
- **THEN** 跳过 skill 拷贝，不覆盖任何文件
