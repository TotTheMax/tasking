## ADDED Requirements

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
管理器 SHALL 支持 `hooks.after_create`(仅新创建时运行;失败中止创建)、`hooks.before_run`(每次 attempt 前运行;失败中止 attempt)、`hooks.after_run`(每次 attempt 后运行;失败记录并忽略)、`hooks.before_remove`(删除前运行;失败记录并忽略)。hook SHALL 在以工作区目录为 cwd 的 shell 中执行,并 SHALL 受 `hooks.timeout_ms`(默认 60000)约束。

#### Scenario: after_create 失败中止
- **WHEN** 新工作区上 `after_create` 以非零退出
- **THEN** 中止工作区创建

#### Scenario: before_remove 失败不阻塞清理
- **WHEN** `before_remove` 以非零退出
- **THEN** 记录失败并继续工作区删除

### Requirement: 安全不变式——agent cwd 为工作区路径
启动 worker 前,管理器 SHALL 校验 worker 的 cwd 等于 per-task 工作区路径。不匹配 SHALL 中止 attempt。

#### Scenario: cwd 不匹配中止
- **WHEN** 计算所得 worker cwd 非工作区路径
- **THEN** 启动前中止 attempt

### Requirement: 安全不变式——工作区路径位于 root 内
管理器 SHALL 将工作区路径与工作区 root 都规范化为绝对路径,并 SHALL 要求工作区路径以工作区 root 为前缀目录。任何位于 root 之外的路径 SHALL 被拒绝。

#### Scenario: root 内路径被接受
- **WHEN** 工作区路径位于配置 root 内
- **THEN** 接受

#### Scenario: 路径逃逸被拒绝
- **WHEN** 计算所得工作区路径会逃出工作区 root(如经遍历)
- **THEN** 拒绝

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
