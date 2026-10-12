## ADDED Requirements

### Requirement: glab CLI 安装检查
交互式 init SHALL 检查 `glab` 命令是否可执行（`which glab`），紧跟 `checkOpencode` 之后执行。找不到 SHALL 打印警告，SHALL NOT 阻断 init 流程。

#### Scenario: glab 已安装
- **WHEN** `glab` 在 PATH 中
- **THEN** 不打印警告，继续

#### Scenario: glab 未安装
- **WHEN** `glab` 不在 PATH 中
- **THEN** 打印警告"glab not found in PATH. agent cannot create or merge MRs."，继续

### Requirement: GitLab 环境变量条件提示
交互式 init SHALL 在 glab 检查之后、完成提示之前，检查 `process.env.GITLAB_TOKEN` 是否已设置。已设置 SHALL 跳过提示。未设置 SHALL 打印提示，说明两种配置方式：以环境变量方式 `export` 到 `~/.bashrc`，或直接在 WORKFLOW.md 的 `env:` 配置段填写值。SHALL NOT 阻断 init 流程。

#### Scenario: GITLAB_TOKEN 已设置
- **WHEN** `process.env.GITLAB_TOKEN` 有值
- **THEN** 不打印 GitLab 环境变量提示

#### Scenario: GITLAB_TOKEN 未设置
- **WHEN** `process.env.GITLAB_TOKEN` 未设置
- **THEN** 打印提示，包含两种配置方式（环境变量或直接写配置）

### Requirement: land skill 安装
交互式 init SHALL 将 `assets/skills/land/` 下的 `SKILL.md` 和 `land_watch.py` 拷贝到 WORKFLOW.md 同目录下的 `.opencode/skills/land/`。SHALL NOT 拷贝 `__pycache__`。目标目录或文件已存在 SHALL 跳过拷贝（永不覆盖）。拷贝失败 SHALL 打印警告，SHALL NOT 阻断 init 流程。

#### Scenario: skill 不存在则拷贝
- **WHEN** `.opencode/skills/land/` 不存在
- **THEN** 创建目录并拷贝 `SKILL.md` 和 `land_watch.py`

#### Scenario: skill 已存在则跳过
- **WHEN** `.opencode/skills/land/` 已存在
- **THEN** 跳过拷贝，不覆盖任何文件

#### Scenario: 拷贝失败不阻断
- **WHEN** skill 拷贝因权限不足等原因失败
- **THEN** 打印警告，init 继续执行
