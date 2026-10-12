## Purpose

tasking init 的交互式引导流程：TTY 环境下的凭据问答、Jira 连接测试与项目状态展示、opencode 安装检查、编辑器自动打开与完成提示。
## Requirements
### Requirement: 交互式凭据问答
`tasking init` SHALL 在 stdin 为 TTY 时启动交互式 readline 问答，逐项收集：`tracker.kind`（固定 `jira`）、`tracker.endpoint`（用户输入）、`tracker.api_key`（写入 `$JIRA_API_KEY` 环境变量引用）、`tracker.auth_mode`（用户选 basic/bearer）、`tracker.api_user`（仅 `auth_mode: basic` 时问）、`tracker.project_key`（用户输入）。问答 SHALL 支持回车跳过可选项。SHALL 在每个提示旁显示简短说明。

#### Scenario: TTY 环境启动交互式问答
- **WHEN** stdin 为 TTY 且调用 `tasking init`
- **THEN** 启动 readline 逐项问答 Jira 凭据

#### Scenario: bearer 模式跳过 api_user
- **WHEN** 用户在 auth_mode 步骤选择 `bearer`
- **THEN** 跳过 api_user 问答

#### Scenario: basic 模式问 api_user
- **WHEN** 用户在 auth_mode 步骤选择 `basic`
- **THEN** 继续问 api_user

#### Scenario: api_key 写入环境变量引用
- **WHEN** 用户输入 api_key
- **THEN** WORKFLOW.md 的 `tracker.api_key` 字段写入 `$JIRA_API_KEY`，并提示用户将实际值加到 `~/.bashrc`

### Requirement: Jira 连接测试与状态展示
问答完成后 SHALL 用两步测试验证凭据：第一步请求 `/serverInfo` 验证 endpoint 可达且 auth 有效，第二步请求 `/project/{key}/statuses` 验证 project key 可访问。每步 SHALL 设 5s 超时。第一步成功 SHALL 打印 Jira 版本号。第二步成功 SHALL 打印项目状态列表供用户参考。第一步失败 SHALL 打印错误信息（含 endpoint 和常见原因提示：API 版本、context path、URL 可达性）。第二步失败 SHALL 打印 project key 错误信息（含 key 值和检查建议）。两步均不阻断后续流程。

#### Scenario: 两步均成功
- **WHEN** endpoint 可达、auth 有效、project key 可访问
- **THEN** 打印 Jira 版本号和项目状态列表，提示用户自行分配 active_states/terminal_states

#### Scenario: 第一步失败（endpoint 不可达或 auth 无效）
- **WHEN** `/serverInfo` 返回非 200 或网络错误
- **THEN** 打印错误信息（含 endpoint 和常见原因提示），跳过第二步，继续生成配置文件

#### Scenario: 第一步成功但第二步失败（project key 不可访问）
- **WHEN** `/serverInfo` 成功但 `/project/{key}/statuses` 返回非 200
- **THEN** 打印 Jira 版本号和 project key 错误信息（含 key 值和检查建议），继续生成配置文件

#### Scenario: 连接超时
- **WHEN** Jira 5s 内未响应
- **THEN** 打印超时错误，继续生成配置文件

### Requirement: opencode 安装检查
init SHALL 检查 `opencode` 命令是否可执行（`which opencode`）。找不到 SHALL 打印警告，SHALL NOT 阻断 init 流程。

#### Scenario: opencode 已安装
- **WHEN** `opencode` 在 PATH 中
- **THEN** 不打印警告，继续

#### Scenario: opencode 未安装
- **WHEN** `opencode` 不在 PATH 中
- **THEN** 打印警告"未检测到 opencode，daemon 无法执行任务"，继续

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

### Requirement: 完成提示

init 完成后 SHALL 按变体打印分级提示：feishu-direct SHALL 打印"配置完成"与可执行首句（`tasking start`，然后在群里发 `/chat <项目名> <消息>`），跳过项目问答时附 path 模式不限制目录的警告行；Jira 变体（minimal/code-mr/grill-openspec）SHALL 列出仍需手动编辑的字段，且该清单 SHALL 跟随状态预填结果——状态自动预填成功时去掉 `active_states`/`terminal_states`/`review_state`（只留 `after_create` 与 MR 变体的 `env.GITLAB_*`）；预填跳过或失败时保留原有四项清单。

