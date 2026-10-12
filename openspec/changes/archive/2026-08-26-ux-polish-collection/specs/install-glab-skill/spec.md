## ADDED Requirements

### Requirement: install-glab 技能
tasking SHALL 提供 `install-glab` 技能（`assets/skills/install-glab/SKILL.md`），供 agent 在需要 `glab` 而命令缺失时幂等自装。技能 SHALL 先检测 `command -v glab`；已存在则直接完成。缺失 SHALL 通过 GitLab CLI releases API 下载官方 linux/macOS 二进制到 `~/.local/bin`（含 PATH 检查/提示），或降级给出 `brew`/`snap`/`scoop` 包管理器安装命令。安装后 SHALL 验证 `glab auth status` 能经 `GITLAB_TOKEN` 认证（无需交互登录）。技能 SHALL NOT 要求用户交互确认。

#### Scenario: glab 已安装
- **WHEN** agent 运行 install-glab 技能且 `command -v glab` 命中
- **THEN** 技能直接结束，不下载任何二进制

#### Scenario: glab 缺失时自装
- **WHEN** agent 运行 install-glab 技能且 `glab` 不在 PATH
- **THEN** 技能经 releases API 下载对应 OS/arch 的官方二进制到 `~/.local/bin`，并验证 `glab auth status` 可读 `GITLAB_TOKEN`

#### Scenario: 网络不可达降级
- **WHEN** 下载源不可达
- **THEN** 技能打印包管理器安装命令（brew/snap/scoop）并提示可转人工，不伪造成功

### Requirement: init 安装 install-glab 技能
`tasking init` SHALL 将 `assets/skills/install-glab/SKILL.md` 与 `land` 技能一并复制到目标仓库 `.opencode/skills/`（default 与 grill-openspec 两个 workflow 均安装）。目标目录已存在 SHALL 跳过（永不覆盖）。复制失败 SHALL 打印警告且 SHALL NOT 阻断 init。

#### Scenario: 两 workflow 都安装 install-glab
- **WHEN** 执行 `tasking init`（default 或 `--workflow grill-openspec`）
- **THEN** `.opencode/skills/install-glab/SKILL.md` 被创建

#### Scenario: 已存在则跳过
- **WHEN** `.opencode/skills/install-glab/` 已存在
- **THEN** 跳过复制、不覆盖

### Requirement: prompt 引用 install-glab
WORKFLOW 示例模板（default 与 grill-openspec）的 Skills 段落 SHALL 列出 `install-glab`，说明"任何 `glab` 步骤前若 `command -v glab` 失败先运行 install-glab 技能"。

#### Scenario: 模板列出技能
- **WHEN** 生成 `WORKFLOW.md`（任一 workflow 模板）
- **THEN** Skills 段落包含 install-glab 及使用说明
