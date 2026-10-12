## Purpose

per-task 工作区管理：创建、安全不变式、hook 执行、清理。
## Requirements
### Requirement: per-task 工作区路径布局
工作区管理器 SHALL 将任务标识符映射到工作区路径 `<workspace.root>/<sanitized_identifier>`。清洗后的标识符 SHALL 通过将不在 `[A-Za-z0-9._-]` 中的字符替换为 `_` 得到。工作区 SHALL 在同一任务的多次 attempt 间复用。成功运行 SHALL NOT 自动删除工作区。

#### Scenario: 确定性工作区路径
- **WHEN** 派发标识符为 `ABC-123` 的任务
- **THEN** 其工作区路径为 `<workspace.root>/ABC-123`

#### Scenario: 清洗
- **WHEN** 任务标识符含 `/` 或空格
- **THEN** 这些字符在工作区目录名中被替换为 `_`

#### Scenario: 跨 attempt 复用
- **WHEN** 任务在前次 attempt 后再次派发
- **THEN** 复用同一工作区目录

### Requirement: 工作区创建与复用语义
给定任务标识符,管理器 SHALL 清洗、在配置 root 下计算工作区路径、确保该路径作为目录存在,并 SHALL 仅当本次调用创建了目录时标记 `created_now=true`。`after_create` hook SHALL 仅在 `created_now=true` 时运行。

#### Scenario: 新工作区创建
- **WHEN** 工作区目录不存在
- **THEN** 创建它并运行 `after_create`

#### Scenario: 已存在工作区复用
- **WHEN** 工作区目录已存在
- **THEN** 复用且不运行 `after_create`

### Requirement: 工作区生命周期 hook
管理器 SHALL 支持 `hooks.after_create`(仅新创建时运行;失败中止创建)、`hooks.before_run`(每次 attempt 前运行;失败中止 attempt)、`hooks.after_run`(每次 attempt 后运行;失败记录并忽略)、`hooks.before_remove`(删除前运行;失败记录并忽略)。hook SHALL 在以工作区目录为 cwd 的 shell 中执行,并 SHALL 受 `hooks.timeout_ms`(默认 60000)约束。hook 执行与 opencode session 清理 SHALL 异步进行,SHALL NOT 阻塞 daemon 事件循环;超时上限、超时终止方式与失败处置语义 SHALL 与同步执行时完全一致。

#### Scenario: after_create 失败中止
- **WHEN** 新工作区上 `after_create` 以非零退出
- **THEN** 中止工作区创建

#### Scenario: before_remove 失败不阻塞清理
- **WHEN** `before_remove` 以非零退出
- **THEN** 记录失败并继续工作区删除

#### Scenario: hook 执行不阻塞事件循环
- **WHEN** 一个耗时数秒的 `before_run` hook 正在执行
- **THEN** daemon 事件循环保持运转(其他 worker 的事件处理、bridge tick、dashboard 请求不被冻结)

#### Scenario: hook 超时语义不变
- **WHEN** hook 运行超过 `hooks.timeout_ms`
- **THEN** 到点被 SIGTERM 终止,结果标记 `timeout`,`HookResult` 形状与语义同前

### Requirement: 安全不变式——agent cwd 为工作区路径
启动 worker 前,管理器 SHALL 校验 worker 的 cwd 等于 per-task 工作区路径。不匹配 SHALL 中止 attempt。

#### Scenario: cwd 不匹配中止
- **WHEN** 计算所得 worker cwd 非工作区路径
- **THEN** 启动前中止 attempt

### Requirement: 安全不变式——工作区路径位于 root 内
管理器 SHALL 将工作区路径与工作区 root 都通过 `realpathSync`(或等价方法)解析为真实路径(解析符号链接后),并 SHALL 要求工作区路径的真实路径以工作区 root 的真实路径为前缀目录。任何经符号链接逃出 root 的路径 SHALL 被拒绝。路径不存在时 SHALL 回退到 `path.resolve` 规范化(不解析 symlink)并接受校验。

#### Scenario: root 内路径被接受
- **WHEN** 工作区路径位于配置 root 内(无 symlink)
- **THEN** 接受

