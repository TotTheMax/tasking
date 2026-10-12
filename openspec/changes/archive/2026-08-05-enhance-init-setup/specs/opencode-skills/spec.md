## MODIFIED Requirements

### Requirement: opencode 技能文件格式
tasking SHALL 提供技能文件模板，格式为 `.opencode/skills/<name>/SKILL.md`，每个文件 SHALL 包含 YAML front matter（`name` 和 `description` 字段）和 Markdown 正文。技能文件 SHALL 预放在开发仓库的 `.opencode/skills/` 目录中（可通过 `tasking init` 安装或随 `after_create` hook 的 `git clone` 进入 workspace）。`tasking init` 安装时 SHALL 拷贝 `SKILL.md` 和 `land_watch.py`，SHALL NOT 拷贝 `__pycache__`，SHALL NOT 覆盖已存在的 skill 文件。tasking SHALL NOT 通过代码注入技能文件——`injectMcpConfig` 只写 `.opencode/opencode.json`（merge 语义），不碰 skills 目录。

#### Scenario: 技能文件随 git clone 进入 workspace
- **WHEN** `after_create` hook 执行 `git clone <repo> .` 且仓库含 `.opencode/skills/`
- **THEN** workspace 的 `.opencode/skills/` 目录可用，opencode 加载技能

#### Scenario: tasking init 安装 land skill
- **WHEN** 调用 `tasking init` 且 `.opencode/skills/land/` 不存在
- **THEN** `SKILL.md` 和 `land_watch.py` 被拷贝到 `.opencode/skills/land/`，`__pycache__` 不拷贝

#### Scenario: init 不覆盖已存在 skill
- **WHEN** 调用 `tasking init` 且 `.opencode/skills/land/` 已存在
- **THEN** 跳过拷贝，保留已有文件

#### Scenario: injectMcpConfig 不影响技能目录
- **WHEN** `injectMcpConfig` 写入 `.opencode/opencode.json`
- **THEN** `.opencode/skills/` 目录保持不变

#### Scenario: 技能文件 front matter 格式
- **WHEN** 查看 `assets/skills/<name>/SKILL.md`
- **THEN** 文件以 YAML front matter 开头，含 `name` 和 `description` 字段
