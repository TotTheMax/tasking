## Purpose

tasking CLI 的入口、子命令与运行时行为。
## Requirements
### Requirement: CLI 入口与子命令
`tasking` CLI SHALL 为单一入口,通过 npm 分发,可 `npx tasking` 调用。它 SHALL 支持子命令 `init`、`start`、`status`、`logs`、`stop`、`tui`、`doctor`。`start` SHALL 启动托管两个调度器的 daemon 进程;`doctor` SHALL 执行只读体检;其余子命令 SHALL 控制或观察运行中的 daemon。

#### Scenario: 无子命令
- **WHEN** `tasking` 不带子命令被调用
- **THEN** 打印用法并以非零码退出

#### Scenario: 未知子命令
- **WHEN** `tasking` 以未知子命令被调用
- **THEN** 打印错误并以非零码退出

#### Scenario: npx 执行
- **WHEN** 在 Node 22+ 且有网络的宿主机上调用 `npx tasking start`
- **THEN** daemon 启动,无需全局安装

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

### Requirement: 配置解析含默认值与环境变量间接引用
配置层 SHALL 解析 `WORKFLOW.md` 的 YAML front matter,为可选字段应用内置默认值,仅对显式包含 `$VAR_NAME` 的值解析 `$VAR_NAME` 间接引用,对路径字段展开 `~`,并将相对 `workspace.root` 解析为相对于 `WORKFLOW.md` 所在目录。环境变量 SHALL NOT 全局覆盖 YAML 值。配置层 SHALL 支持 `env` 段:值为 `Record<string, string>`,每个值的 `$VAR_NAME` 间接引用 SHALL 以环境变量值替换,解析为空字符串时 SHALL 注入空字符串值。`env` 段缺失时 SHALL 默认为空对象。

#### Scenario: 缺失可选字段应用默认值
- **WHEN** `WORKFLOW.md` 省略 `polling.interval_ms`
- **THEN** 生效配置使用文档化的默认值

#### Scenario: 美元变量解析
- **WHEN** `tracker.api_key` 为 `$JIRA_TOKEN` 且环境设置了 `JIRA_TOKEN`
- **THEN** 解析后的配置使用该环境变量的值

#### Scenario: 空环境变量视为缺失
- **WHEN** `$VAR_NAME` 解析为空字符串
- **THEN** 该值视为缺失

#### Scenario: 家目录展开
- **WHEN** `workspace.root` 为 `~/tasking`
- **THEN** 展开为用户家目录

#### Scenario: 相对工作区根
- **WHEN** `workspace.root` 为相对路径且 `WORKFLOW.md` 位于 `/repo/WORKFLOW.md`
- **THEN** 生效根解析为相对于 `/repo`

#### Scenario: env 段美元变量解析
- **WHEN** `env.GITLAB_TOKEN` 为 `$GITLAB_TOKEN` 且环境设置了 `GITLAB_TOKEN`
- **THEN** 解析后的 `env.GITLAB_TOKEN` 使用该环境变量的值

#### Scenario: env 段缺失默认空对象
- **WHEN** `WORKFLOW.md` 省略 `env` 段
- **THEN** 生效配置的 `env` 为空对象 `{}`

### Requirement: 动态工作流重载
daemon SHALL 检测 `WORKFLOW.md` 变更,无需重启即重新读取并重新应用配置与 prompt 模板,并为后续派发调整在线行为(轮询间隔、并发、active/terminal 状态、opencode 设置、工作区路径/hook、prompt 内容)。无效重载 SHALL NOT 使 daemon 崩溃;SHALL 保留上一个已知良好配置并向运维者发出可见错误。在途 agent 会话无需自动重启。

#### Scenario: 配置变更无需重启即生效
- **WHEN** daemon 运行中修改 `WORKFLOW.md` 的 `polling.interval_ms`
- **THEN** 后续 tick 使用新间隔

#### Scenario: 无效重载保留上一个良好配置
- **WHEN** daemon 运行中将 `WORKFLOW.md` 编辑为无效 YAML
- **THEN** daemon 保留上一个有效配置,向运维者发出可见错误,不崩溃

### Requirement: 派发预校验

启动校验 SHALL 按任务源分流。`tracker.kind` 为 `jira`（或缺省）时维持现状：`kind` 必须为 `jira`、`api_key` 必填、`project_key`/`project_slug` 二选一。`tracker.kind: none` 时 SHALL 跳过全部 Jira 必填项，转而执行 trackerless 校验：飞书启用时 `app_id`/`app_secret`/`intake_chat_id` 必填（不变），`create_issue_type` 不再必填（该字段纯 `/issue` 使用）；并 SHALL 拒绝两种退化组合（无任何任务源 / 飞书开但直连关）。`opencode.command` SHALL NOT 设必填校验（resolver 以 `opencode run` 默认值兜底），原死检查删除。未知 `tracker.kind` 仍 SHALL 报 `unsupported_tracker_kind`。

