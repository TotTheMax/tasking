# cli-runtime

## MODIFIED Requirements

### Requirement: init 生成工作流骨架

`tasking init` SHALL 在当前工作目录生成一份入门 `WORKFLOW.md`(含 front matter + prompt body)及所需本地目录结构。未经确认 SHALL NOT 覆盖已存在的 `WORKFLOW.md`。`tasking init` SHALL 支持 `--workflow <name>` 选项，取值 `default`(默认)、`code-mr`、`grill-openspec` 或 `feishu-direct`；SHALL 支持 `--lang <zh|en>` 选项（模板语言，默认 `zh`），与 `--workflow` 正交组合。变体×语言的模板文件映射：default → `assets/workflows/WORKFLOW.md.example`(zh) / `assets/workflows/WORKFLOW.en.md.example`(en)；code-mr → `assets/workflows/WORKFLOW.code-mr.md.example`(zh) / `assets/workflows/WORKFLOW.code-mr.en.md.example`(en)；grill-openspec → `assets/workflows/WORKFLOW.grill-openspec.md.example`(zh) / `assets/workflows/WORKFLOW.grill-openspec.en.md.example`(en)；feishu-direct → `assets/workflows/WORKFLOW.feishu-direct.md.example`(zh) / `assets/workflows/WORKFLOW.feishu-direct.en.md.example`(en)。未知 `--workflow` 或未知 `--lang` 值 SHALL 报错并以非零码退出、不写 WORKFLOW.md。skills 安装集合 SHALL 仅由 workflow variant 决定、与语言无关：`default` 与 `feishu-direct` 不安装技能；`code-mr` 拷 `land` + `install-glab`；`grill-openspec` 拷 `land` + `install-glab` + 4 个 opsx 技能（共 6 个）。已存在的 skill 目录 SHALL 跳过（不覆盖）；拷贝失败 SHALL 仅记录不阻断。

#### Scenario: feishu-direct 非交互初始化
- **WHEN** `tasking init --workflow feishu-direct --nonInteractive`
- **THEN** 写入与 `assets/workflows/WORKFLOW.feishu-direct.md.example` 字节一致的 WORKFLOW.md，不安装技能

#### Scenario: feishu-direct 英文版
- **WHEN** `tasking init --workflow feishu-direct --lang en --nonInteractive`
- **THEN** 写入与 `.en.` 版模板字节一致的 WORKFLOW.md，含语言哨兵

#### Scenario: 未知变体报错
- **WHEN** `tasking init --workflow custom --nonInteractive`
- **THEN** 非零码退出，错误信息列出四个支持值，不写 WORKFLOW.md

#### Scenario: default 行为不变
- **WHEN** `tasking init --nonInteractive`
- **THEN** 与现状完全一致（default 模板、无技能、报错路径不变）
