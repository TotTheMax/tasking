## MODIFIED Requirements

### Requirement: 工作流文件路径解析
CLI SHALL 接受位置参数 workflow path 于 `start`、`init`（生成 / `--update` / `--restore`）与 `doctor` 三个子命令。缺省时 SHALL 使用当前工作目录下的 `./WORKFLOW.md`；显式相对路径 SHALL 相对当前工作目录解析。位置参数 SHALL 为**文件路径**：指向目录 SHALL 视为错误。三个子命令 SHALL 共用同一解析语义（同一 helper），且该路径所在目录 SHALL 作为关联产物（`.opencode/skills/`、`.tasking/`、`.bak`）与 dotenv 的基准。`start`、`doctor`、`init --update`、`init --restore` 在显式路径不存在时 MUST 报错（启动/入口错误）；`init` 生成模式 SHALL 递归创建父目录后写入。

#### Scenario: 使用显式工作流路径
- **WHEN** 调用 `tasking start path/to/WORKFLOW.md`
- **THEN** daemon 从该路径加载工作流

#### Scenario: 默认工作流路径
- **WHEN** 调用 `tasking start` 且无路径参数且 `./WORKFLOW.md` 存在
- **THEN** daemon 加载 `./WORKFLOW.md`

#### Scenario: 缺失默认工作流
- **WHEN** 调用 `tasking start` 且 `./WORKFLOW.md` 不存在
- **THEN** CLI 以 `missing_workflow_file` 错误非零退出,错误对运维者可见

#### Scenario: 不存在的显式路径
- **WHEN** 调用 `tasking start /does/not/exist.md`
- **THEN** CLI 以 `missing_workflow_file` 错误非零退出

#### Scenario: init 与 doctor 接受自定义路径
- **WHEN** 调用 `tasking init path/to/my-flow.md` 或 `tasking doctor path/to/my-flow.md`
- **THEN** 二者均对 `path/to/my-flow.md` 作业（init 写入 / doctor 读取），而非当前目录的 `WORKFLOW.md`

#### Scenario: 位置参数为目录时报错
- **WHEN** 调用 `tasking init some-directory/`（一个存在的目录）
- **THEN** 报错提示位置参数必须是文件路径，非零码退出

#### Scenario: 关联产物跟随路径所在目录
- **WHEN** 调用 `tasking init configs/my-flow.md`
- **THEN** 生成的 skills、`.tasking/` 参考副本与 `.bak` 均以 `configs/` 为基准目录

### Requirement: init 生成工作流骨架
`tasking init` SHALL 在 workflow path 生成一份入门 WORKFLOW.md(含 front matter + prompt body)及所需本地目录结构。workflow path 缺省为当前工作目录下的 `./WORKFLOW.md`；显式路径为纯文件路径（传目录 SHALL 报错），其父目录不存在时 SHALL 递归创建。未经确认 SHALL NOT 覆盖已存在的文件。`tasking init` SHALL 支持 `--workflow <name>` 选项，取值 `feishu-direct`(默认)、`minimal`、`code-mr` 或 `grill-openspec`；SHALL 支持 `--lang <zh|en>` 选项（模板语言，默认 `zh`），与 `--workflow` 正交组合。变体×语言的模板文件映射：feishu-direct → `WORKFLOW.feishu-direct[.en].md.example`；minimal → `WORKFLOW.minimal[.en].md.example`；code-mr → `WORKFLOW.code-mr[.en].md.example`；grill-openspec → `WORKFLOW.grill-openspec[.en].md.example`。未知 `--workflow` 或未知 `--lang` 值 SHALL 报错并以非零码退出、不写配置。skills 安装集合 SHALL 仅由 workflow variant 决定、与语言无关：`minimal` 与 `feishu-direct` 不安装技能；`code-mr` 拷 `land` + `install-glab`；`grill-openspec` 拷 `land` + `install-glab` + 4 个 opsx 技能（共 6 个）。已存在的 skill 目录 SHALL 跳过（不覆盖）；拷贝失败 SHALL 仅记录不阻断。**交互与非交互两条路径 SHALL 共用同一生成实现**（见 `generated-config-trimming`）：非交互路径 SHALL NOT 逐字节复制模板，而是以未填凭证的占位值走生成，产出「必需段 active + 可选段注释」的同一风格。

#### Scenario: 在空目录交互式 init
- **WHEN** 在不含 WORKFLOW.md 的目录中、stdin 为 TTY 时调用 `tasking init`
- **THEN** 启动交互式问答，生成填入凭据的 `WORKFLOW.md`

