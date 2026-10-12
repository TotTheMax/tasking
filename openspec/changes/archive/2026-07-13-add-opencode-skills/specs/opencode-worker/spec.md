## ADDED Requirements

### Requirement: 技能文件在 workspace 中的位置约定
opencode 技能文件 SHALL 位于 workspace 的 `.opencode/skills/<name>/SKILL.md`。技能文件 SHALL 由开发仓库自带（预放在仓库的 `.opencode/skills/` 目录），随 `after_create` hook 的 `git clone` 进入 workspace。tasking SHALL NOT 在 workspace 初始化时注入或覆盖技能文件——`injectMcpConfig` 只操作 `.opencode/opencode.json`，不碰 `.opencode/skills/`。

#### Scenario: 技能文件由仓库自带
- **WHEN** workspace 通过 `after_create` hook 的 `git clone` 初始化
- **THEN** `.opencode/skills/` 目录内容来自仓库，tasking 不注入

#### Scenario: injectMcpConfig 不影响技能
- **WHEN** `injectMcpConfig` 合并 `.opencode/opencode.json`
- **THEN** `.opencode/skills/` 目录保持不变