#### Scenario: feishu-direct 打印首句命令
- **WHEN** feishu-direct 分支完成 init
- **THEN** 提示含 `tasking start` 与 `/chat` 示例命令

#### Scenario: Jira 状态已预填时提示去掉状态字段
- **WHEN** 接 Jira 且状态映射确认写入成功
- **THEN** 完成提示的手工字段清单不含 `active_states`/`terminal_states`/`review_state`

#### Scenario: 预填未发生时保留四项清单
- **WHEN** 接 Jira 且用户选择保持默认（或映射失败/连接失败）
- **THEN** 完成提示列出 `active_states`、`terminal_states`、`review_state`、`after_create`

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

### Requirement: workflow 选择问答

`tasking init` 交互式流程在未指定 `--workflow` 时 SHALL 以「任务来源」二选一作为首问：「只用飞书直连（回车默认）」与「接 Jira」。选飞书直连 SHALL 直接进入飞书凭据问答（见 `feishu-first-onboarding`）；选接 Jira SHALL 追问变体三选一（`minimal` / `code-mr` / `grill-openspec`，选项旁附简述：minimal＝最小：工作目录完成任务→上传 Jira→转终态；code-mr＝写码＋建 MR；grill-openspec＝拷问→propose→implement→archive）。已通过 `--workflow` 指定时 SHALL 跳过首问与变体追问。模板语言由独立的 Template language 问答或 `--lang` 决定（见 `cli-runtime`）。

#### Scenario: 任务来源回车默认飞书直连
- **WHEN** stdin 为 TTY 且未指定 `--workflow` 时调用 `tasking init`，任务来源首问直接回车
- **THEN** 进入飞书凭据问答，不出现 Jira 问答与变体名

#### Scenario: 接 Jira 追问变体
- **WHEN** 用户在任务来源首问选择「接 Jira」
- **THEN** 交互式追问变体三选一（`minimal` / `code-mr` / `grill-openspec`），随后进入 Jira 凭据问答

#### Scenario: 已指定 --workflow 跳过问答
- **WHEN** 调用 `tasking init --workflow code-mr` 且 stdin 为 TTY
- **THEN** 跳过任务来源与变体问答，直接用 `code-mr` 模板

#### Scenario: 选择 minimal 用最小模板
- **WHEN** 用户在变体问答中选择 `minimal`
- **THEN** 使用 `WORKFLOW.minimal.md.example` 模板生成 `WORKFLOW.md`，其 prompt body 不含 git 分支/MR/glab 步骤

#### Scenario: 选择 code-mr 用全-MR 模板
- **WHEN** 用户在变体问答中选择 `code-mr`
- **THEN** 使用所选语言的 `WORKFLOW.code-mr.md.example` 模板生成 `WORKFLOW.md`

#### Scenario: 选择 grill-openspec 用 grill 模板
- **WHEN** 用户在变体问答中选择 `grill-openspec`
- **THEN** 使用 `WORKFLOW.grill-openspec.md.example` 模板生成 `WORKFLOW.md`

### Requirement: Template language 选择问答
`tasking init` 交互式流程 SHALL 在未通过 `--lang` 显式指定语言时询问模板语言（「Template language」选择框，选项 `中文` 与 `English`，`中文` 在前作为回车默认）。已显式指定 `--lang` 时 SHALL 跳过此问答。所选语言 SHALL 与 workflow 选择正交，共同决定使用哪个模板文件（见 `cli-runtime`），并同时种子界面语言：选 `English` 时 SHALL 在生成的 WORKFLOW.md front matter 写入 `interface_language: en`；选 `中文` 时 SHALL 省略该字段（默认值 `zh`，遵循 generated-config-trimming 的只写非默认字段）。`init --update` 的漂移报告 SHALL NOT 将 `interface_language` 列为 zh 文件的缺失项（zh 漂移基线按生成器语义省略该字段）；en 文件的漂移基线 SHALL 含 `interface_language: en`，用户文件缺失该字段时 SHALL 照报。报告 SHALL NOT 写入该字段。

