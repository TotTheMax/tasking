# 使用指南

本文档介绍 `tasking` 的安装、命令、配置与典型使用场景。所有命令与配置键名保持英文原文。

## 安装

### 前置要求

- **Node.js 22+**:在终端运行 `node --version` 确认。
- **opencode CLI**:需在 `PATH` 上可执行 **opencode v2**（`>=2.0 <3`；v1 请 `opencode upgrade --major`）。安装见 [opencode.ai](https://opencode.ai)。
- **Jira 账号**(结构化源):需要 API token,用于 Basic auth。
- **飞书应用**(非结构化源,可选):需要 app id/secret,用于接收 IM 消息与回复。

### 全局安装

```bash
npm install -g @tothemax/tasking
tasking --help
```

### 免安装使用(npx)

```bash
npx @tothemax/tasking --help
npx @tothemax/tasking init
npx @tothemax/tasking start
```

## 快速上手

### 1. 初始化工作流文件

在项目根目录运行:

```bash
tasking init
```

这会生成一份入门 `WORKFLOW.md`(含 YAML front matter + prompt body),并创建本地 `tasking_workspaces/` 目录。若 `WORKFLOW.md` 已存在,需加 `--force` 才会覆盖;覆盖前旧文件会自动备份为 `WORKFLOW.md.bak`。

### 2. 编辑配置

打开 `WORKFLOW.md`,至少填写 Jira 凭据与项目 key:

```yaml
---
tracker:
  kind: jira
  endpoint: https://your-domain.atlassian.net/rest/api/3
  api_key: $JIRA_API_TOKEN
  api_user: you@example.com
  project_key: ENG
---
```

将 API token 通过环境变量传入(避免写入文件):

```bash
export JIRA_API_TOKEN="你的-jira-api-token"
```

完整字段说明见 [配置参考](./configuration.md)。

### 3. 启动 daemon

```bash
tasking start
```

默认加载当前目录的 `WORKFLOW.md`。daemon 会按 `polling.interval_ms`(默认 30000ms)轮询 Jira,派发符合条件的任务给 opencode worker。

按 `Ctrl+C` 优雅停止。

## 命令详解

### 帮助入口

`tasking --help`（或 `-h`）与 `tasking help` 打印顶层帮助：命令列表 + 一句话说明。查看某个子命令的详细帮助（usage、参数、选项表）可用 `tasking <cmd> --help`（或 `-h`）或 `tasking help <cmd>`。显式请求的帮助输出到 stdout 且退出码 0；无子命令、未知子命令、`help` 后跟未知命令输出到 stderr 且退出码 1。

### 版本入口

`tasking --version`（或 `-v`）向 stdout 打印已安装的版本（来自 `package.json` 的裸 semver，如 `0.6.17`），退出码 0。`tasking doctor` 的体检报告第一行也会打印该版本。

### `tasking init`

生成入门 `WORKFLOW.md` 与本地工作区目录。默认交互式引导填写 Jira 凭据。位置参数 `[workflow-path]` 可指定配置文件路径（缺省 `./WORKFLOW.md`），生成的配置、`.opencode/skills/`、`.tasking/` 参考副本与 `.bak` 备份都以该文件所在目录为基准；与 `start`/`doctor` 语义一致，传目录视为错误。

```bash
tasking init [workflow-path] [--force] [--non-interactive] [--workflow minimal|code-mr|grill-openspec|feishu-direct] [--lang zh|en] [--update | --restore]
```

| 选项 | 说明 |
|------|------|
| `workflow-path` | `WORKFLOW.md` 路径,缺省 `./WORKFLOW.md`。`init`(生成/`--update`/`--restore`)、`start`、`doctor` 语义一致;父目录不存在时生成会递归创建;传目录视为错误 |
| `--force` | 覆盖已存在的 `WORKFLOW.md`(覆盖前自动备份为 `<workflow-path>.bak`) |
| `--non-interactive` | 跳过交互式问答,直接复制示例文件(用于 CI/脚本)。stdin 非 TTY 时自动生效 |
| `--workflow <name>` | 选择 workflow 变体:`minimal`(最小:工作目录完成任务→上传 Jira→转终态)、`code-mr`(写码＋建 MR)、`grill-openspec`(拷问→propose→implement→archive 四阶段) 或 `feishu-direct`(飞书直连专用,**默认**)。交互式下未指定时首问「任务来源」(只用飞书直连[回车默认]/接 Jira→追问变体三选一);非交互式下缺省即 `feishu-direct`。未知值报错退出 |
| `--lang <zh\|en>` | 模板语言(WORKFLOW.md 注释与引导文案):`zh`(中文,规范版) 或 `en`(英文)。默认 `zh`;交互式下未指定时会弹出「Template language」选择框引导。与 `--workflow` 正交组合(4 变体 × 2 语言)。技能安装集合只由变体决定,与语言无关。未知值报错退出 |
| `--update` | 非破坏性升级:把 `assets/skills/` 的全部技能同步到 workflow path 所在目录的 `.opencode/skills/`(缺失即新装;改过的文件先备份为 `<file>.bak` 再覆盖),打印探测到的 workflow 变体,并打印 WORKFLOW.md 漂移报告(缺失 config 字段——对比「今天重新 init 会写出的字段」这一生成基线,生成器按设计省略的段不计缺失——与 prompt body diff)。存在漂移时还会把完整新模板写到同目录 `.tasking/<目标文件名>.reference`(gitignored)并给出 `git diff --no-index` 命令,方便逐处核对改动位置。**不写** WORKFLOW.md。需已有 WORKFLOW.md |
| `--restore` | 回撤:把 `<workflow-path>.bak`(若有,来自 `--force` 覆盖前备份)与 workflow path 所在目录 `.opencode/skills/**` 下的 `.bak` 备份还原为当前文件,恢复覆盖前的用户版本 |

`--force`、`--update`、`--restore` 三者互斥(同时指定报错退出)。

交互模式下依次问答(按任务来源分流):
1. (未指定 `--workflow` 时)**任务来源**二选一:「只用飞书直连(回车默认)」→ 进入飞河流;「接 Jira」→ 追问变体三选一(`minimal` / `code-mr` / `grill-openspec`)→ 进入 Jira 流
2. (未指定 `--lang` 时)选择模板语言(`中文` / `English`,回车默认中文)
3. **飞河流**:Feishu app_id → Feishu app_secret(采完**当场连通验证**,失败人话报因并重输 secret,连续失败可跳过)→ 验证通过则**列机器人所在群编号帮选** intake 群(失败/为空回落手填 `oc_xxx`)→ 可选的常用项目名(回车跳过)+ 目录绝对路径(校验存在)
4. **Jira 流**:Jira REST API endpoint → Jira API token → 认证模式(basic/bearer) → Jira 用户名(仅 basic) → Jira 项目 key,随后可选的 Feishu Setup(启用评论桥则采集 `app_id`/`app_secret`/`intake_chat_id`/`create_issue_type`)

问答完成后:
- Jira 流用凭据连 Jira 测试连接(5s 超时),成功打印项目状态列表供参考
- 检查 `opencode` 是否安装(警告不阻断)
- Jira 变体检查 `glab` 是否安装(警告不阻断;缺失时打印 `brew install glab` 等安装命令,agent 侧可由 `install-glab` 技能自装);feishu-direct 跳过
- Jira 变体在 `GITLAB_TOKEN` 未设时打印 GitLab 凭据提示(环境变量或直接写 `env:` 配置段)
- **Feishu Setup**(Jira 流,可选):询问是否启用飞书评论桥;启用则采集 `app_id`/`app_secret`/`intake_chat_id`/`create_issue_type`(复用已发现的 issueTypes),写入 WORKFLOW.md `feishu:` 块(`app_secret` 直接明文写入;留空则保留 `$FEISHU_APP_SECRET` env 引用并打印提示)
- 按所选变体安装技能到 `.opencode/skills/`(已存在则跳过):`minimal`/`feishu-direct` 不装;`code-mr` 装 `land` + `install-glab`;`grill-openspec` 再加 4 个 opsx 技能
- 尝试打开编辑器(`$VISUAL` → `$EDITOR` → `code`)
- 生成物**按段裁剪**:只把必需段保持活配置(`tracker`、Jira 变体的 `hooks`/`env`、飞书启用时的 `feishu`),其余可选段整段注释、段首带「可选：以下为默认值，改动才解注释」提示;`router` 段与 feishu 的 `verification_token`/`encrypt_key` 标注为未实现/预留。交互与非交互两条路径产物一致(非交互不再逐字节复制模板)。注解文字随 `--lang` 本地化
-（接 Jira）连接测试后按项目状态**自动预填** `active_states`/`terminal_states`/`review_state`(打印提议并回车确认;拒绝或状态名无法完整映射则回落模板默认)
- 完成提示**按变体分级**:feishu-direct 直接打印"配置完成 + `tasking start` + `/chat <项目名> <消息>` 首句命令"(跳过项目问答时附"path 模式不限制目录"警告);Jira 变体列出仍需手动编辑的字段——状态预填成功时不再含状态三项,只留 `after_create`(MR 变体另含 `env.GITLAB_*`)

非交互模式按变体安装技能(`minimal`/`feishu-direct` 不装;`code-mr` 装 `land`+`install-glab`;`grill-openspec` 装 6 个),缺省变体为 `feishu-direct`,并打印飞书接入指引(指向 `docs/feishu-quickstart.md`)。

退出码:成功 `0`;`WORKFLOW.md` 已存在且未加 `--force` 时 `1`;未知 `--workflow` 或 `--lang` 值时 `1`。

#### 升级与回撤：`--update` / `--restore`

升级 `tasking`（`npm i -g @tothemax/tasking@new`）后，新版的技能与 WORKFLOW.md 模板/prompt body 改动不会自动流到用户环境。`tasking init --update` 提供非破坏性的补全路径：

1. **技能**（tasking 拥有，canonical 源 `assets/skills/`，随包发布）：全部 6 个技能同步到 `.opencode/skills/`——缺失即新装；与源字节一致的跳过；改过的先备份为同目录 `<file>.bak` 再覆盖，并打印警告与备份路径。
2. **WORKFLOW.md**（用户拥有）：**绝不写**，只打印漂移报告——缺失 config 字段清单（**漂移基线**＝对探测到的变体×语言走当前生成路径会写出的键集合，feishu 段形态镜像你文件里的 `feishu.enabled`；基线有你没有的键才算缺失，含默认值，按 YAML/JSON 渲染，如 `[]`；不加也能跑，缺失字段走 `DEFAULTS`；生成器按设计裁剪/省略的段与 zh 版的 `interface_language` 不计缺失）与 prompt body 的行级 diff，由人手动 reconcile 凭证/状态名/prompt body 改进。报告模板默认按用户 prompt body 标记四路探测（含 `<!-- tasking-workflow: feishu-direct -->` → `feishu-direct`；含 `## 🔍 拷问 / Grill Questions` → `grill-openspec`；含 `<!-- tasking-workflow: code-mr -->` → `code-mr`；否则 `minimal`），可用 `--workflow` 显式覆盖。模板**语言**同法探测：用户 WORKFLOW.md 含 `<!-- tasking-workflow-lang: en -->` 哨兵时对英文模板做漂移报告，否则对中文模板；可用 `--lang` 显式覆盖。探测/显式结果会在输出开头打印。存在任何漂移（基线下缺失字段或 prompt body diff）时，还会把完整新模板写到 `.tasking/WORKFLOW.md.reference`，并提示 `git diff --no-index WORKFLOW.md .tasking/WORKFLOW.md.reference`，让你用自己习惯的 diff 工具在完整上下文中核对每一处改动；下次 `--update` 无漂移时该引用文件会被自动删除。

`tasking init --restore` 回撤覆盖：若存在 `WORKFLOW.md.bak`（来自 `--force` 覆盖前的自动备份）则先将其还原为 `WORKFLOW.md`；再把 `.opencode/skills/**` 下的每个 `.bak` 还原为当前技能文件（无任何备份时提示并正常退出）。备份只保留最近一次覆盖前的版本。两个操作均无需交互输入，可用于脚本。

> **技能交付**：`tasking init` 从 `assets/skills/` 把技能装进 init 目录的 `.opencode/skills/`——`minimal`/`feishu-direct` 不装技能；`code-mr` 装 `land` + `install-glab`；`grill-openspec` 装 `land` + `install-glab` + 4 个 opsx 技能（`opsx-grill-with-docs`/`opsx-propose-with-tdd`/`opsx-implement`/`openspec-archive-change`，共 6 个）。用户在目标仓库（即 `after_create` 克隆的那个仓库）内跑 init，技能随克隆进入每个工作区；运行时 daemon 不每工作区拷贝。升级后用 `tasking init --update` 同步新版本技能与模板。

#### `feishu-direct` 变体

`feishu-direct`（**init 的默认变体**，裸 `tasking init` 即是）使用 `assets/workflows/WORKFLOW.feishu-direct.md.example` 模板:飞书直连专用部署(`tracker.kind: none`),无 Jira 调度与镜像,`/chat` 即任务面;init 交互跳过 Jira 问答(凭据当场验证 + 群帮选 + 可选项目问答);prompt body 仅为哨兵 + 两行用户说明(直连会话以用户消息为 prompt,想接 Jira 重跑 init)。

`feishu-direct`（**init 的默认变体**，裸 `tasking init` 即是）使用 `assets/workflows/WORKFLOW.feishu-direct.md.example` 模板:飞书直连专用部署(`tracker.kind: none`),无 Jira 调度与镜像,`/chat` 即任务面;init 交互跳过 Jira 问答(凭据当场验证 + 群帮选 + 可选项目问答);prompt body 仅为哨兵 + 两行用户说明(直连会话以用户消息为 prompt,想接 Jira 重跑 init)。

`--workflow grill-openspec` 使用 `assets/workflows/WORKFLOW.grill-openspec.md.example` 模板,四阶段路由:

1. **grill**(初始 active 态):跑 `opsx-grill-with-docs`,查代码定事实、起草 `CONTEXT.md`/`docs/adr/`,把待定决策合并成一条带标记头 `## 🔍 拷问 / Grill Questions` 的 Jira comment,转 review 态停。**不建 MR、不建 openspec change**。无疑问则直接进阶段 2。
2. 人答 comment 后移回 active → **实施**:跑 `opsx-propose-with-tdd` 建 openspec change,`opsx-implement` 实现,代码 + `openspec/changes/<name>/` 一起提交进 feature 分支,建 MR,转 review。
3. 人 review MR 后移到"合并中"语义 active 态 → **合并**:跑 `land` 合 MR,`openspec-archive-change` 归档,转 terminal → 调度器删工作区。

任何阶段遇 truly blocking 决策可发拷问 comment 转 review(运行中升级)。返工路径(增量修复/全量重置)**不重新 grill**,按现有 openspec change 重新 implement。

阶段路由全部在 prompt body 内由 agent 自判(产物为主 + 状态语义 + Jira comments/glab 兜底),不硬编码状态名,不改运行时代码。

> **技能交付**：`tasking init` 从 `assets/skills/` 把技能装进 init 目录的 `.opencode/skills/`——`minimal`/`feishu-direct` 不装技能；`code-mr` 装 `land` + `install-glab`；`grill-openspec` 装 `land` + `install-glab` + 4 个 opsx 技能（`opsx-grill-with-docs`/`opsx-propose-with-tdd`/`opsx-implement`/`openspec-archive-change`，共 6 个）。用户在目标仓库（即 `after_create` 克隆的那个仓库）内跑 init，技能随克隆进入每个工作区；运行时 daemon 不每工作区拷贝。已知限制见 `docs/known-issues.md`。

### `tasking start`

启动 daemon,加载工作流并开始轮询派发。

```bash
tasking start [workflow-path] [--port <n>] [--tui] [--detach] [--fresh]
```

| 参数/选项 | 说明 |
|-----------|------|
| `workflow-path` | `WORKFLOW.md` 路径,缺省为 `./WORKFLOW.md` |
| `--port` / `-p` | 启用 HTTP dashboard 并指定端口;`0` 请求临时端口 |
| `--tui` | 启用终端 TUI 状态面板(日志仅写文件,避免与 TUI 争抢 stderr) |
| `--detach` | 后台运行:父进程 spawn 子进程后退出,子进程脱离终端独立运行 |
| `--fresh` | 以「新机器方式」启动飞书桥:丢弃本地 intake 游标 + 按 Jira 现状对账过期 binding,不回放停机窗口内的历史消息(仅 `feishu.enabled` 时生效;切回旧机器继续运行时用) |

`--detach` 与 `--tui` 互斥。使用 `--detach` 后台启动后,可用 `tasking tui` 在另一终端附加 TUI 查看 daemon 指标。

退出码:
- `0`:正常启动并在收到信号时优雅关闭;`--detach` 时父进程 spawn 成功后退出。
- `1`:启动校验失败(如 `tracker.kind` 缺失、凭据缺失、`WORKFLOW.md` 不存在)。

收到 `SIGINT`(Ctrl+C)或 `SIGTERM` 时,daemon 会停止活动 worker 并以 `0` 退出。

### `tasking status`

通过 HTTP dashboard API 查询运行中 daemon 的实时状态,打印人类可读快照:运行中任务、retry 队列、聚合 token/运行时总量。

```bash
tasking status [--json]
```

| 选项 | 说明 |
|------|------|
| `--json` | 输出 API 原始 JSON,适合管道处理(`tasking status --json | jq .`) |

当 daemon 未配置 HTTP dashboard 端口时,回退到仅报告 PID 状态。当无 daemon 运行时返回非零退出码。

退出码:`0` daemon 运行中;`1` daemon 未运行或查询失败。

### `tasking logs`

打印近期结构化日志。日志文件路径按序解析:`.tasking/daemon.json` 中的 `log_path`(daemon 运行时记录,按 `logging.file.path` 配置或默认 `tasking.log`)优先,否则回退当前目录 `tasking.log`。

```bash
tasking logs [--lines <n>] [--follow] [--level debug|info|warn|error]
```

| 选项 | 说明 |
|------|------|
| `--lines` / `-n` | 打印最后 N 行,默认 100 |
| `--follow` / `-f` | 持续跟踪日志输出,收到 `SIGINT` 时退出 |
| `--level` | 按日志级别过滤,仅匹配 `level` 字段的 JSON 行(非 JSON 行始终保留) |

退出码:`0` 有日志;`1` 无日志文件。

### `tasking stop`

停止运行中的 daemon 进程。读取 `.tasking/daemon.json` 获取 PID,发送 `SIGTERM` 等待优雅退出(超时 10s 后发 `SIGKILL`),清理元信息文件。

```bash
tasking stop
```

退出码:`0` daemon 已停止;`1` daemon 未运行或元信息过期已清理。

### `tasking tui`

连接运行中 daemon 的 HTTP dashboard API,渲染终端 TUI 仪表板(与 `start --tui` 相同的界面)。退出 TUI 不影响 daemon 进程。

```bash
tasking tui [--port <n>]
```

| 选项 | 说明 |
|------|------|
| `--port` / `-p` | 手动指定连接的 dashboard 端口。解析优先级:`--port` → 当前目录 `.tasking/daemon.json` 的 `port` → 兜底 `8080`。指定时即使不在 daemon 启动目录、甚至无 `.tasking/daemon.json`,也可连接同一 host 上任意端口的 daemon;未指定时读 daemon.json 定位,都没有则探测 `8080`。host 取 daemon.json(若存在)否则 `127.0.0.1`。 |

TUI 显示:
- 汇总栏(agents/tps/runtime/tokens)
- 运行中任务表格(ID/STATE/AGE/TURN/TOKENS/SESSION/EVENT)
- 退避队列(标识符/attempt/倒计时/error)
- sparkline 吞吐量图(10 分钟趋势)
- 最近日志(最近 6 条,按 level 着色)

按 `c` 进入**配置视图**(`--port` 启动的 daemon 可用),查看当前运行的有效配置与运行时属性(workflow 路径、pid、启动时长、workspace 根、日志路径、host:port),`j`/`k` 滚动,`Esc`/`q` 返回。密钥(tracker.api_key、feishu.app_secret 等)统一脱敏显示 `****`;配置热重载后视图实时反映。

选中一个运行中任务按 `Enter` 进入**任务详情**,显示 workspace、session、当前 `Agent`/`Model`/`Variant`、turn、tokens 等;详情页展示任务 **Description**(默认折叠,最多显示 6 个折行行,超出显示 `… (N more lines)` 标记,按 `e` 展开/收起);在详情页按 `a` 进入**活动视图**,近实时查看该任务 opencode 的交互流——助手文本、工具调用、step token 增量,头部显示 model/agent/variant。工具调用在列表中显示一行友好摘要 `🔧 <工具> · <命令/文件>`,失败命令(退出码非 0)以红色 `✗` 标记;`↑`/`↓`/`j`/`k` 移动选中事件,`Space`/`f` 暂停跟随,`Enter` 打开选中事件的**浮层**——`text` 事件显示完整文本(超长文本按终端宽度感知换行、正确渲染中文),`tool_use` 事件显示结构化执行详情(状态与退出码、命令/参数、stdout 输出、耗时;超长输出只显示末尾 100 行并标记截断),浮层内可 `↑`/`↓` 滚动查看,`Esc`/`q` 返回列表、再按 `Esc`/`q` 返回详情。活动数据来自 daemon 内存环形缓冲(每 task 上限 500 事件),worker 退出后清除。任务级 token 在 turn 内随 step_finish 实时累计,并持久化在 workspace 的 `.tasking-session.json`(跨 daemon 重启/重试保留会话累计值)。

按 `q` 或 `Ctrl+C` 退出 TUI,daemon 继续运行。

进入 TUI 前会探测一次 `/api/v1/state` 连通性。退出码:`0` 正常退出;`1` 解析端口不可达或 `--port` 非数值(报错含解析端口与 `--port` 覆盖提示)。

### `tasking doctor`

全链路只读体检:一次命令报全部问题。按序检查(全部只读、秒级):

1. **WORKFLOW.md 解析** — front matter 能否解析、tracker 是什么;
2. **飞书**(仅 `feishu.enabled: true`)— 凭据换 token → 三个 scope 探针(列群/读群消息/传文件)→ intake 群可达(机器人所在群列表含 `intake_chat_id`);
3. **Jira**(仅 `tracker.kind: jira`)— 连接测试(同 init 的 Connection Test 逻辑,只取 serverInfo)+ **Jira MCP 脚本**存在性(缺失报 ✗ 并提示 `npm run build`,否则任务 agent 拿不到 Jira 工具);
4. **opencode** — 是否在 `PATH`。

```bash
tasking doctor [workflow-path]
```

中文输出,逐项 `✓/✗/−/·` 与补救提示,末尾汇总表。退出码:`0` 全部通过;`1` 任一失败(可脚本化,换机/重装后自检一跑便知)。位置参数 `[workflow-path]` 缺省 `./WORKFLOW.md`,与 `start`/`init` 语义一致(传目录视为错误),且 `.env` 从该文件所在目录加载;不执行任何写操作;scope 缺失的补救指引(控制台深链等)见[飞书应用开通](./feishu-app-setup.md)。`tasking init` 的飞书采集流程内嵌同款体检(凭据验证通过后自动跑,缺权限只警告不阻断),doctor 用于事后随时复检。

## 凭据配置

### 切换界面语言

tasking 自产的界面文案(飞书回复/toast/卡片、CLI 输出、TUI)支持中英双语,由 WORKFLOW.md 顶层字段控制:

```yaml
interface_language: en   # zh(默认)| en;用户消息与 agent 输出不受影响
```

改完保存即生效(热重载,无需重启)。`tasking init --lang en` 会在生成配置时写入该字段;`tasking doctor`、`tasking tui` 的界面语言同样跟随此配置。

### Jira(结构化源)

Jira 适配器使用 Cloud REST v3 API 与 Basic auth(email + API token):

```yaml
tracker:
  kind: jira
  endpoint: https://your-domain.atlassian.net/rest/api/3
  api_key: $JIRA_API_TOKEN      # 推荐:用环境变量
  api_user: you@example.com      # Basic auth 的 username
  project_key: ENG               # 必需:Jira 项目 key
```

获取 API token:Jira → 账号设置 → 安全 → 创建和管理 API token。

`api_key` 支持直接写值或 `$VAR_NAME` 间接引用。`$VAR` 解析为空字符串时视为缺失,会触发校验错误。

### 飞书 ↔ Jira 评论桥

> 手把手接入（建应用/授权/拉群/取 chat_id/验证清单）见 [飞书接入 quickstart](./feishu-quickstart.md)。

飞书作为已存在 Jira issue 的评论同步镜像：飞书话题 1:1 绑定 Jira issue，双向镜像评论——agent 写的 Jira 评论转发到飞书话题通知人；人在飞书话题发的消息桥成 Jira 评论供 agent 读。人只在飞书、agent 只认 Jira，runtime/agent 不动（ADR 0002）。

**setup 前置：**

1. 飞书开放平台创建自建应用，开启机器人能力，授权 scope：`im:message.group_msg`（应用级读群消息，无替代）、`im:message`（发消息与读内容）、`im:chat`（列群/建群）、`im:resource`（传文件，缺失降级纯文本）。
2. 把机器人加进一个指定群（intake 群）——所有 issue 线程都在这个群里，每条 `/issue` 成一个话题。
3. 取该群 `chat_id`（`GET /im/v1/chats` 列机器人所在群）。

```yaml
feishu:
  enabled: true
  app_id: $FEISHU_APP_ID
  app_secret: $FEISHU_APP_SECRET
  intake_chat_id: oc_xxxxxxxxxxxxxxxx   # 上面那个群的 chat_id
  forward_interval_ms: 5000            # Jira→飞书评论镜像节奏，默认 5s
  sweep_interval_ms: 43200000          # Sweep 兜底清扫节奏（丢失补拉），默认 12h
  create_issue_type: Task              # /issue 默认 issueType，init 时列出项目可用 type
```

`enabled: false`（默认）不启用。启用但缺 `app_id`/`app_secret`/`intake_chat_id`/`create_issue_type` 启动校验失败。

**入站走事件通道，无公网端口**：收消息经官方 SDK 的 WS 长连接（`im.message.receive_v1`）实时推送，不计量、不暴露公网端口、不收 webhook（[ADR 0018](../adr/0018-event-driven-feishu-ingress.md)，取代原 REST 轮询 [ADR 0003](../adr/0003-rest-poll-feishu-ingress.md)）。轮询保留为 Sweep 兜底清扫：启动时、WS 重连时、`sweep_interval_ms`（默认 12h）各补拉一次，覆盖断线/停机窗口。飞书→Jira 秒级；Jira→飞书镜像 ≤ `forward_interval_ms`。需一次性在开发者后台配置事件订阅（见 feishu-quickstart 8.1），且同一应用只允许单实例在线。

**命令**（在 intake 群或已绑话题内发）：

- `/issue <title>` + 可选第 2 行起 `<description>`：建 Jira issue（title→summary、desc→description 字段；描述可省略——仅标题的 `/issue` 也会建 issue，description 为空；project/assignee/labels 锁定复用 tracker 配置保证被拾起；type 默认 `create_issue_type`，可 `--type <name|N>` 覆盖；可 `--agent <name>` 在创建时打 `agent:<name>` 标签指定该任务使用的 agent）。`/issue` 无参列出项目可用 issueType + 默认。该命令消息即话题根。多行描述按 API 版本正确落库（v2 字符串 / v3 ADF 段落），不额外写首条 comment（ADR 0009）。
- `/chat <project> <msg>` / `/chat /绝对路径 <msg>`：在固定目录创建 opencode 直连会话（仅 intake 群；需配置 `feishu.direct`，见下）。命令消息即话题根，首条消息为首 turn prompt；此后**直接回复该话题即续聊**（运行中追问自动排队并合并续跑），话题内 `/stop` 中断当前任务、`/done` 结束会话（并删除底层 opencode 会话，与空闲 TTL 过期一致）。每 turn 回一条完成文本；过程展示量级可配 `feishu.direct.verbosity`：`quiet`（仅正文）/ `summary`（正文+统计行）/ `detailed`（默认，为每个 turn 发一张**过程卡片**：工具调用的折叠面板、失败默认展开、头部件显示会话名/状态/累计 token，面板组件需飞书/Lark 客户端 >= V7.9，更低版本显示「请升级」占位符、可显式改回 `summary`；turn 结束时该卡被封存为纯记录，下一轮另发一张，并另发一张 **markdown 结果卡片**承载完整回答——`summary`/`quiet` 下结果仍是纯文本）。一个话题严格对应一个 opencode session，daemon 重启后从 `direct_sessions` 表恢复。`tasking stop`/Ctrl-C 会立即中止在飞的直连轮次（SIGKILL 子进程树，话题内卡片盖「已中断」章、排队中的消息丢弃）；进程被强杀（`kill -9`）来不及中止时，重启后由恢复逻辑兜底（会话标 idle 并在话题里提示重发）。活跃直连会话在 TUI 中以独立的 **Direct sessions** 区块展示，含会话名称（首条 prompt）、状态、空闲时长、token 与排队数，标题含活跃会话数 `(N)`（有 turn 在跑时 `(N · R running)`）（`←/→`/Tab 切换焦点；`Enter` 进入直连详情，`a` 复用 activity 视图；直连 token 计入首页 `Tokens:` 总额），不影响 Jira 的 running/retry 列表。直连列表或直连详情页按 `d` 可**删除会话**(两段确认:再按一次 `d` 执行,任意其他键取消;确认文案显示会话标题)——完整走 `/done` 收尾:标记 done、中断在飞轮次、封存卡片、话题内发结束通知、删除底层 opencode 会话并清运行时,话题已找不到时通知静默跳过。直连与 Jira 路径互不影响。
  - **轮次完成消息的构成**：它不是提示词约束、也不是二次 LLM 摘要 —— tasking 从轮询到的会话消息机械组装：正文 = 本 turn 最后一条 assistant 文本消息（模型对你消息的自然回复，你的消息即 prompt，无额外模板）；末行统计（`⏱ 耗时 · 🔧 工具调用数 · ≈tokens`）来自工具条目计数、消息 token 与计时（合计口径 = input+output+reasoning，见 ADR 0037）；超 3500 字截断。失败/超时的提示文案由 tasking 生成。
- `/chat`：列出已配置项目 + path 模式用法。
- **直连富输入**：话题内直接发**图片/文件**（含"文字+截图"的 post 富文本）→ 下载到工作区 inbox 目录（`<workspace.root>/direct-inbox/`，单附件 ≤20MB，超限/失败会提示）并把绝对路径交给 agent——日志/CSV/代码立即有用，截图取决于模型是否具备视觉。**合并转发**消息按既有解析处理；"转发+留言"会拆成两条消息（各成一轮），需要一轮处理时先用 `/collect` 攒齐再 `/send`。
- **直连会话内命令**：`/auto [on|once|off]`（查看/切换本会话权限姿态，经会话级 ruleset **立即生效**）、`/agent <name>`、`/model <name>`（切换本会话 agent/model，`reset` 恢复配置默认）、`/collect` → `/send`（多消息收集：把多条消息（含图片/文件）合并为**一轮**提交；`/cancel` 丢弃；10 分钟无新消息自动提交；缓冲在内存，重启丢失）、`/name <文本>`（给本会话改名，用于卡片头部与 TUI；无参数回显当前名）、`/new`（清空上下文开新会话，并删除被放弃的旧 opencode 会话）、`/status`（回一张会话状态卡）、`/stop`、`/done`、`/help`。信息类命令（`/help`、`/auto` 查看、`/collect` 状态、`/agent`/`/model` 查看）以**卡片**回复，其中 `/auto` 与 `/collect` 状态卡自带操作按钮（权限开合、开始/提交/丢弃收集），点击即执行并就地刷新该卡；卡片不可用时回落纯文本。转瞬即逝的回执（如 `📥 已收集 N 条`、附件失败告警、未知命令提示）保持纯文本。这些覆盖只作用于**本会话**，不写 WORKFLOW.md、不碰目标仓库 `.opencode`；权限姿态经 `session.update` 即时生效。每轮启动都会在 `tasking.log` 记一行 `direct turn starting`（含 `dir`/`agent`/`model`/`auto_approve`/`session_id`/`poll_interval_ms`），便于逐轮核对实际传了什么。
- **直连会话的卡片操作**（`verbosity: detailed`）：轮次卡片底部提供 `⏹ 中断`（仅运行中的轮）、`🔁 重试`（重跑最近一轮的 prompt）、`📄 完整输出`（把最近一轮的工具完整明细作为 `.md` 文件发到话题；上传不可用时降级为长文本，仍装不下则提示去 TUI 活动视图）、`🔐 权限`（确认行里可选「本会话放开 / 仅下一轮 / 取消」；已放开时同按钮立即收回；卡片头始终显示 `🔓 auto` / `⚡ 下轮放开` / `🧠 <agent>`）、`🛑 结束`（两步确认后结束并删除底层 opencode 会话；确认时卡片其余内容保留）。按钮与斜杠命令并存，群成员皆可操作。生命周期消息里的操作人显示为**群成员显示名**（从 intake 群成员表解析并缓存；解析失败回落 open_id）。卡片不可用时该轮过程降级为合并文本消息。
- **同步权限审批**（0.7 新增）：当目标目录的 `.opencode` 配置把某类操作设为 `ask`、且未放开权限姿态时，agent 执行到该操作会**挂起等待**，tasking 在会话话题投放**审批卡**（`✅ 允许一次` / `♾️ 始终允许` / `✖ 拒绝`），点击即经 `session.permission.reply` 当场续跑；「始终允许」由 opencode 服务端按命令模式保存（机器级，跨会话生效）。等待预算默认 30 分钟（`opencode.permission_timeout_ms`），到点自动拒绝并盖章；卡片在回复/超时/中断后原位盖章保留。Jira 任务的审批卡投放其绑定话题（`auto_approve: false` 时生效，见 [配置](./configuration.md)）。
- **一次性控制台配置**（`detailed` 的完整能力需要）：① 开通 `im:resource` 权限（供 `📄` 文件上传）；② 在「事件与回调」添加 `card.action.trigger` 回调（订阅方式=长连接，供按钮）。两者可在同一次「创建版本 → 发布」里完成；未配置时卡片仍可发送与更新，`📄` 降级为文本。
- **人工验收**（按钮点击无法自动化）：`verbosity: detailed` 下发一条 `/chat`，依次点 `⏹ 中断`、`🔁 重试`、`📄 完整输出`、`🔐 权限`（确认行）、`🛑 结束`（两步确认），确认卡片状态、完成文本与操作人信息符合预期。
- `/state`：在已绑话题内发，以**召回式**回一张**任务状态卡**（issue key + 当前状态 + 负责人，附 `🔀 转状态`、`🔄 刷新`（按实时状态原地换卡）与 `打开 Jira` 按钮）：每次发布都会先删除旧状态卡、再在话题底部发新卡，卡不会因消息堆积而找不到（再发一次 `/state` 即可拉回眼前）。点 `🔀` 会**实时**拉取当前可用转换并逐个渲染为按钮，选中后进入确认行（确认/取消），确认才写 Jira，转完即时 nudge scheduler 并刷新状态卡、在话题内广播结果（取消不产生写操作）。`/state <N|name>` 文本转状态仍然可用，与卡片按钮共用同一份转换逻辑（运行时查 Jira，不硬编码状态名）。
- `/agent`：查默认 agent（`opencode.agent`）+ 已配置目录（`opencode.agents`，空则提示未配置）；在已绑话题内还显示该任务当前解析出的 agent。`/agent <name>` 在话题内切换该任务的 agent（改 `agent:<name>` 标签，**下一 turn 边界生效**，当前 turn 不中断）；`/agent default` 清除 agent 标签回退默认。intake 群内 `/agent <name>` 提示需在话题内使用。详见 ADR 0011。
- `/help`、`/agent` 列表：以**卡片**回复（卡片不可用时回落纯文本）。
- **非命令自由文本**（intake 群根消息）：回"已收到"类回执（含 `/issue`、`/help` 提示），不进 Jira、不建 binding。**绑定话题内**的自由文本桥成 Jira 评论，并按 Jira 侧呈现为**卡片**（作者头 + 正文；另附 `打开 Jira` 与 `📋 状态`——点击在话题底部召唤一张实时状态卡；正文超 24KB 被截断时才出现 `📄 完整输出`，点击把全文作为 `.md` 文件发到话题）。桥接成功回"✅ 已收到，已同步到 {issue_key}"（该条消息下 `reply_in_thread`），写入失败（非 404）回"⚠️ 同步失败，请稍后重试"；回执由 bot 发出、下一轮轮询自动跳过，不回投、不重桥。

**去重**：桥过去的 Jira comment 带可见 sentinel `💬 {sender} via 飞书 [msg:{id}]:`（兼归属），转发器据此跳过不回投（tasking 与 agent 共享 Jira 账号、无法按作者区分，ADR 0004）。人直接在 Jira 发的评论（无 sentinel）会转发到飞书保完整性。terminal 时发"✅ 已完结"ack + 停同步，reopen 续同一话题。消息语义 v1 覆盖 `text` 与 `post`（富文本拍平为纯文本，多行 `/issue`/话题自由文本可用）；图片/编辑/删除同步 deferred。

## 工作区与 hooks

### 工作区路径

每个任务获得独立工作区,路径为 `<workspace.root>/<sanitized_identifier>`。标识符中非 `[A-Za-z0-9._-]` 的字符会被替换为 `_`。

```yaml
workspace:
  root: ~/tasking_workspaces   # 支持 ~ 与 $VAR
```

默认根目录为 `<系统临时目录>/tasking_workspaces`。相对路径解析为相对于 `WORKFLOW.md` 所在目录。

### 生命周期 hooks

`WORKFLOW.md` 可配置四个 hook:

| hook | 触发时机 | 失败语义 |
|------|----------|----------|
| `after_create` | 仅在新创建工作区目录时 | 失败中止工作区创建 |
| `before_run` | 每次 attempt 前 | 失败中止当前 attempt |
| `after_run` | 每次 attempt 后 | 失败仅记录,不影响结果 |
| `before_remove` | 删除工作区前 | 失败仅记录,继续删除 |

hook 以 `bash -lc` 在工作区目录(cwd)中执行,受 `hooks.timeout_ms`(默认 60000ms)约束。

```yaml
hooks:
  timeout_ms: 60000
  after_create: |
    echo "workspace created"
    # 可在此 clone 代码、安装依赖等
  before_run: |
    echo "preparing run"
```

## 技能系统

tasking 支持 opencode 技能文件（`.opencode/skills/<name>/SKILL.md`），为 agent 提供结构化的操作指引。技能文件预放在开发仓库中，随 `after_create` hook 的 `git clone` 进入 workspace，无需 tasking 注入。

### 内置技能模板

tasking 仓库的 `assets/skills/` 目录提供 7 个参考技能模板，可复制到自己的开发仓库：

| 技能 | 用途 | 前置条件 |
|------|------|---------|
| `commit` | 规范化 git commit（类型前缀、imperative subject、72 列 body） | git |
| `pull` | merge origin/main 到特性分支 + 冲突解决 | git |
| `push` | push 分支 + 创建/更新 GitLab MR | `glab` CLI |
| `debug` | tasking 日志关联追踪 | `tasking.log` |
| `land` | GitLab MR 落地（CI 监控 + review + squash-merge） | `glab` CLI + Python 3 |
| `install-glab` | 幂等自装 `glab`（releases API 下载到 `~/.local/bin`，或 brew/snap/scoop） | 网络 |
| `jira` | Jira 交互（transitions、评论、附件、标签） | `jira_rest` + `jira_upload_attachment` MCP 工具 |

### 使用方式

1. 将 `assets/skills/` 下的技能复制到开发仓库的 `.opencode/skills/` 目录
2. 根据仓库需求定制技能内容
3. 确保 `after_create` hook 执行 `git clone`（默认配置已包含）
4. WORKFLOW.md 的 prompt body 引用全部 7 个技能（pull/commit/push/debug/land/install-glab/jira）

### glab CLI 前置条件

`push` 和 `land` 技能需要 `glab` CLI 可用：

```bash
# 验证 glab 已安装并认证
glab auth status

# 缺失时两种途径：
# 1) agent 侧：在目标仓库工作区运行 install-glab 技能（tasking init 已装入 .opencode/skills/）
# 2) 手动：brew install glab / snap install glab / scoop install glab
#    或下载官方二进制: https://gitlab.com/gitlab-org/cli/-/releases
```

## Prompt 模板

`WORKFLOW.md` 的 prompt body(front matter 之后的正文)是 per-task 的 prompt 模板,使用严格 Liquid 兼容语法渲染。

### 变量

| 变量 | 类型 | 说明 |
|------|------|------|
| `task` | 对象 | 归一化任务实体,含 `identifier`、`title`、`description`、`priority`、`state`、`labels`、`blocked_by` 等字段 |
| `issue` | 对象 | `task` 的别名,等价 |
| `attempt` | 整数或 null | 首次为 `null`;重试/续轮为整数 |

### 标签

支持 `if`/`else`/`endif` 条件块:

```liquid
{% if task.description %}
描述:
{{ task.description }}
{% else %}
无描述
{% endif %}

{% if attempt %}
这是第 {{ attempt }} 次尝试。
{% else %}
这是首次尝试。
{% endif %}
```

### 过滤器

支持 `upcase`、`downcase`、`trim` 等过滤器。未知过滤器会导致渲染失败。

### 严格模式

- 未知变量 → 渲染失败,attempt 失败。
- 未知过滤器 → 渲染失败,attempt 失败。
- prompt body 为空时,回退为默认 prompt(`You are working on an issue from the tracker.`)。
- `WORKFLOW.md` 文件读取/解析错误不会回退,而是阻止启动。

## 典型场景示例

### 场景一:仅 Jira 结构化

最小配置,只派发 Jira 任务:

```yaml
---
tracker:
  kind: jira
  endpoint: https://example.atlassian.net/rest/api/3
  api_key: $JIRA_API_TOKEN
  api_user: you@example.com
  project_key: ENG
  active_states:
     - 待办
     - 处理中
     - 合并中
     - 重置处理
   terminal_states:
     - 完成
     - 关闭
polling:
  interval_ms: 30000
agent:
  max_concurrent_agents: 5
opencode:
  command: opencode
  agent: build
---
你正在处理一个 Jira 任务:{{ task.identifier }}

{{ task.title }}
```

### 场景二:Jira + 飞书双源

同时启用结构化派发与飞书评论桥:

```yaml
---
tracker:
  kind: jira
  api_key: $JIRA_API_TOKEN
  api_user: you@example.com
  project_key: ENG
feishu:
  enabled: true
  app_id: $FEISHU_APP_ID
  app_secret: $FEISHU_APP_SECRET
  intake_chat_id: oc_xxx
  create_issue_type: Task
---
处理任务 {{ task.identifier }}:{{ task.title }}
```

Jira issue 由 scheduler 派发；飞书话题 1:1 绑定 issue 双向镜像评论。人在飞书 `/issue` 建的 issue 同样进 scheduler 派发。

### 场景三:启用 HTTP dashboard

```bash
tasking start --port 8080
```

或配置:

```yaml
server:
  port: 8080
```

启动后访问:
- `http://<host>:8080/`:人类可读 dashboard。
- `http://<host>:8080/api/v1/state`:JSON 运行时状态快照。
- `http://<host>:8080/api/v1/<issue_identifier>`:单 issue 运行详情(workspace 路径、retry 状态、tokens、agent/model/variant)。
- `http://<host>:8080/api/v1/<issue_identifier>/activity?limit=N`:运行中任务的 opencode 活动事件流(助手文本/工具调用/tokens,近实时;`tool_use` 事件含工具执行详情字段 `title`/`input`/`output`/`exit`/`status`/`durationMs`/`truncated`)。
- `http://<host>:8080/api/v1/refresh`:触发一次轮询 + 对账(POST,返回 `202`)。

`--port` 覆盖 `server.port` 配置。`server.host` 控制绑定地址(默认 `0.0.0.0`)。不支持的方法返回 `405`。dashboard 不参与正确性,关闭后编排仍正常运行。

### 场景三b:启用终端 TUI 状态面板

```bash
# 方式一:前台启动 + TUI
tasking start --tui

# 方式二:后台启动,再附加 TUI
tasking start --detach
tasking tui
```

TUI 在 stderr 上渲染 ANSI 彩色状态画面:
- 汇总栏(agents/tps/runtime/tokens)
- 运行中任务表格(ID/STATE/AGE/TURN/TOKENS/SESSION/EVENT)
- 退避队列(标识符/attempt/倒计时/error)
- sparkline 吞吐量图(10 分钟趋势)
- 最近日志(最近 6 条,按 level 着色)

TUI 启用时,日志仅写文件(`tasking.log`),不写 stderr。

### 场景四:上传附件到 Jira 任务

agent 在完成任务后,可通过 `jira_upload_attachment` 工具将产出文件(截图、日志、测试报告等)上传到 Jira 任务。该工具由 `tasking` 的 MCP server 提供,复用 WORKFLOW.md 中已配的 tracker 凭据。

调用示例:

```
jira_upload_attachment({ issue_key: "OS-262", filename: "screenshot.png", content: "<base64>" })
```

`content` 参数为文件的 base64 编码字符串。agent 可用以下方式生成:

```javascript
const fs = require("fs");
const content = fs.readFileSync("path/to/file").toString("base64");
```

附件大小限制为 10MB(base64 编码后),超出会被拒绝。该步骤为可选的——仅在存在产出文件时执行,WORKFLOW.md starter 模板中已引用 `jira` 技能完成此步骤。完整使用指南见 `jira` 技能（`assets/skills/jira/SKILL.md`）。

### 场景五:多 agent per-task 路由

`opencode.agent`（默认 `build`）始终是兜底；可选 `opencode.agents` 目录列出已知 profile 供 `/agent` 命令展示。per-task agent 由 Jira `agent:<name>` 标签指定——worker 每 turn 从刷新后的 Task 重新解析,无标签则用默认,未知名(不在非空目录)警告并回退默认,不阻止派发。

```yaml
opencode:
  command: opencode
  agent: build              # 兜底默认
  agents: [build, review]   # 咨询性目录(可选,空则不校验)
```

三种设定/切换途径,全操作同一 `agent:<name>` 标签(单一事实源):

- **创建时指定**:`/issue --agent review 标题\n描述` → 建 issue 时打 `agent:review` 标签。
- **Jira 直接编辑**:给 issue 加 `agent:review` 标签,下个 tick 派发时生效。
- **运行中切换**:在该 issue 的飞书话题内 `/agent review` → 改标签,**下一 turn 边界生效**(当前 turn 跑完,worker 从刷新 Task 重新解析 agent)。`/agent default` 清除标签回退默认。

`/agent`(无参)在任何地方发都列出默认 + 目录;在已绑话题内还显示该任务当前 agent。详见 ADR 0011。