#### Scenario: 在空目录非交互 init
- **WHEN** 调用 `tasking init --non-interactive` 或 stdin 非 TTY
- **THEN** 走同一生成路径产出 `WORKFLOW.md`：必需段 active（占位凭证）、可选段整段注释

#### Scenario: 生成到自定义文件路径
- **WHEN** 调用 `tasking init configs/my-flow.md` 且 `configs/` 存在
- **THEN** 配置写入 `configs/my-flow.md`，skills 装到 `configs/.opencode/skills/`

#### Scenario: 递归创建父目录
- **WHEN** 调用 `tasking init deep/a/b/WORKFLOW.md` 且 `deep/a/b/` 不存在
- **THEN** 递归创建 `deep/a/b/` 后写入配置，非零退出仅出现在真正的写盘失败时

#### Scenario: init 拒绝覆盖
- **WHEN** 在已存在配置文件处调用 `tasking init`
- **THEN** 未经 `--force` 确认拒绝覆盖

#### Scenario: --force 覆盖
- **WHEN** 调用 `tasking init --force`
- **THEN** 覆盖已存在的配置文件

#### Scenario: init 按变体安装技能且与语言无关
- **WHEN** 分别调用 `tasking init --workflow code-mr` / `--workflow grill-openspec` 且各 skill 目录不存在
- **THEN** code-mr 安装 `land` + `install-glab`；grill-openspec 安装上述加 4 个 opsx 技能；minimal 与 feishu-direct 不安装任何技能；同一变体在 `--lang en` 下安装集合相同

#### Scenario: init 跳过已存在的 skill
- **WHEN** 调用 `tasking init` 且某 skill 目录已存在
- **THEN** 跳过该 skill 拷贝，不覆盖任何文件，继续拷贝其他 skill

#### Scenario: --workflow grill-openspec 选模板
- **WHEN** 调用 `tasking init --workflow grill-openspec`
- **THEN** 使用 zh 版 `WORKFLOW.grill-openspec.md.example` 作为模板生成配置

#### Scenario: --lang en 组合变体选英文模板
- **WHEN** 分别调用 `tasking init --lang en`、`tasking init --workflow code-mr --lang en`、`tasking init --workflow grill-openspec --lang en`
- **THEN** 依次使用 `WORKFLOW.feishu-direct.en.md.example`、`WORKFLOW.code-mr.en.md.example`、`WORKFLOW.grill-openspec.en.md.example` 作为模板

#### Scenario: 未指定 --lang 默认中文
- **WHEN** 非交互模式调用 `tasking init` 不带 `--lang`
- **THEN** 使用对应变体的 zh 版模板（可选段按生成策略注释）

#### Scenario: --lang 未知值报错
- **WHEN** 调用 `tasking init --lang fr`
- **THEN** 报错并列出支持值 `zh, en`，以非零码退出，不生成配置

#### Scenario: --workflow 未知值报错
- **WHEN** 调用 `tasking init --workflow unknown`
- **THEN** 报错并以非零码退出，不生成配置

### Requirement: doctor 子命令
`tasking doctor` SHALL 对 workflow path 执行全链路只读体检（WORKFLOW.md 解析、飞书 token+探针+intake 可达、Jira 连接、opencode PATH），中文输出逐项结果与末尾汇总表，退出码 `0`（全部通过）或 `1`（任一失败）。workflow path 缺省为当前工作目录的 `./WORKFLOW.md`，可经位置参数指定；dotenv SHALL 从 `dirname(workflow path)` 加载（对齐 `start`）。它 SHALL 出现在顶层 help 与子命令帮助中，不执行写操作。`--help` 之外的未知参数 SHALL 报错退出。

#### Scenario: help 列出 doctor
- **WHEN** 运行 `tasking help`
- **THEN** 命令清单包含 `doctor` 及其一句说明

#### Scenario: 无 WORKFLOW.md
- **WHEN** 在没有默认 WORKFLOW.md 的目录运行 `tasking doctor`（无位置参数）
- **THEN** WORKFLOW 项标 ✗ 并提示先运行 `tasking init`，退出码 `1`

#### Scenario: 对自定义路径体检
- **WHEN** 运行 `tasking doctor configs/my-flow.md`
- **THEN** doctor 读取并体检该文件，dotenv 从 `configs/` 加载
