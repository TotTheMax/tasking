## Context

当前 `tasking init`（`src/cli/init.ts`）仅复制 `WORKFLOW.md.example` → `WORKFLOW.md` 并创建 `~/tasking_workspaces` 目录。用户必须手动编辑文件填写 Jira 凭据（endpoint、api_key、auth_mode、api_user、project_key）及其他必填项。`validateStartupConfig` 会检查这些字段，但用户往往到 `tasking start` 时才发现配置不完整。

Jira tracker（`src/adapters/jira/tracker.ts`）已有 `request()` 方法做 Jira REST API 调用，可复用来测试连接和拉取项目状态。现有 `fetchCandidateIssues` 用 JQL 搜索，可加一个轻量的项目状态拉取方法。

`ConsoleLogger` 的 sink 架构和 `TerminalDashboard` 不涉及 init 流程。

## Goals / Non-Goals

**Goals:**
- `tasking init` 默认交互式：readline 逐项问答收集 Jira 凭据
- 凭据默认以 `$JIRA_API_KEY` 环境变量引用写入配置
- 问答后用凭据连 Jira 测试连接，成功则拉取并打印项目状态列表
- 连接失败不阻断，仍生成配置文件
- 检查 `opencode` 是否安装（警告不阻断）
- 生成 WORKFLOW.md 后尝试打开编辑器（`$VISUAL` → `$EDITOR` → `code`）
- 保留 `--non-interactive` 非交互模式，stdin 非 TTY 时自动 fallback

**Non-Goals:**
- 全屏 TUI 配置界面（readline 问答即可）
- 交互式多选状态（打印出来供参考，用户自行编辑文件分配）
- 自动生成 hook 命令（项目特定，留给用户手动编辑）
- 飞书凭据交互（feishu 当前 disabled，用户后续手动配置）

## Decisions

### D1: readline 问答而非全屏 TUI

用 Node.js `readline/promises` 模块逐行提问。配置初始化是一次性操作，readline 是 CLI 工具的通用惯例（`npm init`、`npx create-*` 等）。全屏 TUI 增加复杂度但收益低。

### D2: 凭据以 `$JIRA_API_KEY` 引用写入

问答收集 api_key 后，不写明文，而是写 `$JIRA_API_KEY` 到 WORKFLOW.md 的 `tracker.api_key`。提示用户把实际值加到 `~/.bashrc`。现有配置解析器已支持 `$VAR` 间接引用。

### D3: 条件问答——api_user 依赖 auth_mode

`auth_mode: basic` 时才问 `api_user`；`bearer` 时跳过。问答流程有依赖关系，按序执行。

### D4: 连接测试复用 JiraTracker

问答完成后，用收集到的凭据实例化 `JiraTracker`，调 Jira REST API `/project` 端点拉取项目状态列表。失败则打印错误，不阻断。不新建方法——复用 tracker 的 `request()` 私有方法或新增一个轻量 `fetchProjectStatuses()` 方法。

### D5: 编辑器打开顺序

`$VISUAL` → `$EDITOR` → `code` → 打印路径。用 `child_process.spawn` 以 `detached` + `stdio: "ignore"` 打开，不阻塞 init 进程。`code` 不存在则 spawn 失败，catch 后打印路径。

### D6: 非交互模式保留当前行为

`--non-interactive` 或 stdin 非 TTY 时，复制 WORKFLOW.md.example（当前行为），不问答、不连 Jira、不开编辑器。用于 CI/脚本。

## Risks / Trade-offs

- [readline 在非 TTY 环境行为异常] → 检测 `process.stdin.isTTY`，非 TTY 时自动 fallback 到非交互模式
- [Jira 连接测试超时阻塞] → 设 5s 超时，超时视为失败
- [编辑器打开失败] → catch spawn 错误，fallback 到打印路径
- [用户凭据填错但连接测试因网络问题失败] → 打印错误信息含 Jira endpoint，帮助用户诊断
