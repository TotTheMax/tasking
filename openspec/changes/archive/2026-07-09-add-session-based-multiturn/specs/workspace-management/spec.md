## ADDED Requirements

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