#### Scenario: 路径逃逸被拒绝
- **WHEN** 计算所得工作区路径会逃出工作区 root(如经 `..` 遍历)
- **THEN** 拒绝

#### Scenario: symlink 逃逸被拒绝
- **WHEN** 工作区路径含指向 root 外的符号链接
- **THEN** 解析真实路径后拒绝

#### Scenario: 不存在的路径回退
- **WHEN** 工作区路径尚不存在(首次创建前)
- **THEN** 回退到 `path.resolve` 规范化,不因 `realpathSync` 异常而失败

### Requirement: 安全不变式——工作区 key 已清洗
工作区目录名 SHALL 仅含 `[A-Za-z0-9._-]` 字符。所有其他字符 SHALL 替换为 `_`。

#### Scenario: 仅允许字符
- **WHEN** 计算工作区 key
- **THEN** 仅匹配清洗后字符的模式

### Requirement: 启动时 terminal 工作区清理
启动时,管理器 SHALL 针对 tracker 报告为 terminal 的任务,删除对应工作区目录(若配置则先运行 `before_remove`)。terminal 状态拉取失败 SHALL 记录警告并继续启动。

#### Scenario: terminal 工作区被删除
- **WHEN** 启动发现一个有已存在工作区的 terminal 任务
- **THEN** 删除该工作区

### Requirement: 工作区 root 解析
`workspace.root` SHALL 默认为 `<system-temp>/tasking_workspaces`,SHALL 支持 `~` 展开与 `$VAR` 间接引用,并 SHALL 将相对路径解析为相对于 `WORKFLOW.md` 所在目录。生效 root SHALL 在使用前规范化为绝对路径。

#### Scenario: 默认 root
- **WHEN** 省略 `workspace.root`
- **THEN** 生效 root 位于系统临时目录下

#### Scenario: 解析后为绝对路径
- **WHEN** `workspace.root` 为相对路径
- **THEN** 生效 root 为绝对路径

### Requirement: 工作区清理联动 session 清理
工作区管理器 SHALL 在删除工作区时,若关联的 session ID 非空,先执行 `opencode session delete <sessionID>` 清理 opencode session,再删除工作区目录。session 清理失败 SHALL 记录警告但不阻塞工作区删除。调度器 SHALL 在调用 `removeWorkspace` 时传入已知的 session ID(从 `RunningEntry` 获取)。

#### Scenario: terminal 清理含 session 删除
- **WHEN** 任务 terminal 且工作区管理器收到非空 session ID
- **THEN** 先执行 `opencode session delete <sessionID>`,再删除工作区目录

#### Scenario: session ID 为空时跳过 session 清理
- **WHEN** 工作区管理器收到 null session ID(daemon 重启后启动清理)
- **THEN** 跳过 session 清理,直接删除工作区目录

#### Scenario: session 清理失败不阻塞
- **WHEN** `opencode session delete` 以非零退出
- **THEN** 记录警告日志,继续删除工作区目录

### Requirement: Workspace sidecar session 文件
工作区管理器 SHALL 支持 workspace 级 sidecar 文件 `.tasking-session.json`,用于记录 last opencode session ID。`runAttempt` 在提取 session ID 后 SHALL 以原子方式写入该文件(含 `session_id` 与 `updated_at` 字段)。`removeWorkspace` 在删除工作区前 SHALL 从该文件读取 session ID;非空时执行 `opencode session delete`;读取失败或文件缺失时跳过 session 清理并记录警告。

#### Scenario: sidecar 写入
- **WHEN** turn 1 提取到 session ID
- **THEN** 写入 `.tasking-session.json` 到工作区根目录

#### Scenario: sidecar 更新
- **WHEN** 后续 turn 提取到相同 session ID
- **THEN** 更新 sidecar 的 `updated_at` 字段

#### Scenario: removeWorkspace 从 sidecar 读取
- **WHEN** `removeWorkspace` 执行且 sidecar 文件存在
- **THEN** 读取 session ID 并执行 `opencode session delete`

#### Scenario: sidecar 缺失时跳过 session 清理
- **WHEN** `removeWorkspace` 执行且 sidecar 文件不存在
- **THEN** 跳过 session 清理,直接删除工作区目录