#### Scenario: jira 源缺凭证仍拒绝
- **WHEN** `tracker.kind: jira` 且缺 `api_key`
- **THEN** 启动失败，报 `missing_tracker_api_key`（现状不变）

#### Scenario: none 源跳过 Jira 必填
- **WHEN** `tracker.kind: none` 且不配置任何 Jira 字段
- **THEN** 启动校验不因 tracker 字段失败

#### Scenario: none 源下 create_issue_type 缺失不报错
- **WHEN** `tracker.kind: none`、feishu 启用、未配置 `feishu.create_issue_type`
- **THEN** 启动校验通过

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

### Requirement: status 与 logs 子命令
`tasking status` SHALL 通过 HTTP dashboard API 查询运行中 daemon 的实时状态,打印人类可读快照:运行中任务(标识符、状态、turn 数、elapsed、token)、retry 队列(标识符、attempt、due_at、error)、聚合 token/运行时总量。SHALL 支持 `--json` 输出原始 API JSON。当 daemon 未运行 HTTP dashboard 时,SHALL 回退到仅报告 PID 状态。当无 daemon 运行时 SHALL 以非零码退出。

`tasking logs` SHALL 打印近期结构化日志的最后 N 行(默认 100,`--lines N` 可配),SHALL 支持 `--follow` 持续跟踪日志输出直到 `SIGINT`,SHALL 支持 `--level debug|info|warn|error` 按日志级别过滤(非 JSON 行始终保留)。日志文件路径 SHALL 按序解析:daemon 元信息文件中的 `log_path`(daemon 运行时)优先,否则回退当前目录 `tasking.log`。

#### Scenario: 无运行 daemon 时 status
- **WHEN** 无 daemon 运行时调用 `tasking status`
- **THEN** 报告 daemon 未运行并以非零码退出

#### Scenario: status 查询 HTTP API
- **WHEN** daemon 运行且 HTTP dashboard 可达时调用 `tasking status`
- **THEN** 通过 `GET /api/v1/state` 查询并格式化输出运行中任务与 retry 队列

#### Scenario: status --json 输出
- **WHEN** 调用 `tasking status --json`
- **THEN** 输出 API 原始 JSON,适合管道处理

#### Scenario: status 无 HTTP 端口回退
- **WHEN** daemon 运行但未配置 HTTP dashboard 端口时调用 `tasking status`
- **THEN** 报告 daemon PID 并提示 HTTP dashboard 未配置

#### Scenario: status 展示运行与重试
- **WHEN** daemon 有运行与重试任务时调用 `tasking status`
- **THEN** 输出列出运行中任务与 retry 队列条目,含标识符与时间

#### Scenario: logs 默认 tail 100 行
- **WHEN** 调用 `tasking logs` 且日志文件存在
- **THEN** 打印最后 100 行结构化日志

#### Scenario: logs 指定行数
- **WHEN** 调用 `tasking logs --lines 50`
- **THEN** 打印最后 50 行

#### Scenario: logs follow 持续跟踪
- **WHEN** 调用 `tasking logs --follow`
- **THEN** 持续打印新增日志行直到收到 `SIGINT`

#### Scenario: logs 按级别过滤
- **WHEN** 调用 `tasking logs --level error`
- **THEN** 仅打印 `level: "error"` 的 JSON 日志行(非 JSON 行始终保留)

#### Scenario: logs 文件不存在
- **WHEN** 调用 `tasking logs` 且 `tasking.log` 不存在
- **THEN** 报告无日志并以非零码退出

#### Scenario: logs 优先用 daemon 记录的日志路径
- **WHEN** 当前目录存在 `.tasking/daemon.json` 且含 `log_path`(daemon 启动时按 `logging.file.path` 配置或默认 `tasking.log` 写入),且该路径下日志文件存在
- **THEN** `tasking logs` 读取 `log_path` 指向的文件(而非当前目录的 `tasking.log`)

#### Scenario: 旧格式 daemon 信息回退当前目录
- **WHEN** daemon.json 无 `log_path` 字段(旧格式)或 daemon 未运行
- **THEN** `tasking logs` 回退读取当前目录 `tasking.log`

### Requirement: triage 子命令
`tasking triage` SHALL 在 route-agent 未接线时输出提示信息并以非零码退出,SHALL NOT 出现在 USAGE 帮助文本中。待 route-agent 接入 daemon tick 后 SHALL 恢复为触发 route-agent 运行的完整行为。

