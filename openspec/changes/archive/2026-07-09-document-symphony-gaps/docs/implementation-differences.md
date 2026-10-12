# 两边都有但实现机制不同

> 以下能力在 Symphony 和 tasking 中都存在,但实现方式有本质区别。这些差异大多源于三处有意替换(Elixir→TS、Linear→Jira、Codex app-server→opencode run)。

## 1. Agent 执行模型:长连接子进程 vs 一次性子进程

| | Symphony | tasking |
|---|---|---|
| 进程模型 | 一个 `codex app-server` 子进程跨所有 turn 存活 | 每个 turn 一个 `opencode run` 子进程 |
| 续轮 | 同一 thread 上 `turn/start`(进程不重启) | `-s sessionId` 续接(新进程恢复旧 session) |
| 上下文持久化 | app-server 进程内(thread + workpad) | opencode session store + `.tasking-session.json` sidecar |
| 进程开销 | 续轮零启动开销 | 每个 turn 付全部启动开销 |
| PID 可观测 | `codex_app_server_pid` 稳定可追踪 | 每轮新 PID,不追踪 |

**根因:** `opencode run` 是一次性 CLI,不是长连接协议。这是有意取舍。

## 2. 事件流:JSON-RPC 双向流 vs stdout 单向解析

| | Symphony | tasking |
|---|---|---|
| 传输 | stdio 上的 JSON-RPC 2.0,双向 | stdout 单向 JSON 行解析 |
| 请求/响应 | `initialize`/`initialized`/`thread/start`/`turn/start` 握手 | 无握手,直接传 CLI 参数 |
| 流式事件 | 16+ 种实时事件(turn/completed、approval、tool 等) | 只从 `step_finish` 提取 token,无实时事件 |
| 向 agent 写入 | 可(approval 决策、tool 结果) | 不可(stdin 是 `ignore`) |
| framing | 1MB 行块 + 累积到任意长度 | 无 framing,raw buffer `+=` |

**根因:** `opencode run --format json` 是只读 stdout 流,无双向通道。

## 3. 配置重载:同步轮询 vs 文件监听

| | Symphony | tasking |
|---|---|---|
| 触发 | 1Hz 轮询 `WorkflowStore` + `fs.watch` | `fs.watch` + 100ms debounce |
| 内容检测 | mtime + size + `phash2(content)` 内容哈希 | 只 mtime/size(fs.watch 事件) |
| 容错 | 文件系统不可靠时轮询仍能捕获 | `fs.watch` 失败则遗漏 |
| 路径变更 | 检测 `workflow_file_path` 变更并跟随 | 绑定初始路径,不跟随 |
| 外部 API | `force_reload/0` 同步入口 | `reload()` 仅内部调用 |
| 回退 | store 不在时 `current/0` 回退到 `Workflow.load` | 无回退,返回缓存 |

## 4. 工作区路径安全:canonicalize vs 词法比较

| | Symphony | tasking |
|---|---|---|
| 方法 | `PathSafety.canonicalize`(逐段 `lstat` + 递归 `read_link`) | `path.relative()`(纯词法) |
| symlink 检测 | 是(递归解析所有符号链接) | 否 |
| root==workspace 守卫 | 是(`workspace_equals_root` 错误) | 否(`rel === ""` 返回 true) |
| 错误分类 | 3 种(workspace_equals_root/symlink_escape/outside_root) | 1 种(workspace_outside_root) |
| 远程路径校验 | 是(拒绝 `\n`/`\r`/NUL) | N/A(无远程) |

## 5. 模板引擎:Solid vs 手写 mini-Liquid

| | Symphony | tasking |
|---|---|---|
| 引擎 | Solid(完整 Liquid 实现) | 手写 mini-Liquid |
| 标签 | `if`/`else`/`for`/`case`/`assign`/`capture` | 只有 `if`/`else` |
| 条件 | `==`/`!=`/`and`/`or`/`contains` + 比较运算 | 只有 truthy/negation |
| filter | 完整 Liquid filter 库 | 4 个(default/upcase/downcase/trim) |
| 日期格式化 | DateTime → ISO 8601 | JSON.stringify |
| 解析阶段 | 独立 parse + render(`template_parse_error`) | 无独立 parse 阶段 |