#### Scenario: 未指定 --lang 时询问语言
- **WHEN** stdin 为 TTY 且未指定 `--lang` 时调用 `tasking init`
- **THEN** 交互式弹出 Template language 选择框（`中文` / `English`）

#### Scenario: 已指定 --lang 跳过语言问答
- **WHEN** 调用 `tasking init --lang en` 且 stdin 为 TTY
- **THEN** 跳过 Template language 问答，直接使用英文模板

#### Scenario: 语言选择决定模板文件
- **WHEN** 用户在交互式问答中选择 `English`
- **THEN** 使用所选 workflow 变体的英文版模板生成 `WORKFLOW.md`

#### Scenario: 选 English 种子 interface_language
- **WHEN** 以 `--lang en`（或交互选 `English`）完成 init
- **THEN** 生成的 WORKFLOW.md front matter 含 `interface_language: en`

#### Scenario: 选中文省略字段
- **WHEN** 以 `--lang zh`（或交互选 `中文`）完成 init
- **THEN** 生成的 WORKFLOW.md front matter 不含 `interface_language` 字段

#### Scenario: --update 不把 zh 的 interface_language 列为缺失
- **WHEN** 对不含 `interface_language` 的 zh WORKFLOW.md 运行 `init --update`
- **THEN** 漂移报告不列出 `interface_language`（zh 生成基线按设计省略），文件未被写入

### Requirement: Feishu Setup 交互引导

交互式 init 的接 Jira 分支 SHALL 在 Jira 段之后提供 **Feishu Setup** 段：询问是否启用飞书评论桥；启用则采集 app_id、app_secret、intake_chat_id，并复用已发现的项目 issueTypes 供选择 `create_issue_type`（选项首项为模板默认 `Task`，回车即默认）。app_secret 采集 SHALL 支持明文直接写入（留空则保留 `$FEISHU_APP_SECRET` env 引用并提示 export）。采集值 SHALL 写入生成的 WORKFLOW.md `feishu:` 块：`app_id`/`intake_chat_id`/`create_issue_type` 写明文值，`enabled` 置 `true`。不启用则保持模板 `enabled: false`。

#### Scenario: 启用并采集
- **WHEN** 交互式 init 接 Jira 分支中用户选择启用飞书桥并填写值
- **THEN** 生成的 WORKFLOW.md `feishu:` 块 `enabled: true`、app_id/intake_chat_id/create_issue_type 为所填值

#### Scenario: app_secret 明文写入
- **WHEN** 用户在 app_secret 问答输入明文值
- **THEN** WORKFLOW.md 的 `app_secret` 写该明文值，并提示可改用 `FEISHU_APP_SECRET` 环境变量

#### Scenario: app_secret 留空保留 env 引用
- **WHEN** 用户在 app_secret 问答直接回车
- **THEN** `app_secret` 保持 `$FEISHU_APP_SECRET` 引用，并打印 export 提示

#### Scenario: 不启用保持关闭
- **WHEN** 交互式 init 接 Jira 分支中用户选择不启用飞书桥
- **THEN** 生成的 WORKFLOW.md 飞书块保持 `enabled: false`，不写任何飞书值

### Requirement: 非交互 init 飞书提示
非交互式 init SHALL 在输出末尾打印一行飞书接入指引，指向 `docs/feishu-quickstart.md`，说明启用桥需编辑 WORKFLOW.md 的 `feishu:` 块。

#### Scenario: 非交互模式提示
- **WHEN** 运行非交互式 init
- **THEN** 输出含 `docs/feishu-quickstart.md` 指引

### Requirement: feishu-direct 分支的问答裁剪

交互式 init 在 `feishu-direct` 变体下 SHALL：跳过 Jira 凭据三问（endpoint/api_key/project）与 Jira 连接测试；跳过 "Enable Feishu bridge" 选择（`feishu.enabled: true` 直接烘焙——该变体里飞书就是全部）；跳过 issue types 问答（无 Jira 可查）；跳过 glab/GitLab 检查（无技能依赖）；仅询问飞书凭证 app_id 与 intake_chat_id（与现有 Feishu 问答一致；app_secret 不在终端回显，保留 `$FEISHU_APP_SECRET` 引用 + 环境变量提示）。SHALL NOT 新增交互式 projects 收集（模板留注释示例，用户编辑 WORKFLOW.md 配置）。

