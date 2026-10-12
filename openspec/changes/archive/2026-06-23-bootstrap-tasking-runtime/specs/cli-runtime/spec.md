## ADDED Requirements

### Requirement: CLI 入口与子命令
`tasking` CLI SHALL 为单一入口,通过 npm 分发,可 `npx tasking` 调用。它 SHALL 支持子命令 `init`、`start`、`status`、`logs`、`triage`。`start` SHALL 启动托管两个调度器的 daemon 进程;其余子命令 SHALL 控制或观察运行中的 daemon。

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
CLI SHALL 接受位置参数 `WORKFLOW.md` 路径。缺省时 SHALL 使用当前工作目录下的 `./WORKFLOW.md`。不存在的显式路径或缺失的默认文件 MUST 为启动错误。

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

### Requirement: 配置解析含默认值与环境变量间接引用
配置层 SHALL 解析 `WORKFLOW.md` 的 YAML front matter,为可选字段应用内置默认值,仅对显式包含 `$VAR_NAME` 的值解析 `$VAR_NAME` 间接引用,对路径字段展开 `~`,并将相对 `workspace.root` 解析为相对于 `WORKFLOW.md` 所在目录。环境变量 SHALL NOT 全局覆盖 YAML 值。

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

### Requirement: 动态工作流重载
daemon SHALL 检测 `WORKFLOW.md` 变更,无需重启即重新读取并重新应用配置与 prompt 模板,并为后续派发调整在线行为(轮询间隔、并发、active/terminal 状态、opencode 设置、工作区路径/hook、prompt 内容)。无效重载 SHALL NOT 使 daemon 崩溃;SHALL 保留上一个已知良好配置并向运维者发出可见错误。在途 agent 会话无需自动重启。

#### Scenario: 配置变更无需重启即生效
- **WHEN** daemon 运行中修改 `WORKFLOW.md` 的 `polling.interval_ms`
- **THEN** 后续 tick 使用新间隔

#### Scenario: 无效重载保留上一个良好配置
- **WHEN** daemon 运行中将 `WORKFLOW.md` 编辑为无效 YAML
- **THEN** daemon 保留上一个有效配置,向运维者发出可见错误,不崩溃

### Requirement: 派发预校验
daemon SHALL 在启动时及每次派发 tick 前校验配置。启动校验失败 SHALL 以运维者可见错误导致启动失败。每 tick 校验失败 SHALL 跳过该 tick 的派发,同时保持 reconcile 活跃。校验项 SHALL 包括:工作流可加载/解析、`tracker.kind` 存在且受支持、`$` 解析后 tracker 凭据存在、必需的 project/scope 字段存在、worker 命令存在且非空。

#### Scenario: 启动校验失败
- **WHEN** 启动时 `tracker.kind` 缺失
- **THEN** daemon 启动失败并打印运维者可见错误

#### Scenario: 每 tick 校验失败跳过派发
- **WHEN** 有 worker 运行时某 tick 校验失败
- **THEN** 跳过该 tick 的派发,reconcile 仍运行

### Requirement: init 生成工作流骨架
`tasking init` SHALL 在当前工作目录生成一份入门 `WORKFLOW.md`(含 front matter + prompt body)及所需本地目录结构。未经确认 SHALL NOT 覆盖已存在的 `WORKFLOW.md`。

#### Scenario: 在空目录 init
- **WHEN** 在不含 `WORKFLOW.md` 的目录中调用 `tasking init`
- **THEN** 创建一份入门 `WORKFLOW.md`

#### Scenario: init 拒绝覆盖
- **WHEN** 在已存在 `WORKFLOW.md` 处调用 `tasking init`
- **THEN** 未经显式确认拒绝覆盖

### Requirement: status 与 logs 子命令
`tasking status` SHALL 打印源于内存状态的人类可读快照:运行中任务、retry 队列、聚合 token/运行时总量。`tasking logs` SHALL tail 或打印近期结构化日志。

#### Scenario: 无运行 daemon 时 status
- **WHEN** 无 daemon 运行时调用 `tasking status`
- **THEN** 报告 daemon 未运行并以非零码退出

#### Scenario: status 展示运行与重试
- **WHEN** daemon 有运行与重试任务时调用 `tasking status`
- **THEN** 输出列出运行中任务与 retry 队列条目,含标识符与时间

### Requirement: triage 子命令
`tasking triage` SHALL 立即触发一次针对非结构化 inbox 的 route-agent 运行(等价于强制一次 router tick)并报告所作决策。

#### Scenario: 触发分诊
- **WHEN** daemon 运行时调用 `tasking triage`
- **THEN** 排队/执行一次 route-agent 运行并报告 inbox 决策结果

### Requirement: 干净的进程生命周期
CLI 在 daemon 正常启动与关闭时 SHALL 以 0 退出,在启动失败或进程异常退出时 SHALL 以非零码退出。SHALL 通过尽可能优雅地停止活动 worker 来处理 SIGINT/SIGTERM。

#### Scenario: 正常关闭
- **WHEN** 运行中的 daemon 收到 SIGINT
- **THEN** 优雅停止 worker 并以 0 退出

#### Scenario: 启动失败退出码
- **WHEN** 启动校验失败
- **THEN** 进程以非零码退出
