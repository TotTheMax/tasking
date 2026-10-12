# cli-runtime

## MODIFIED Requirements

### Requirement: init 生成工作流骨架
`tasking init` SHALL 在当前工作目录生成一份入门 `WORKFLOW.md`(含 front matter + prompt body)及所需本地目录结构。未经确认 SHALL NOT 覆盖已存在的 `WORKFLOW.md`。`tasking init` SHALL 支持 `--workflow <name>` 选项，取值 `feishu-direct`(默认)、`minimal`、`code-mr` 或 `grill-openspec`；SHALL 支持 `--lang <zh|en>` 选项（模板语言，默认 `zh`），与 `--workflow` 正交组合。变体×语言的模板文件映射：feishu-direct → `WORKFLOW.feishu-direct[.en].md.example`；minimal → `WORKFLOW.minimal[.en].md.example`；code-mr → `WORKFLOW.code-mr[.en].md.example`；grill-openspec → `WORKFLOW.grill-openspec[.en].md.example`。未知 `--workflow` 或未知 `--lang` 值 SHALL 报错并以非零码退出、不写 WORKFLOW.md。skills 安装集合 SHALL 仅由 workflow variant 决定、与语言无关：`minimal` 与 `feishu-direct` 不安装技能；`code-mr` 拷 `land` + `install-glab`；`grill-openspec` 拷 `land` + `install-glab` + 4 个 opsx 技能（共 6 个）。已存在的 skill 目录 SHALL 跳过（不覆盖）；拷贝失败 SHALL 仅记录不阻断。**交互与非交互两条路径 SHALL 共用同一生成实现**（见 `generated-config-trimming`）：非交互路径 SHALL NOT 逐字节复制模板，而是以未填凭证的占位值走生成，产出「必需段 active + 可选段注释」的同一风格。

#### Scenario: 在空目录交互式 init
- **WHEN** 在不含 `WORKFLOW.md` 的目录中、stdin 为 TTY 时调用 `tasking init`
- **THEN** 启动交互式问答，生成填入凭据的 `WORKFLOW.md`

#### Scenario: 在空目录非交互 init
- **WHEN** 调用 `tasking init --non-interactive` 或 stdin 非 TTY
- **THEN** 走同一生成路径产出 `WORKFLOW.md`：必需段 active（占位凭证）、可选段整段注释

#### Scenario: init 拒绝覆盖
- **WHEN** 在已存在 `WORKFLOW.md` 处调用 `tasking init`
- **THEN** 未经 `--force` 确认拒绝覆盖

#### Scenario: --force 覆盖
- **WHEN** 调用 `tasking init --force`
- **THEN** 覆盖已存在的 `WORKFLOW.md`

#### Scenario: init 按变体安装技能且与语言无关
- **WHEN** 分别调用 `tasking init --workflow code-mr` / `--workflow grill-openspec` 且各 skill 目录不存在
- **THEN** code-mr 安装 `land` + `install-glab`；grill-openspec 安装上述加 4 个 opsx 技能；minimal 与 feishu-direct 不安装任何技能；同一变体在 `--lang en` 下安装集合相同

#### Scenario: init 跳过已存在的 skill
- **WHEN** 调用 `tasking init` 且某 skill 目录已存在
- **THEN** 跳过该 skill 拷贝，不覆盖任何文件，继续拷贝其他 skill

#### Scenario: --workflow grill-openspec 选模板
- **WHEN** 调用 `tasking init --workflow grill-openspec`
- **THEN** 使用 zh 版 `WORKFLOW.grill-openspec.md.example` 作为模板生成 `WORKFLOW.md`

#### Scenario: --lang en 组合变体选英文模板
- **WHEN** 分别调用 `tasking init --lang en`、`tasking init --workflow code-mr --lang en`、`tasking init --workflow grill-openspec --lang en`
- **THEN** 依次使用 `WORKFLOW.feishu-direct.en.md.example`、`WORKFLOW.code-mr.en.md.example`、`WORKFLOW.grill-openspec.en.md.example` 作为模板

#### Scenario: 未指定 --lang 默认中文
- **WHEN** 非交互模式调用 `tasking init` 不带 `--lang`
- **THEN** 使用对应变体的 zh 版模板（可选段按生成策略注释）

#### Scenario: --lang 未知值报错
- **WHEN** 调用 `tasking init --lang fr`
- **THEN** 报错并列出支持值 `zh, en`，以非零码退出，不生成 `WORKFLOW.md`

#### Scenario: --workflow 未知值报错
- **WHEN** 调用 `tasking init --workflow unknown`
- **THEN** 报错并以非零码退出，不生成 `WORKFLOW.md`