#### Scenario: 不问 Jira 凭据
- **WHEN** 交互式 init 选择 feishu-direct 后进入凭据阶段
- **THEN** 不出现 Jira endpoint/api_key/project 问答，也不执行连接测试

#### Scenario: 飞书必答两项
- **WHEN** feishu-direct 交互流进行
- **THEN** 依次询问 app_id、intake_chat_id 并写入生成的 WORKFLOW.md；app_secret 保持 `$FEISHU_APP_SECRET` 引用（提示经环境变量注入）

#### Scenario: VCS 前置检查跳过
- **WHEN** feishu-direct 交互流的 Prerequisites 面板打印
- **THEN** 不包含 glab 与 GitLab 环境变量检查（仅 opencode）

#### Scenario: Enable-Feishu 问答被跳过
- **WHEN** feishu-direct 交互流进行
- **THEN** 不出现 "Enable Feishu bridge" 选择，生成配置的 `feishu.enabled` 为 true

### Requirement: init 飞书体检输出
交互式 init 在飞书凭据验证通过后 SHALL 运行 scope 探针并逐项输出结果；缺失项 MUST 附补救指引（控制台搜索词 + 深链）。缺失权限 SHALL 只警告不阻断，init 的硬门槛保持为凭据正确性。直连路径与接 Jira 路径 SHALL 共用同一体检逻辑。

#### Scenario: 直连路径体检
- **WHEN** 直连 init 中凭据验证通过且 `im:resource` 未开通
- **THEN** 体检输出中该项为 ✗ 并附 `im:resource` 搜索指引与权限页深链，流程继续

#### Scenario: 接 Jira 路径体检
- **WHEN** 接 Jira init 中启用飞书桥且所有探针通过
- **THEN** 体检输出各项为 ✓，继续后续采集

### Requirement: 群选择器新建 intake 群选项
交互式 init 的飞书群选择器顶部 SHALL 提供「新建 intake 群」选项：选中后询问群名（默认 `tasking-intake`），调用建群 API，成功后以新群 chat_id 完成选择。建群失败（如缺 `im:chat` 权限）SHALL 输出缺失说明与深链，并降级回群选择器手选已有群。非交互模式 SHALL 不提供此选项。

#### Scenario: 新建成功
- **WHEN** 用户选择新建并接受默认群名，且 `im:chat` 已开通
- **THEN** 建群成功，生成的 WORKFLOW.md `intake_chat_id` 为新群 chat_id

#### Scenario: 缺权限降级
- **WHEN** 用户选择新建但建群 API 报权限错误
- **THEN** 输出缺 `im:chat` 说明与权限页深链，返回群选择器可手选已有群

#### Scenario: 非交互跳过
- **WHEN** 以 `--non-interactive` 运行 init
- **THEN** 不发起任何建群请求

#### Scenario: 新建并拉创建者进群
- **WHEN** 用户选择新建并填写飞书邮箱或手机号，且 `contact:user.id:readonly` 已开通
- **THEN** 建群请求的成员列表包含该用户的 open_id，生成的 WORKFLOW.md `intake_chat_id` 为新群 chat_id，输出提示用户已在群里

#### Scenario: 只有机器人的群不选用
- **WHEN** 新建成功但未拉入任何人类成员（邀请被跳过或用户查询失败）
- **THEN** 输出明确警告该群只有机器人成员、用户在飞书不可见，不将其写为 intake_chat_id，并引导手动建群后通过「⟳ 刷新群列表」重选

### Requirement: Feishu edition 首问
交互式 init 的两条飞书配置流程（feishu-direct 分支与接 Jira 分支的 Feishu Setup）SHALL 在采集 app_id 之前先问飞书版本：选项 `国内版（飞书）（默认）` 与 `海外版（Lark）`，默认项按模板语言预选（中文→国内版，English→海外版；askSelect 首项即回车默认）。回答后：现场凭据验证（tenant_access_token）与后续体检 SHALL 立即使用所选 edition 的 API 域名；生成的 WORKFLOW.md `feishu:` 块 SHALL 写入 `edition` 明文值。凭据验证失败输出 SHALL 附跨区域提示（指向另一版的 edition 写法）。不配置飞书（Jira-only / 桥接流程选择不启用）时 SHALL NOT 出现此问、SHALL NOT 写 `edition` 键。SHALL NOT 纯按语言推断跳过提问（语言≠区域）。

