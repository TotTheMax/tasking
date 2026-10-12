## ADDED Requirements

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