#### Scenario: route-agent 未接线时调用 triage
- **WHEN** 调用 `tasking triage`
- **THEN** 输出 "not yet available" 提示并以非零码退出

#### Scenario: triage 不出现在帮助文本
- **WHEN** 调用 `tasking --help` 或 `tasking`(无参数)
- **THEN** USAGE 文本中不包含 `triage`

### Requirement: 干净的进程生命周期
CLI 在 daemon 正常启动与关闭时 SHALL 以 0 退出,在启动失败或进程异常退出时 SHALL 以非零码退出。SHALL 通过尽可能优雅地停止活动 worker 来处理 SIGINT/SIGTERM。

#### Scenario: 正常关闭
- **WHEN** 运行中的 daemon 收到 SIGINT
- **THEN** 优雅停止 worker 并以 0 退出

#### Scenario: 启动失败退出码
- **WHEN** 启动校验失败
- **THEN** 进程以非零码退出

### Requirement: start --detach 后台运行
`tasking start` SHALL 支持 `--detach` 参数,使 daemon 在后台独立运行。启用时父进程 SHALL 以 `detached: true` + `stdio: "ignore"` 重新 spawn 自身(去掉 `--detach` 参数),`child.unref()` 后父进程退出。子进程 SHALL 继承工作目录与环境变量,独立执行前台 daemon 逻辑。`--detach` 与 `--tui` 同时使用时 SHALL 报错退出。

#### Scenario: detach 后台启动
- **WHEN** 调用 `tasking start --detach`
- **THEN** 父进程 spawn 子进程后输出 PID 并以 0 退出,子进程在后台独立运行

#### Scenario: detach 与 tui 互斥
- **WHEN** 调用 `tasking start --detach --tui`
- **THEN** 报错"detach and tui are mutually exclusive"并以非零码退出

#### Scenario: detach 子进程写元信息
- **WHEN** `--detach` 子进程启动并完成初始化
- **THEN** `daemon.json` 被写入,含子进程 PID

### Requirement: start --fresh 以新机器方式启动飞书桥
`tasking start` SHALL 支持 `--fresh` option：仅在 `feishu.enabled` 时生效——在桥启动（首次 Sweep 前）执行新机模式重置（清空本地 intake 游标 + 按 Jira 现状对账过期 binding，见 `comment-bridge` 能力）。`feishu.enabled=false` 时 `--fresh` SHALL 打印一行提示（说明仅飞书桥启用时生效）并照常以 0 继续启动。`--fresh` SHALL 与 `--detach`、`--tui` 正交组合。CLI help 的 start 段 SHALL 列出 `--fresh` 及其含义。

#### Scenario: fresh 且飞书启用 → 桥以新机模式启动
- **WHEN** `feishu.enabled=true` 且调用 `tasking start --fresh`
- **THEN** `bridge.start()` 前执行 `freshStartReset()`，首次 Sweep 即按冷启动探测语义运行，不回放停机窗口历史

#### Scenario: fresh 且飞书未启用 → 提示并继续
- **WHEN** `feishu.enabled=false` 且调用 `tasking start --fresh`
- **THEN** 打印「`--fresh` 仅在 feishu.enabled 时生效」提示，daemon 照常以 0 继续启动（no-op）

#### Scenario: help 列出 --fresh
- **WHEN** 调用 `tasking start -h`
- **THEN** 输出含 `--fresh` 及其说明

### Requirement: stop 子命令
`tasking stop` SHALL 读取 daemon 元信息文件获取 PID,向该进程发送 `SIGTERM`,等待其优雅退出(超时 10s 后发 `SIGKILL`)后清理元信息文件。当无 daemon 运行时 SHALL 报告并以非零码退出。当 PID 对应进程不存在时 SHALL 清理过期的元信息文件。

#### Scenario: 停止运行中 daemon
- **WHEN** daemon 运行时调用 `tasking stop`
- **THEN** 向 daemon 进程发送 `SIGTERM`,等待退出后以 0 退出

#### Scenario: 超时强制停止
- **WHEN** daemon 收到 SIGTERM 后 10s 未退出
- **THEN** 发送 SIGKILL 强制终止

#### Scenario: 无 daemon 时 stop
- **WHEN** 无 daemon 运行时调用 `tasking stop`
- **THEN** 报告 daemon 未运行并以非零码退出

#### Scenario: 清理过期元信息
- **WHEN** 调用 `tasking stop` 且元信息文件存在但对应进程已不存在
- **THEN** 清理元信息文件并报告 daemon 未运行