## 6. YAML 解析:YamlElixir vs 手写子集

| | Symphony | tasking |
|---|---|---|
| 引擎 | YamlElixir(完整 YAML) | `parseSimpleYaml` 手写子集 |
| 支持 | anchor/alias、flow mapping、tag、多行字符串 | 简单 map、数组、`|`/`>` 块标量、引号、布尔/数字 |
| 未知行 | 报错 | 静默跳过 |
| 非 map 顶层 | `workflow_front_matter_not_a_map` 错误 | 静默强制为对象 |

## 7. 重试退避计算

| | Symphony | tasking |
|---|---|---|
| continuation 守卫 | `attempt == 1` 才用 1000ms | 任何 attempt 用 1000ms |
| 指数封顶 | `min(attempt-1, 10)` | 无封顶(Infinity 被 Math.min 钳) |
| 时钟 | 单调 `System.monotonic_time` | 墙钟 `Date.now()` |
| 元数据保留 | fetch 失败时 `Map.merge` 保留 identifier/host/path | 构造空合成 Task,丢失上下文 |

## 8. 状态终止/清理

| | Symphony | tasking |
|---|---|---|
| 统一入口 | `terminate_running_issue/3`(一次性删 running/claimed/blocked/retry + 记录 totals) | 分散在 3+ 方法,各删不同集合 |
| totals 记录 | 所有终止路径(包括 reconcile) | 只有 `onWorkerExit` |
| `claimed` 清理 | 所有终止路径 | reconcile 终止路径不清理 |
| `retry_attempts` 清理 | 所有终止路径 | 部分路径不清理 |

## 9. 命令启动:shell vs 直接 spawn

| | Symphony | tasking |
|---|---|---|
| 启动方式 | `bash -lc <command>`(Erlang Port) | `spawn(cmd[0], cmd.slice(1))` |
| shell 支持 | login shell(env/aliases) | 无 shell |
| 参数解析 | shell 负责 | `split(/\s+/)` 破坏含空格命令 |
| stderr | 合并到 stdout | 独立 pipe |
| stdin | 协议通道 | `ignore` |
| 行缓冲 | 1MB 块 + 累积 | 无上限 |

## 10. Hook 执行

| | Symphony | tasking |
|---|---|---|
| shell | `sh -lc`(本地)或 `bash -lc`(SSH) | `bash -lc`(`execFileSync`) |
| 超时 | `Task.async` + `Task.yield` + `:brutal_kill` + 标记错误 | `execFileSync` timeout → 通用失败 |
| 输出截断 | 2KB + "... (truncated)" | 无截断 |
| `after_run` 保证 | `try/after` 总执行 | 无 try/finally,可能跳过 |
| 远程 | SSH 上的包装脚本 | N/A |
| issue 上下文 | `issue_id=… issue_identifier=…` 日志前缀 | `{hook, cwd}` 无 issue 标识 |

## 11. tracker 分页

| | Symphony | tasking |
|---|---|---|
| 方式 | cursor-based(`pageInfo.hasNextPage`/`endCursor`) | offset-based(`startAt`/`maxResults`/`total`) |
| 批量 ID 查询 | 50 个一批 + `sort_issues_by_requested_ids` 恢复请求顺序 | 无批量(一次 `searchIssues` 全量) |
| 错误摘要 | `summarize_error_body`(1KB + 空白折叠 + `<truncated>`) | 500 字符截断,无空白折叠 |

## 12. tracker 写入模型

| | Symphony | tasking |
|---|---|---|
| 写入位置 | tracker 适配器(`create_comment`/`update_issue_state`) | agent 通过 MCP 工具(`jira_rest`/`jira_upload_attachment`) |
| state-id 解析 | 适配器内 GraphQL team-states 查询 | agent 自行通过 `jira_rest` 查 transition ID |
| 信任模型 | orchestrator 侧写入 | agent 侧写入 |

