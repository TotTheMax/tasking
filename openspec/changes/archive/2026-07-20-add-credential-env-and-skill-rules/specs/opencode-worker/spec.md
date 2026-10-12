## MODIFIED Requirements

### Requirement: Worker 以 opencode run 子进程启动
worker 层 SHALL 将每次任务 attempt 作为 `opencode run` 子进程启动,带 `--dir <workspace>`(以 per-task 工作区为 cwd)、`--format json`(结构化事件流输出)、`--agent <build>`(配置的 agent profile)、以及渲染后的 prompt 作为末尾参数。当 `opencode.auto_approve` 为 `true`(默认)时,SHALL 追加 `--auto` 标志以自动放行未被 `.opencode/opencode.json` 显式拒绝的权限请求。当 worker 接收到已有 session ID 时,SHALL 额外传入 `-s <sessionID>` 以续接同一 session。所启动进程的 cwd SHALL 为 per-task 工作区路径。opencode 调用命令 SHALL 可通过 `opencode.command` 配置(默认 `opencode run`)。worker spawn 时 SHALL 将 `config.env` 合并到子进程环境变量,`config.env` 的值优先于继承的 `process.env`。

#### Scenario: Worker cwd 为工作区
- **WHEN** 为某任务启动 worker
- **THEN** `opencode run` 进程 cwd 等于 per-task 工作区路径

#### Scenario: 可配置命令
- **WHEN** `opencode.command` 设为自定义前缀
- **THEN** 使用该前缀启动 worker 子进程

#### Scenario: JSON 格式输出
- **WHEN** worker 启动 `opencode run`
- **THEN** 命令参数含 `--format json`

#### Scenario: 自动放行权限
- **WHEN** `opencode.auto_approve` 为 `true`(默认)
- **THEN** 命令参数含 `--auto`

#### Scenario: 禁用自动放行
- **WHEN** `opencode.auto_approve` 为 `false`
- **THEN** 命令参数不含 `--auto`

#### Scenario: 续接已有 session
- **WHEN** worker 接收到非空 session ID(如 continuation retry)
- **THEN** 命令参数含 `-s <sessionID>`

#### Scenario: config.env 注入子进程
- **WHEN** `config.env` 含 `GITLAB_TOKEN: "glpat-xxx"`
- **THEN** worker 子进程的 `GITLAB_TOKEN` 环境变量为 `glpat-xxx`

#### Scenario: config.env 优先于 process.env
- **WHEN** `config.env` 含 `GITLAB_TOKEN: "from-config"` 且 `process.env.GITLAB_TOKEN` 为 `from-shell`
- **THEN** worker 子进程的 `GITLAB_TOKEN` 环境变量为 `from-config`
