## MODIFIED Requirements

### Requirement: 编辑器自动打开
生成 workflow 文件（workflow path 指向的文件）后 SHALL 尝试打开编辑器，尝试顺序为 `$VISUAL` → `$EDITOR` → `code`，打开对象 SHALL 为该 workflow path 而非固定的 `./WORKFLOW.md`。SHALL 以非阻塞方式打开（spawn detached + stdio ignore）。全部失败 SHALL 打印该文件路径并提示用户手动编辑。

#### Scenario: 用 $VISUAL 打开
- **WHEN** 环境变量 `$VISUAL` 已设置
- **THEN** 用该编辑器打开 workflow path 指向的文件

#### Scenario: 用 $EDITOR 打开
- **WHEN** `$VISUAL` 未设置但 `$EDITOR` 已设置
- **THEN** 用该编辑器打开 workflow path 指向的文件

#### Scenario: 用 code 打开
- **WHEN** `$VISUAL` 和 `$EDITOR` 均未设置但 `code` 可执行
- **THEN** 用 `code` 打开 workflow path 指向的文件

#### Scenario: 无可用编辑器
- **WHEN** `$VISUAL`、`$EDITOR`、`code` 均不可用
- **THEN** 打印该文件路径，提示"请手动编辑此文件完成配置"

#### Scenario: 自定义路径下打开对应文件
- **WHEN** 运行 `tasking init --interactive`（TTY）并给出 `configs/my-flow.md`
- **THEN** 编辑器打开的路径为 `configs/my-flow.md`

### Requirement: land skill 安装
交互式 init SHALL 按 `skillsForWorkflow(workflow)`（见 `workflow-templates`）安装技能到 workflow path 所在目录下的 `.opencode/skills/<name>/`。对含 `land` 的变体（`code-mr`、`grill-openspec`），SHALL 将 `assets/skills/land/` 下的 `SKILL.md` 和 `land_watch.py` 拷贝到 `.opencode/skills/land/`，SHALL NOT 拷贝 `__pycache__`。最小 `default` 变体 SHALL NOT 安装任何技能（`skillsForWorkflow(default)` 为空）。目标目录或文件已存在 SHALL 跳过拷贝（永不覆盖）。拷贝失败 SHALL 打印警告，SHALL NOT 阻断 init 流程。

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

#### Scenario: 技能装到自定义路径所在目录
- **WHEN** 交互式 `tasking init configs/my-flow.md --workflow code-mr`
- **THEN** skill 安装到 `configs/.opencode/skills/land/`