## 13. 进程终止:强制 kill vs 协作取消

| | Symphony | tasking |
|---|---|---|
| 方式 | `Task.Supervisor.terminate_child` + `Process.exit(:shutdown)` | `AbortController.abort()`(协作信号) |
| 强制度 | 强制 kill | 协作(opencode 可忽略) |
| monitor | `Process.monitor` + `:DOWN` 消息 | async/await + try/catch |
| ref flush | `Process.demonitor(ref, [:flush])` | N/A |

## 14. snapshot 字段命名与格式

| | Symphony | tasking |
|---|---|---|
| 时间戳 | ISO 8601 字符串 | epoch ms 数字 |
| 总量名 | `codex_totals` | `totals` |
| ID 字段 | `issue_id`/`issue_identifier` | `task_id`/`task_identifier` |
| 退避时间 | `due_at`(ISO 绝对时间,从 `due_in_ms` 计算) | `due_at`(raw ms epoch) |
| 未知方法 | 405 | 404 |
| refresh 响应 | `{queued, coalesced, requested_at:ISO, operations}` | `{queued, requested_at:ms}` |
| 错误码 | 6 种(not_found/method_not_allowed/issue_not_found/orchestrator_unavailable/snapshot_timeout/snapshot_unavailable) | 2 种(not_found/internal) |

## 15. 仪表板实时更新

| | Symphony | tasking |
|---|---|---|
| 推送 | PubSub → LiveView websocket | 无(客户端轮询) |
| now-tick | 1s 定时器更新 `now`(elapsed 时间活) | 无 |
| HTML | 服务端渲染(metric grid + 3 表格 + 徽章 + copy 按钮) | 5 行桩 |
| CSS/JS | 4 个嵌入文件(1 年缓存) | 无 |
| 安全 | CSRF + session + 安全头 | 无 |

## 16. CLI 模型

| | Symphony | tasking |
|---|---|---|
| 入口 | escript 单入口 | 多子命令(start/status/logs/triage/init) |
| guardrails | `--i-understand...` 必须提供 | 无 |
| 依赖注入 | `evaluate/2` 接 `deps` map | 直接调用 |
| 关闭 | 监控 supervisor PID → `System.halt` | SIGINT/SIGTERM → `process.exit` |

## 17. 配置验证时机

| | Symphony | tasking |
|---|---|---|
| 启动 | `Config.validate!/0` | `validateStartupConfig` |
| 每 tick | `maybe_dispatch` 内 `Config.validate!/0` | 不调 `validateDispatchConfig` |
| 错误分支 | 7 种特定错误码 | 1 个通用 catch |

## 18. 日志格式

| | Symphony | tasking |
|---|---|---|
| 格式 | `key=value` 消息文本 | JSON 结构化对象 |
| 上下文 | `issue_id=… issue_identifier=… session_id=…` 内联 | `{task_id, task_identifier, session_id}` 结构 |
| 级别 | info/warning/error/debug | info/warn/error/debug |
| 文件 | OTP `:logger_disk_log_h` 10MB×5 轮转 | 无(stderr only) |

## 19. 测试模型

| | Symphony | tasking |
|---|---|---|
| snapshot 测试 | `.snapshot.txt` + `.evidence.md` + `UPDATE_SNAPSHOTS` | 无 |
| E2E | 真实 Linear + codex + docker SSH | 桩(console.log) |
| 覆盖率 | 100% 阈值 | 无阈值 |
| 静态分析 | dialyzer + credo --strict + specs.check | tsc --strict + biome |

## 20. 工作区标识符 nil 处理

| | Symphony | tasking |
|---|---|---|
| nil identifier | 默认 `"issue"` | 抛 `workspace_key_unsafe` |
| 空结果 | 不可能(已默认) | 抛异常 |
