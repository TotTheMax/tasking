## Why

tasking 的日常使用在 5 个点不够友好：飞书收到非命令消息静默无回执；`/issue` 多行描述进不了 Jira comments；`tasking init` 对飞书接入零引导；`tasking tui` 找不到 daemon 元信息时直接报错而非兜底常见端口；workflow 依赖 glab 但 agent 无自装途径。全部为低风险 UX/引导优化，不改 scheduler/worker/runtime 正确性。

## What Changes

- 飞书 intake 群内非命令根消息回复友好回执 `已收到`（含 `/issue`、`/help` 提示），不进 Jira、不建 binding、照常推进游标。
- `/issue` 建 issue 后把原始消息（标题 + 多行描述）作为该 issue 的**第一条 comment** 写入并打上飞书 sentinel（转发器按 sentinel 跳过，不回投、不产生 agent 转发噪音）；同时把 `description` 多行按 API 版本正确落库（v2 纯文本字符串；v3 转 ADF 段落）。
- `tasking init` 交互模式新增 **Feishu Setup** 段：询问是否启用桥，启用则采集 app_id / app_secret / intake_chat_id / create_issue_type（复用已发现的 issueTypes），写入生成 WORKFLOW.md 的 `feishu:` 块（app_secret 用 `$FEISHU_APP_SECRET` env 引用）；非交互模式打印指向 `docs/feishu-quickstart.md` 的提示。
- `tasking tui` 端口解析优先级：`--port` 参数 → 当前目录 `.tasking/daemon.json` 的 port → 兜底 `8080`；始终探测端点，不通给友好报错并提示 `--port` 覆盖。
- 新增 `install-glab` 技能：`tasking init` 一并装进目标仓库 `.opencode/skills/`，grill-openspec/default prompt body 加"glab 缺失时先跑 install-glab"；技能内检测 `which glab`，缺失时用 GitLab releases API 下载官方 linux/macOS 二进制到 `~/.local/bin`（幂等）。`init` 前置检查在 glab 缺失时打印安装一行命令。

## Capabilities

### New Capabilities

- `install-glab-skill`: `install-glab` 技能本体（幂等自装 glab 到用户目录）+ 目标仓库安装与 prompt 引用。

### Modified Capabilities

- `feishu-source`: 新增 intake 非命令根消息回执；`/issue` 建 issue 后首条 comment + 多行描述按 API 版本正确落库。
- `interactive-init`: 新增 Feishu Setup 引导段（采集并写入 feishu 块）；glab 缺失时打印安装一行命令。
- `cli-runtime`: `tasking tui` 端口解析改为 `--port` → `.tasking/daemon.json` → `8080` 兜底。

## Impact

- 改：`src/bridge/comment-bridge.ts`（intake 回执、/issue 首条 comment）、`src/bridge/commands.ts`（sentinel 复用、构建首条 comment body）、`src/adapters/jira/tracker.ts`（v3 ADF 多行 description 辅助）、`src/cli/index.ts`（`runTui` 端口解析）、`src/cli/init.ts`（Feishu Setup + glab 安装提示）、`WORKFLOW.md.example` + `WORKFLOW.grill-openspec.md.example`（prompt body 引用 install-glab）、`assets/skills/install-glab/SKILL.md`（新技能）。
- 文档：`docs/usage.md`（tui 端口解析、init 飞书引导、glab 自装）、`docs/configuration.md`、`docs/skills.md`（技能列表）、`docs/feishu-quickstart.md`（可选）、`CONTEXT.md` 术语、`docs/adr/0006-tui-port-resolution.md`（已草拟）。
- 测试：`tests/comment-bridge.test.ts`（回执 + 首条 comment）、`tests/commands.test.ts`（解析/body 构建）、`tests/jira-tracker-comments.test.ts`（v3 ADF description）、`tests/cli-commands.test.ts`（tui 端口解析）、`tests/init.test.ts`（Feishu Setup、glab 提示）、`tests/skills.test.ts`（install-glab 技能）。
- 不动：`src/scheduler/*`、`src/worker/*`、`src/mcp/*`、`src/observability/http-dashboard.ts`、`src/bridge/binding-store.ts`、`src/bridge/comment-bridge.ts` 的绑定/同步/命令逻辑主线。
