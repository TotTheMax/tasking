## MODIFIED Requirements

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
