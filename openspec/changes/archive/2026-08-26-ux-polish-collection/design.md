## Context

tasking 已具备结构化(Jira)+ 飞书评论桥双源。五个用户反馈点都是 UX/引导层：`CommentBridge.discoverIntake` 对非命令根消息静默跳过；`executeIssue` 只把 desc 写 `description` 字段、`/issue` 根消息从不入 comments；`tasking init` 只收 Jira 凭证；`tasking tui` 无 `--port` 时强依赖 `.tasking/daemon.json`；workflow 假设 glab 已装。均不触及 scheduler/worker/runtime 正确性（延续 ADR 0001 边界）。

约束：Jira v2（自托管，本环境 `/rest/api/2`）与 v3（Cloud）都需支持；飞书入站是 REST 轮询（无公网端口）；sentinel 机制（ADR 0004）是防环的唯一手段；`init` 有交互/非交互两条路径；技能经 `tasking init` 复制进目标仓库、daemon 不复制。

## Goals / Non-Goals

**Goals:**
- 飞书非命令根消息有友好回执，且不进 Jira、不建 binding。
- `/issue` 的标题+多行描述完整、可读地落到新 Jira issue（首条 comment + 正确 description），v2/v3 皆可。
- init 交互模式可一站式配置飞书桥；非交互模式给出指引。
- `tasking tui` 端口解析 `--port` → `.tasking/daemon.json` → `8080`，不可达给友好报错。
- glab 缺失时 agent 可自装（技能），init 前置检查给出一行安装命令。

**Non-Goals:**
- 飞书消息进 inbox/triage/route-agent（该能力已被评论桥取代）。
- 双向评论桥的同步逻辑、binding/游标、`/state`/`/help` 命令语义不改。
- glab 之外的第三方工具自装。
- `tasking status`/`stop` 的端口兜底（仅 tui 在范围内）。

## Decisions

### D1: 回执只对 intake 群根消息，线程消息不回执
非命令回执放在 `CommentBridge.discoverIntake`（`parseIssue` 返回 null 且 `!isCommand` 时 `replyFlat(msgId, ...)`）。绑定话题内的人消息走 `bridgeMessages` 桥成 Jira comment，属于双向镜像，回执会造成噪音与环路，故不回执。回执文本 `已收到 ✓（/issue 创建任务，/help 看用法）`。游标照常推进。
> 备选：对未知 `/` 命令与自由文本统一回执 —— 未知命令已有"未知命令，/help 看用法"，保持现状即可。

### D2: /issue 首条 comment 复用 sentinel，防环成立
`executeIssue` 在 createIssue + binding 写入后，用 `buildBridgedCommentBody(sender ?? "用户", 完整原始消息)` 把 `/issue` 消息作为首条 comment POST 到新 issue。sentinel（`via 飞书`）使 `forwardComments` 跳过、不回投飞书，避免环；也保证 Jira→飞书方向不把用户原文再广播一次。`discoverIntake` 需把 `sender_name` 传入 `executeIssue`。
> 备选：不用 sentinel 而用普通文本 —— 会被 Jira→飞书转发器当作人直发评论转发回飞书话题，产生重复。否决。

### D3: description 按 API 版本封装
新增 `wrapDescription(text, isV3)`（`tracker.ts`）：v3 生成 ADF doc，按换行拆成段落节点（保证每行独立成段、不依赖 ADF text 节点内换行的不可靠渲染）；v2 直接返回字符串（wiki 文本原生支持换行）。`executeIssue` 构造 fields 时据此封装。现有 `wrapCommentBody`（v3 comment）保留但仅用于单段文本，首条 comment 也用其包裹。
> 备选：v3 也发纯字符串 description —— Cloud v3 对纯字符串换行渲染不稳定，统一 ADF 更可靠。

### D4: tui 端口解析为参数 > daemon.json > 8080
`runTui`：`--port` 有值直接用；否则读 `.tasking/daemon.json`（当前目录）取 `port`；都没有则兜底 `8080`。host 取 daemon.json（若存在）否则 `127.0.0.1`。移除"无 daemon.json 即报错"的硬门（pid 存活检查删除），以进入 TUI 前的 `/api/v1/state` 探测为准；不可达打印 resolved port + 提示 `--port` 覆盖。既有 `--port` 不可达/非数值报错保持。
> 备选：向父目录/home 逐级找 daemon.json —— 超出反馈范围，保持当前目录即可。

### D5: glab 自装走"技能"，init 只提示
新增 `assets/skills/install-glab/SKILL.md`：先 `command -v glab`，缺失则经 GitLab releases API 下官方 linux/macOS 二进制到 `~/.local/bin`（幂等），或提示 `brew`/`snap`/`scoop`。`tasking init` 把该技能与 `land` 一起装进目标仓库 `.opencode/skills/`（两个 workflow 都装）；`printPrerequisites` 在 glab 缺失时打印该技能路径 + 一行安装命令。两个 example 的 Skills 列表加一行引用。
> 备选：init/安装期程序化装 glab —— 平台相关、需交互确认、失败路径多；技能方式由 agent 按需执行更稳。否决（feedback Q2 推荐项）。

### D6: init Feishu Setup 交互采集 + 模板替换
交互模式在 Jira 段后新增 `collectFeishuConfig`：问是否启用桥；启用则采集 app_id / app_secret / intake_chat_id，issueType 复用 `testJiraConnection` 已取的列表做选择（默认 `create_issue_type` 模板值）。`generateWorkflowContent` 增加 feishu 段定向替换：`app_id: $FEISHU_APP_ID`→值、`intake_chat_id: $FEISHU_INTAKE_CHAT_ID`→值、`create_issue_type`→所选、feishu 块 `enabled: false`→`true`；app_secret 保留 `$FEISHU_APP_SECRET` env 引用（与 `api_key: $JIRA_API_KEY` 一致），提示用户 export。非交互模式写模板后打印 `docs/feishu-quickstart.md` 指引。
> 备选：feishu 段也交互到字段级逐个填空 —— 与 Jira 的"env 引用 + export 提示"模式保持一致，减少明文 secret 落盘。

## Risks / Trade-offs

- [回执文本固定，将来想自定义] → 文本收敛到 `commands.ts` 常量，改一处即可。
- [首条 comment 与 `/state` 之前人已评论的场景顺序] → 首条 comment 在建 issue 后紧接写入，人评论一定在其后，sentinel 保证不转发。
- [glab releases API 断网/域名不通时技能失败] → 技能降级打印包管理器安装命令，agent 可转人工；init 侧本就只提示不强制。
- [v3 ADF 封装丢失 markdown 语义（纯文本段落）] → 与现有 comment ADF 一致，v1 纯文本范围可接受。