### Requirement: tui 子命令
`tasking tui` SHALL 连接 daemon 的 HTTP dashboard API,轮询 `GET /api/v1/state` 并渲染终端仪表板(复用 `TerminalDashboard` 渲染逻辑)。SHALL 每 1s 刷新一次。退出 TUI(`q` 或 `SIGINT`)SHALL NOT 影响 daemon 进程。进入 TUI 前 SHALL 探测一次 `/api/v1/state` 连通性;不可达 SHALL 打印含已解析端口与 `--port` 覆盖提示的错误并以非零码退出。端口解析见「tui 手动指定端口」。

#### Scenario: 连接 daemon 渲染 TUI
- **WHEN** daemon 运行且 HTTP dashboard 可达时调用 `tasking tui`
- **THEN** 轮询 API 并渲染终端仪表板,显示运行中任务、retry 队列与聚合总量

#### Scenario: TUI 退出不影响 daemon
- **WHEN** 用户在 `tasking tui` 中按 `q` 或 `SIGINT` 退出
- **THEN** TUI 停止渲染,daemon 继续运行

#### Scenario: 解析端口不可达
- **WHEN** 按解析规则得出端口且该端口无 daemon 监听
- **THEN** 打印含该端口与 `--port` 覆盖方式的错误并以非零码退出

### Requirement: daemon 元信息含 workflow 路径与实际端口

`tasking start` 写入的 `daemon.json` SHALL 包含 `workflow_path`（当前加载的工作流文件绝对路径）与 `port`。当以 `--port 0`（请求临时端口）启动时，写入的 `port` SHALL 为 HTTP dashboard 实际绑定的端口而非 0。读取旧格式（缺 `workflow_path`）的 daemon.json SHALL 兼容降级（视为 null）。

#### Scenario: 写入 workflow_path
- **WHEN** daemon 启动完成并写入 daemon.json
- **THEN** daemon.json 含 workflow_path 字段，指向加载的工作流文件

#### Scenario: --port 0 写入实际端口
- **WHEN** 以 `--port 0` 启动 daemon 且 dashboard 绑定到随机端口 N
- **THEN** daemon.json 的 port 为 N，`tasking tui` / `status` 能据此连接

#### Scenario: 旧格式兼容
- **WHEN** 读取不含 workflow_path 的旧 daemon.json
- **THEN** workflow_path 视为 null，其余字段正常读取

### Requirement: tui 手动指定端口

`tasking tui` SHALL 按如下优先级解析连接的 dashboard 端口：1) `--port <n>`（或 `-p <n>`）显式指定；2) 当前目录 `.tasking/daemon.json` 的 `port`（若存在）；3) 兜底 `8080`。host 取 daemon.json 的 host（若存在），否则 `127.0.0.1`。`--port` 显式指定时 SHALL NOT 依赖当前目录 daemon.json。非数值端口 SHALL 报错并以非零码退出。进入 TUI 前 SHALL 探测一次 `/api/v1/state` 连通性，不可达时 SHALL 打印错误（含解析端口与 `--port` 覆盖提示）并以非零码退出。

#### Scenario: 手动指定端口
- **WHEN** 调用 `tasking tui --port 9000` 且 9000 上有可达 daemon
- **THEN** TUI 连接到 9000 端口渲染，无需当前目录 daemon.json

#### Scenario: 指定端口不可达
- **WHEN** 调用 `tasking tui --port 9999` 且该端口无 daemon 监听
- **THEN** 打印「cannot reach dashboard」且含端口与 `--port` 提示，以非零码退出

#### Scenario: 非数值端口
- **WHEN** 调用 `tasking tui --port abc`
- **THEN** 打印「invalid port」并以非零码退出

#### Scenario: 无参时读 daemon.json 端口
- **WHEN** 调用 `tasking tui` 且当前目录 `.tasking/daemon.json` 存在且含 port
- **THEN** 以该 port 连接渲染

#### Scenario: 无参且无 daemon.json 时兜底 8080
- **WHEN** 调用 `tasking tui` 且当前目录无 `.tasking/daemon.json`
- **THEN** 以 `8080` 作为端口探测连接；不可达则按解析端口报错退出

### Requirement: 顶层 help 含命令说明
`tasking --help` 与 `tasking help`（无目标时）SHALL 输出到 stdout 并以 0 退出。help SHALL 包含 `tasking` 一句话简介、用法行、命令列表（每个公开子命令 `init`/`start`/`status`/`logs`/`stop`/`tui` 附一句话说明）、选项（`-h, --help`）、以及“详情见 `tasking <cmd> --help`”的指引。命令说明 SHALL 为英文。

