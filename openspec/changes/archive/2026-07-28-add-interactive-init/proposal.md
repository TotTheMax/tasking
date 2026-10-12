## Why

当前 `tasking init` 只是复制 WORKFLOW.md.example 文件，用户必须手动打开文件逐一填写 Jira 凭据、项目信息等必填项。新用户上手门槛高，容易因为填错状态名、忘记配凭据而卡住。需要一个交互式引导流程，降低上手成本。

## What Changes

- `tasking init` 改为交互式 readline 问答，逐项收集 Jira 凭据（endpoint、api_key、auth_mode、api_user、project_key）
- 凭据默认以 `$JIRA_API_KEY` 环境变量引用写入配置，提示用户加到 `~/.bashrc`；同时说明可直接填明文
- 问答完成后用凭据连 Jira 测试连接，成功则拉取项目状态列表打印出来供用户参考
- 连接失败不阻断，仍生成配置文件，提示用户修好后手动改状态或重新 init
- 检查 `opencode` 是否安装，找不到则警告但不阻断
- 生成 WORKFLOW.md 后尝试打开编辑器（`$VISUAL` → `$EDITOR` → `code`），都没有则打印文件路径
- 友好提示：完美运作需手动编辑 `active_states`、`terminal_states`、`review_state`、`after_create` 等
- 保留 `tasking init --non-interactive` 非交互模式用于 CI/脚本，stdin 不是 TTY 时自动 fallback

## Capabilities

### New Capabilities
- `interactive-init`: 交互式 init 引导流程——凭据问答、Jira 连接测试、状态展示、编辑器打开、opencode 检查

### Modified Capabilities
- `cli-runtime`: `init` 子命令行为变更——默认交互式，新增 `--non-interactive` 标志

## Impact

- `src/cli/init.ts`：重写 `runInit`，改为交互式问答流程
- `src/adapters/jira/tracker.ts`：新增项目状态拉取方法（或复用现有 search API）
- `src/cli/index.ts`：`init` 子命令参数解析增加 `--non-interactive`
- `tests/`：新增 init 交互式流程测试
- `docs/usage.md`：更新 `tasking init` 命令文档
