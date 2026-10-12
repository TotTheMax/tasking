## MODIFIED Requirements

### Requirement: 活动运行 reconcile
调度器 SHALL 每 tick 运行 reconcile,含两部分:停滞检测(距上次活动超过 `opencode.stall_timeout_ms` 则终止并 retry;`<= 0` 时禁用),以及 tracker 状态刷新(terminal→终止并清理工作区目录、active→更新快照、其他→终止但不清理)。terminal 清理 SHALL 删除该任务实际的 per-task 工作区目录(路径解析为 `<workspace.root>/<sanitized_identifier>`,与启动 terminal 清理一致),并 SHALL 在删除前运行 `before_remove` hook。状态刷新失败 SHALL 保留 worker 运行并在下个 tick 重试。

#### Scenario: 停滞检测
- **WHEN** 某运行任务无活动时间超过 `stall_timeout_ms`
- **THEN** 终止 worker 并调度 retry

#### Scenario: terminal 状态触发工作区删除
- **WHEN** 某运行任务的 tracker 状态变为 terminal
- **THEN** 终止 worker,从磁盘删除其 per-task 工作区目录,且 `before_remove` hook 先于删除运行

#### Scenario: terminal 清理使用派发时承载的工作区路径
- **WHEN** reconcile 判定某运行任务转为 terminal
- **THEN** 使用运行态条目在派发时记录的 `workspace_path` 删除目录,而非在 reconcile 时按当前配置重新推算路径

#### Scenario: terminal 清理对缺失目录安全 no-op
- **WHEN** reconcile terminal 分支发现 `workspace_path` 指向的目录已不存在(如 `after_create` 失败回滚后)
- **THEN** 不抛错、不运行 `before_remove`,worker 仍被终止并从 running 移除

#### Scenario: 非活跃状态停止但不清理
- **WHEN** 某运行任务的 tracker 状态既非 active 也非 terminal
- **THEN** 终止 worker 但不清理工作区

#### Scenario: 状态刷新失败保留 worker
- **WHEN** 状态刷新 tracker 调用失败
- **THEN** 保留 worker 运行,reconcile 下个 tick 重试