#### Scenario: tasking --help
- **WHEN** 调用 `tasking --help` 或 `tasking -h`
- **THEN** 输出到 stdout、退出码 0，且文本含 `init`/`start`/`status`/`logs`/`stop`/`tui` 及 `--help`

#### Scenario: tasking help 无目标
- **WHEN** 调用 `tasking help`
- **THEN** 输出与 `tasking --help` 相同的顶层 help、退出码 0

### Requirement: 子命令帮助
每个公开子命令 `init`/`start`/`status`/`logs`/`stop`/`tui` SHALL 支持 `--help|-h`，`init`/`start`/`status`/`logs`/`stop`/`tui` SHALL 可通过 `tasking help <cmd>` 查看。子命令帮助 SHALL 输出到 stdout、退出码 0，并包含该命令的用法行、参数/选项说明（含短选项与默认值）。`triage` SHALL NOT 出现在任何帮助文本中。

#### Scenario: 子命令 --help
- **WHEN** 调用 `tasking init --help`、`tasking start -h`、`tasking status --help`、`tasking logs --help`、`tasking stop --help`、`tasking tui --help`
- **THEN** 各自打印对应命令帮助到 stdout、退出码 0

#### Scenario: help 加目标命令
- **WHEN** 调用 `tasking help logs`（或其他公开子命令名）
- **THEN** 打印该命令的帮助到 stdout、退出码 0

#### Scenario: help 后跟未知命令
- **WHEN** 调用 `tasking help bogus`
- **THEN** 打印错误到 stderr、退出码 1，且不打印 `triage`

#### Scenario: 帮助文本不含 triage
- **WHEN** 检查 `tasking --help` 与任一子命令帮助文本
- **THEN** 文本中不包含 `triage`

### Requirement: 子命令帮助 option 描述与实际行为一致

每个公开子命令的 option 帮助描述 SHALL 与实际实现行为一致，不得遗漏或夸大该 option 触发的主要操作。`tasking init --update` 的选项描述 SHALL 同时覆盖技能同步与 WORKFLOW.md 漂移报告两部分真实行为（探测/打印 workflow 变体与模板语言、打印漂移报告：新增 config 字段 + prompt body diff、存在漂移时写入 `.tasking/WORKFLOW.md.reference` 并提示 `git diff --no-index`）；备份语义仍为 `<file>.bak`。`--workflow` 与 `--lang` 的描述 SHALL 同时说明其在 `--update` 模式下用于选择漂移报告模板。描述 SHALL 为英文、保持单行风格。

#### Scenario: init --update 帮助描述含 workflow 漂移报告

- **WHEN** 调用 `tasking init --help`
- **THEN** `--update` 的选项描述同时提及技能同步（modified files backed up as `<file>.bak`）与 WORKFLOW.md 漂移报告（workflow 相关逻辑），不再只写技能同步

#### Scenario: --workflow/--lang 帮助描述说明其在 --update 中的角色

- **WHEN** 调用 `tasking init --help`
- **THEN** `--workflow <name>` 与 `--lang <zh|en>` 的选项描述提及 `--update` 下用于选择漂移报告模板

#### Scenario: 其他子命令帮助描述与实现一致

- **WHEN** 对照 `start`/`status`/`logs`/`stop`/`tui` 的帮助文本与其实现（`src/cli/index.ts`、`src/cli/daemon-info.ts`）逐条核对
- **THEN** 各 option 描述均与实际行为一致，无遗漏或夸大

### Requirement: start 装配按任务源分流

`tasking start` SHALL 读取 `tracker.kind`：为 `jira`（或缺省）时按现状构造 `JiraTracker` 与 `Scheduler` 并挂载 tick 循环与终端工作区清理；为 `none` 时 SHALL不构造两者，`ActivityStore` SHALL 独立实例化供直连会话与 dashboard/TUI 消费，dashboard 与 TUI 的调度状态使用空快照（零 running/retrying），`requestRefresh` 为 no-op，`startupTerminalCleanup` 不执行。飞书侧（事件通道、桥、直连管理器、绑定 store）的装配与 kind 无关，仅桥的 tracker 依赖为空。运行中 `tracker.kind` 与启动值不同时 SHALL 记 WARN"任务源变更需重启生效"。

#### Scenario: jira 部署装配不变
- **WHEN** 现有 Jira+飞书配置启动
- **THEN** Scheduler 照常构造并轮询（现状零变化）

#### Scenario: none 部署不构造调度器
- **WHEN** `tracker.kind: none` 启动
- **THEN** 进程内不存在 JiraTracker/Scheduler 实例；直连会话与 dashboard 正常工作

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
