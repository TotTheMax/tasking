简体中文 | [English](./README.md)

# tasking

[![CI](https://github.com/TotTheMax/tasking/actions/workflows/ci.yml/badge.svg)](https://github.com/TotTheMax/tasking/actions/workflows/ci.yml)

一个 TypeScript CLI daemon，从两个任务源编排 [opencode](https://opencode.ai) coding-agent 工作：

- **结构化（Jira）：** 确定性的轮询/派发/对账/重试调度器——热循环中无 LLM。
- **飞书：** 群内 `/chat` 直接跑 opencode 的直连会话，加上与 Jira 的评论双向镜像桥。LLM `route agent`（inbox 分诊）**未实现**。

两者汇聚到共享的 `Task` 模型、共享的工作区管理器与共享的 `opencode run` worker。

`tasking` 在调度层面参考了 [Symphony](https://github.com/openai/symphony)的协调模型，在此基础进行扩展。

## 安装

```bash
npm install -g @tothemax/tasking
# 或免安装使用：
npx @tothemax/tasking --help
```

需要 Node 22+，且 `PATH` 中有 [`opencode`](https://opencode.ai) CLI。

## 快速上手

```bash
# 1. 在当前目录脚手架生成 WORKFLOW.md
tasking init

# 2. 用你的 Jira/飞书凭据编辑 WORKFLOW.md（或用 $ENV 变量）

# 3. 启动 daemon
tasking start

# 在另一个终端：
tasking status     # 查看运行中任务、重试队列、token 总量
tasking logs       # 查看近期结构化日志
```

引导式上手指引见 [中文快速上手](./docs/zh/getting-started.md) 或 [英文快速上手](./docs/en/getting-started.md)。

## 命令

| 命令 | 说明 |
|---------|-------------|
| `tasking init [workflow-path]` | 脚手架生成一份 `WORKFLOW.md` |
| `tasking start [path] [--port N]` | 启动 daemon（默认加载 `./WORKFLOW.md`） |
| `tasking status` | 打印运行时快照（运行中、重试中、总量） |
| `tasking logs` | 打印近期结构化日志 |
| `tasking doctor [workflow-path]` | 全链路只读体检（WORKFLOW.md、飞书、Jira、opencode） |

## `WORKFLOW.md` 契约

仓库自有的 `WORKFLOW.md`（YAML front matter + prompt 正文）配置 tracker、轮询、工作区、hooks、opencode worker 与飞书源。`tasking init` 写入四款 starter 模板之一——默认为 **`feishu-direct`**（裸 `tasking init` 即是；飞书直连专用——[`assets/workflows/WORKFLOW.feishu-direct.md.example`](./assets/workflows/WORKFLOW.feishu-direct.md.example)，`tracker.kind: none`，无需 Jira；首问「任务来源」回车即进该路径）。Jira 变体为 `minimal`（最小——[`assets/workflows/WORKFLOW.minimal.md.example`](./assets/workflows/WORKFLOW.minimal.md.example)）、`code-mr`(完整 VCS/MR 流程——[`assets/workflows/WORKFLOW.code-mr.md.example`](./assets/workflows/WORKFLOW.code-mr.md.example))与 `grill-openspec`（[`assets/workflows/WORKFLOW.grill-openspec.md.example`](./assets/workflows/WORKFLOW.grill-openspec.md.example)）——经 `--workflow <variant>` 或「接 Jira」分支选择。每个变体另有英文版:传 `--lang en` 获取 `.en.` 版模板([`assets/workflows/WORKFLOW.minimal.en.md.example`](./assets/workflows/WORKFLOW.minimal.en.md.example)、[`assets/workflows/WORKFLOW.code-mr.en.md.example`](./assets/workflows/WORKFLOW.code-mr.en.md.example)、[`assets/workflows/WORKFLOW.grill-openspec.en.md.example`](./assets/workflows/WORKFLOW.grill-openspec.en.md.example));交互式 init 未指定语言时会引导选择。完整配置参考见 `code-mr` 或 `grill-openspec` 模板。

关键配置块：

- `tracker.*` — Jira endpoint、鉴权（`$JIRA_API_TOKEN`）、project key、active/terminal 状态、必需 label
- `polling.interval_ms` — 轮询节奏（默认 30000）
- `workspace.root` — 每任务工作区根（默认 `<tmp>/tasking_workspaces`）
- `hooks.*` — `after_create` / `before_run` / `after_run` / `before_remove` shell hooks
- `agent.*` — `max_concurrent_agents`、`max_turns`、`max_retry_backoff_ms`、按状态上限
- `opencode.*` — worker 命令（默认 `opencode run`）、agent profile、turn/stall 超时
- `router.*` — **未实现**：resolver 会解析但无运行时代码消费（预留供将来 route agent 分诊）
- `feishu.*` — 飞书源应用凭据与 `enabled` 标志；`feishu.direct` 启用 `/chat` 固定目录 opencode 直连会话（绕过 Jira；见 `docs/configuration.md`）
- `server.port` — 可选 HTTP dashboard 端口

prompt 正文是严格 Liquid 兼容模板，带 `task`（或 `issue`）与 `attempt` 变量。未知变量/过滤器会导致渲染失败。

## 架构

```
Jira (structured) ──► deterministic scheduler ──┐
                                                  ├──► shared Task model ──► workspace ──► opencode run
Feishu (direct sessions) ──► direct worker ──┘
```

- **结构化路径：** Symphony 式轮询 tick → 状态机 → 对账 → 指数退避重试。热循环中无 LLM。
- **飞书路径：** 群内 `/chat` 直连会话（在配置目录跑 opencode，一个话题一个会话），加上 issue 话题 ↔ Jira 评论的双向镜像桥。规划的 route agent inbox 分诊**未实现**。
- **Worker：** `opencode run --dir <workspace> --agent <build> "<prompt>"` 子进程，按任务做 OS 级隔离。
- **状态：** 编排器调度状态在内存中（重启 = 重新轮询 tracker）；直连会话绑定是持久 SQLite。

完整设计决策见 [`openspec/changes/archive/2026-06-23-bootstrap-tasking-runtime/design.md`](./openspec/changes/archive/2026-06-23-bootstrap-tasking-runtime/design.md)。

## 安全姿态

`tasking` 继承 Symphony 三条不可妥协的文件系统安全不变式：

1. **Agent cwd == 工作区路径** — worker 的 cwd 恒为每任务工作区；不匹配则中止该 attempt。
2. **工作区位于 root 内** — 工作区路径规范化为绝对路径，且必须以工作区 root 为前缀；路径逃逸被拒绝。
3. **工作区 key 已清洗** — 工作区目录名仅允许 `[A-Za-z0-9._-]`；其余字符转为 `_`。

### 信任边界

`tasking` 面向**可信环境**、高信任配置：

- `opencode run` worker 以 daemon 的 OS 权限运行。按需用 opencode 的 approval/sandbox 设置收紧执行。
- **Hook 脚本完全可信** — `WORKFLOW.md` hooks（`after_create`、`before_run` 等）以 `bash -lc` 在工作区目录运行任意 shell。只运行你可控来源的 hook。
- 工作区 hooks 受 `hooks.timeout_ms`（默认 60s）约束，避免 daemon 挂起。
- 编排器**不做 tracker 写入** — 工单变更（状态流转、评论）发生在 coding agent 内部经其工具完成，而非编排器业务逻辑。
- API token 绝不记录。`$VAR` 间接引用让凭据不进 `WORKFLOW.md`。

### Approval 与 sandbox 策略

Approval、sandbox 与用户输入行为委托给 `opencode run` 自身策略。通过 `opencode.*` 块配置。需要用户输入的运行视为硬失败（不会无限 stall）。

## 开发

```bash
npm install
npm run lint        # biome check
npm run typecheck   # tsc --noEmit
npm test           # vitest run
npm run build       # tsc → dist/
npm run dev -- start  # 经 tsx 运行
```

## 许可证

MIT——见 [LICENSE](./LICENSE)。

tasking 的调度模型与内置 agent 技能借鉴自 [openai/symphony](https://github.com/openai/symphony)（Apache-2.0），其许可声明适用于这些部分。