#### Scenario: 首问位置与默认预选
- **WHEN** 中文模板语言下进入飞书配置流程
- **THEN** app_id 问答之前出现版本选择，首项（回车默认）为 `国内版（飞书）`

#### Scenario: English 预选海外版
- **WHEN** English 模板语言下进入飞书配置流程
- **THEN** 版本选择首项（回车默认）为 `海外版（Lark）`

#### Scenario: 验证走所选域名
- **WHEN** 用户选择 `海外版（Lark）` 后输入 app_id/secret
- **THEN** init 凭据验证请求发往 `open.larksuite.com`

#### Scenario: 写入 WORKFLOW.md
- **WHEN** 飞书配置完成且用户选择了 `海外版（Lark）`
- **THEN** 生成的 WORKFLOW.md `feishu:` 块含 `edition: lark`

#### Scenario: 不配飞书不问
- **WHEN** 接 Jira 分支中用户选择不启用飞书桥
- **THEN** 不出现版本问答，生成的配置不含 `edition` 键

#### Scenario: 验证失败附跨区域提示
- **WHEN** 所选 edition 下凭据验证失败
- **THEN** 失败输出含"若应用创建于另一版，设置 feishu.edition"的条件句提示

### Requirement: 问卷引导跟随界面语言
交互式 init 问卷的自有文案（框线标题、说明行、问题文本、选项标签）SHALL 按界面语言渲染：语言判定遵循三条规则——① `--lang` 显式给出时 SHALL 在问卷任何输出之前设置 locale（`--lang en` 下第一问即为英文）；② 未给出 `--lang` 时前两问 SHALL 维持 zh 默认（模板语言本身是问卷项，鸡生蛋），答完立即切换；③ `--force` 重跑且已存在 WORKFLOW.md 时 SHALL 读取旧文件 `interface_language` 预设问卷语言（读取/解析失败静默回退 zh）。zh locale 下问卷输出 SHALL 与现状逐字节一致。

#### Scenario: --lang en 下第一问即为英文
- **WHEN** 以 `--lang en` 运行交互式 init
- **THEN** 任务来源问（含说明行与选项标签）渲染为英文，后续框线/问题/选项同为英文

#### Scenario: 无 --lang 时前两问维持中文
- **WHEN** 不带 `--lang` 运行交互式 init
- **THEN** 任务来源与模板语言两问以中文呈现（现状行为），选择 English 后后续问卷切换英文

#### Scenario: --force 沿用既有界面语言
- **WHEN** WORKFLOW.md 已存在（interface_language: en）且以 `--force` 重跑交互式 init
- **THEN** 问卷以英文开始

#### Scenario: --force 旧文件不可读时回退
- **WHEN** `--force` 重跑但旧 WORKFLOW.md 缺失 interface_language 或解析失败
- **THEN** 问卷以 zh 开始（等同现状），不报错

### Requirement: 选项协议值与显示标签解耦
`askSelect` 选项 SHALL 采用 `{ value, label }` 形态：`value` 为类型化协议值（调用方分支判断仅使用 value），`label` 为显示文案（渲染瞬间翻译、用完即弃）。修改/翻译标签文案 SHALL NOT 影响任何问卷分支判断。动态数据标签（群名、Jira issueType）SHALL 原样显示（翻译对非字典串恒等）。

#### Scenario: 英文标签不改变分支走向
- **WHEN** `--lang en` 下用户在任务来源问选择 "Connect Jira"
- **THEN** 问卷走接 Jira 分支（协议值为 jira），与 zh 下选择 "接 Jira" 行为一致

#### Scenario: 动态数据标签原样显示
- **WHEN** 群选择器列出机器人所在群（群名为用户命名数据）
- **THEN** 群名标签按原文显示，选中后以对应 chat_id 作为协议值返回
