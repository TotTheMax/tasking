# Symphony 有而 tasking 没有的能力

> 以下能力在 Symphony 参考实现中存在,但在 tasking 中完全缺失(无代码、无配置、无测试)。

## 1. `blocked` 问题状态机

**Symphony 位置:** `orchestrator.ex` `State.blocked`、`block_issue_from_entry/4`、`reconcile_blocked_issues/1`、`input_required_blocker?/1`

Symphony 检测 agent 需要人工输入(`turn_input_required`、`approval_required`、`mcpServer/elicitation/request`)时,将问题从 `running` 移入 `blocked` map——保持 claim 不 retry,单独 reconcile,在快照/API/仪表板中暴露为 `blocked`。

tasking 无此概念。所有失败(包括 agent 等待输入)都走 retry 路径,导致等待输入的 agent 被反复重启。

## 2. 轮询状态机 `checking?` / `next_poll_in_ms`

**Symphony 位置:** `orchestrator.ex` `State.poll_check_in_progress`、`State.next_poll_due_at_ms`、`schedule_poll_cycle_start/0`

Symphony 的 tick 分两阶段:`:tick` 设置 `poll_check_in_progress: true` 并通知仪表板("checking now…"),20ms 后 `:run_poll_cycle` 执行实际 poll。仪表板显示"Next refresh: Ns"倒计时。

tasking 同步执行 tick,无 checking 状态,无倒计时。

## 3. `worker_runtime_info` 消息

**Symphony 位置:** `orchestrator.ex` `handle_info({:worker_runtime_info, ...})`

worker 运行中可通过消息通道向 orchestrator 回传 `{worker_host, workspace_path}`,orchestrator 更新 running entry。

tasking 的 `workspace_path` 在 dispatch 时一次性解析,运行中不更新;无 `worker_host` 概念。

## 4. 派发前重新校验 `revalidate_issue_for_dispatch`

**Symphony 位置:** `orchestrator.ex` `revalidate_issue_for_dispatch/3`

派发前再次 fetch issue 最新状态,若已不再是候选(缺失/标签丢失/blocker 变化)则跳过。

tasking 直接从候选列表派发,不做派发前再校验。

## 5. 消失的运行中问题处理 `reconcile_missing_running_issue_ids`

**Symphony 位置:** `orchestrator.ex` `reconcile_missing_running_issue_ids/3`

reconcile 时,对于 tracker 未返回的运行中 issue(权限变更/删除),终止 worker。

tasking 只遍历 tracker 返回的 issue,不处理消失的 issue——worker 会永远跑到 stall timeout。

## 6. reconcile 时重新检查 routability

**Symphony 位置:** `orchestrator.ex` `reconcile_issue_state` 中的 `issue_routable?` 检查

reconcile 时,若 issue 的 `required_labels` 或 assignee 不再匹配,停止 worker(不清理工作区)。

tasking 的 reconcile 只检查 active/terminal,不重新检查标签/assignee。

## 7. tick-token 防过期

**Symphony 位置:** `orchestrator.ex` `handle_info({:tick, tick_token}, %{tick_token: tick_token})`

每次 `schedule_tick` 生成新 `make_ref()`,只有 token 匹配的 tick 才执行。过期 tick 静默丢弃。

tasking 无 token 保护,理论上 setTimeout 回调可能重复触发。

## 8. retry-token 防过期

**Symphony 位置:** `orchestrator.ex` `pop_retry_attempt_state` 中的 `^retry_token` 模式匹配

retry timer 携带 token,只有匹配的 retry 执行。过期 retry 静默丢弃。

tasking 用 `if (!retry) return` 保护,但无 token——stale timer 可能在删除前触发。

## 9. 两阶段 tick(标记 checking → 延迟执行)

**Symphony 位置:** `orchestrator.ex` `@poll_transition_render_delay_ms 20`、`schedule_poll_cycle_start/0`

`:tick` → 设置 checking → 20ms 后 `:run_poll_cycle`。给仪表板一个"checking now"的渲染窗口。

tasking 一步到位。

## 10. `notify_dashboard` 推送通知

**Symphony 位置:** `orchestrator.ex` `notify_dashboard/0`、`ObservabilityPubSub`

每次状态变更(dispatch/worker 退出/retry/reconcile)后推送通知,仪表板实时更新。

tasking 无推送,仪表板只能客户端轮询。

## 11. `terminate_running_issue` 统一清理

**Symphony 位置:** `orchestrator.ex` `terminate_running_issue/3`

一次性:记录 totals → 可选清理工作区 → 停止 task → 删 running/claimed/blocked/retry_attempts。

tasking 的清理分散在多个方法,`claimed` 在 reconcile 终止路径不清理,`totals` 在 reconcile 终止路径不记录。

## 12. continuation retry `attempt==1` 守卫

**Symphony 位置:** `orchestrator.ex` `retry_delay/2`

continuation 1000ms 延迟仅在 `attempt == 1` 时使用,attempt > 1 走退避公式。

tasking 任何 attempt 的 continuation 都用 1000ms。

## 13. 退避指数封顶 10

**Symphony 位置:** `orchestrator.ex` `failure_retry_delay/1`

`max_delay_power = min(attempt - 1, 10)`,指数封顶在 2^10。

tasking 无封顶,高 attempt 会产生 `Infinity`(被 `Math.min` 钳住但中间值溢出)。

## 14. 单调时钟 `due_at_ms`

**Symphony 位置:** `orchestrator.ex` `System.monotonic_time(:millisecond)`

retry due time 用单调时钟,免疫 NTP 跳变。

tasking 用 `Date.now()`(墙钟)。

## 15. `priority_rank` 未知优先级映射到 5

**Symphony 位置:** `orchestrator.ex` `priority_rank/1`

优先级 1-4 映射到自身,未知/nil 映射到 5(排在 P4 之后但仍参与排序)。

tasking 用 `Number.MAX_SAFE_INTEGER`(排到最后)。

## 16. `codex_app_server_pid` 追踪

**Symphony 位置:** `orchestrator.ex` `integrate_codex_update`、`app_server.ex` `port_metadata`

从 Erlang Port `:os_pid` 提取,印在每条事件上,仪表板显示。

tasking 不追踪子进程 PID。

## 17. `read_timeout_ms` 独立超时

**Symphony 位置:** `app_server.ex` `await_response`/`with_timeout_response`

握手/turn-start 响应有独立 5s 超时,启动挂起快速失败。

tasking 无独立启动超时,挂起要等满 `turn_timeout_ms`(默认 1h)。

## 18. malformed JSON 检测

**Symphony 位置:** `app_server.ex` `protocol_message_candidate?` → `malformed` 事件

`{` 开头但解析失败的行 → 发射 `malformed` 事件 + 关键词感知日志。

tasking 静默 try/catch 吞掉。

## 19. `max_turns` "交还控制权"语义

**Symphony 位置:** `agent_runner.ex`

达到 `max_turns` 时日志"returning control to orchestrator",返回 `:ok`(非失败的独立信号)。

tasking 标记 `succeeded`,与正常完成无法区分。

## 20. 续轮门控含 routability

**Symphony 位置:** `agent_runner.ex` `continue_with_issue?`

续轮条件:active AND routable(标签仍匹配)。

tasking 的 `trackerStateChecker` 只检查 active,不检查标签。

## 21. `bash -lc` 启动命令

**Symphony 位置:** `app_server.ex` Erlang Port `:binary, :exit_status, :stderr_to_stdout, cd: workspace, line: 1_048_576`

通过 login shell 启动,支持 env/aliases;stderr 合并到 stdout;1MB 行块累积。

tasking 用 `spawn(cmd[0], cmd.slice(1))`——无 shell,`split(/\s+/)` 破坏含空格的命令,无行缓冲上限。

## 22. 完整 runtime 事件分类(16 种)

**Symphony 位置:** `app_server.ex` `emit_message`

`session_started`/`turn_completed`/`turn_failed`/`turn_cancelled`/`turn_input_required`/`approval_required`/`approval_auto_approved`/`tool_call_completed`/`tool_call_failed`/`unsupported_tool_call`/`tool_input_auto_answered`/`startup_failed`/`turn_ended_with_error`/`notification`/`other_message`/`malformed`。

tasking 只发 `turn_completed` 一种。

## 23. approval 自动处理

**Symphony 位置:** `app_server.ex` `item/commandExecution/requestApproval`、`item/fileChange/requestApproval`

`approval_policy: never` 时自动 `acceptForSession`/`approved_for_session`。

tasking 无——opencode 自己处理,但 tasking 无法配置策略。

## 24. user-input 自动回答

**Symphony 位置:** `app_server.ex` `item/tool/requestUserInput`

选"Approve this Session" → "Approve Once" → 任何 approve/allow 标签;无匹配时用非交互回退。

tasking 无——agent 需要输入时会 hang 到 turn timeout。

## 25. 动态工具分发 `item/tool/call`

**Symphony 位置:** `app_server.ex`、`dynamic_tool.ex`

运行时接收工具调用,执行回调,返回结果;不支持的工具返回失败不阻塞。

tasking 用 MCP 配置注入替代(不同集成模型)。

## 26. `linear_graphql` 动态工具

**Symphony 位置:** `dynamic_tool.ex`

完整工具 schema + GraphQL 执行 + 错误处理 + 多操作拒绝 + 响应保留。

tasking 用 `jira_rest` MCP 工具替代。

## 27. SSH worker 扩展

**Symphony 位置:** `ssh.ex`、`orchestrator.ex` `select_worker_host`、`workspace.ex` 远程方法

`worker.ssh_hosts` 配置、per-host 并发上限、主机选择(最少负载/偏好亲和)、远程工作区生命周期、`__SYMPHONY_WORKSPACE__` TSV 协议、`shell_escape`。

tasking 完全无远程执行能力。

## 28. `.codex/skills/` 6 个 agent 技能

**Symphony 位置:** `.codex/skills/{commit,debug,land,linear,pull,push}/SKILL.md`

| 技能 | 内容 |
|---|---|
| commit | conventional-commit 格式、Summary/Rationale/Tests body、`Co-authored-by`、`git commit -F`、可疑文件标记 |
| debug | 日志关联键、`rg` 命令、失败分类法、stuck-run 调查流程 |
| land | PR 合并循环、CI watch、review 处理(accept/clarify/push-back)、squash-merge、`land_watch.py` |
| linear | `linear_graphql` 使用指南、状态转换前查 team states、PR 附件、视频上传 |
| pull | merge-based 同步、`git rerere`、`zdiff3`、分阶段冲突解决、何时问用户 |
| push | `make all` 验证门、`--force-with-lease`、PR 模板填充 + `pr_body.check` |

tasking 无技能系统,agent 指引全在 WORKFLOW.md prompt 中。

## 29. `worktree_init.sh` 工作区初始化

**Symphony 位置:** `.codex/worktree_init.sh`

`mise trust` + `make setup`——建立可复现的工具链版本。

tasking 的 `after_create` 只 `git clone`。

## 30. 终端 TUI 状态面板

**Symphony 位置:** `status_dashboard.ex`(~1600 行)

ANSI 彩色表格(ID/STAGE/PID/AGE/TURN/TOKENS/SESSION/EVENT)、退避队列、sparkline 吞吐量图(10 分钟窗口,24 列)、汇总栏(agents/tps/runtime/tokens/rate-limits)、下次刷新倒计时、节流去重、codex 事件人类可读摘要(~30 种)。

tasking 无。

## 31. Phoenix LiveView 实时仪表板

**Symphony 位置:** `symphony_elixir_web/` 全部

LiveView websocket `/live`、PubSub 广播、1s now-tick、服务端渲染 HTML(metric grid、running/blocked/retry 表格、copy-session-id 按钮、状态徽章)、嵌入式静态资源(4 文件,CSS + 3 JS)。

tasking 的 HTML 仪表板是 5 行桩。

## 32. 文件日志轮转 sink

**Symphony 位置:** `log_file.ex`

OTP `:logger_disk_log_h`、10MB × 5 文件 wrap 轮转、single-line formatter、可配置路径/大小/数量。

tasking 只写 stderr,`tasking logs` 读的文件无人写。

## 33. `--logs-root` CLI flag

**Symphony 位置:** `cli.ex`

可覆盖日志目录。

tasking 无。

## 34. CLI guardrails 确认横幅

**Symphony 位置:** `cli.ex` `--i-understand-that-this-will-be-running-without-the-usual-guardrails`

不提供此 flag 则拒绝启动,打印红色 ANSI 横幅警告。

tasking 自由启动。

## 35. `observability.*` 配置块

**Symphony 位置:** `config/schema.ex` `Observability`

`dashboard_enabled`(默认 true)、`refresh_ms`(默认 1000)、`render_interval_ms`(默认 16)。

tasking 无 `observability` 配置块。

## 36. `server.host` 配置

**Symphony 位置:** `config/schema.ex` `Server.host`(默认 `127.0.0.1`)

可配置绑定地址,支持 IPv4/IPv6/DNS 解析。

tasking 硬编码 `0.0.0.0`,无 `server.host` 配置。

## 37. `tracker.assignee` 路由

**Symphony 位置:** `config/schema.ex` `Tracker.assignee`、`linear/client.ex`

assignee 过滤 + "me" viewer 解析(通过 GraphQL viewer 查询解析为 Linear 用户 ID)。

tasking 无 assignee 概念。

## 38. `tracker.kind: "memory"` 测试适配器

**Symphony 位置:** `tracker/memory.ex`

内存中的 tracker,用于测试/本地开发,支持 `create_comment`/`update_issue_state` 消息发送。

tasking 只有 `jira` 适配器,无测试用内存 tracker。

## 39. Tracker behaviour 契约

**Symphony 位置:** `tracker.ex` `@behaviour`

5 个 callback:`fetch_candidate_issues/0`、`fetch_issues_by_states/1`、`fetch_issue_states_by_ids/1`、`create_comment/2`、`update_issue_state/2`。工厂模式分派。

tasking 的 `JiraTracker` 是具体类,无抽象接口,无工厂。

## 40. Tracker 写入面

**Symphony 位置:** `linear/adapter.ex` `commentCreate`、`issueUpdate` + `resolve_state_id/3`

tracker 适配器自带评论创建和状态转换(含 state name → state ID 解析)。

tasking 的 tracker 只读,写入由 agent 通过 MCP 工具完成。

## 41. Mix 工具任务

**Symphony 位置:** `lib/mix/tasks/`

| 任务 | 功能 |
|---|---|
| `pr_body.check` | 校验 PR 描述匹配模板(标题顺序、空段、占位符、bullet/checkbox) |
| `specs.check` | 强制每个 public `def` 有 `@spec` |
| `workspace.before_remove` | terminal 时通过 `gh` 关闭 GitHub PR |

tasking 无对应工具。

## 42. PR 模板 + PR-body lint CI

**Symphony 位置:** `.github/pull_request_template.md`、`.github/workflows/pr-description-lint.yml`

5 段式 PR 模板(Context/TL;DR/Summary/Alternatives/Test Plan),CI 用 `pr_body.check` 校验。

tasking 无 PR 模板,无 PR-body lint CI。

## 43. 100% 覆盖率阈值 + dialyzer

**Symphony 位置:** `mix.exs` `test_coverage: [summary: [threshold: 100]]`、`dialyzer`

强制 100% 覆盖率 + 静态分析。

tasking 无覆盖率门,无额外静态分析(tsc --strict 之外)。

## 44. Live E2E 测试

**Symphony 位置:** `live_e2e_test.exs`、`test/support/live_e2e_docker/`

创建真实 Linear 项目 + issue、运行真实 codex agent、验证工作区 side effect、验证 issue 状态变更。SSH 场景用 docker-compose 启 2 个 SSH worker,生成临时密钥,挂载 `~/.codex/auth.json`。

tasking 的 e2e 测试是桩(`console.log` + return)。

## 45. 架构流程图 `flow.html`

**Symphony 位置:** `flow.html`

深色主题可视化架构图,9 个分区,颜色编码组件,引用 SPEC 章节号。

tasking 只有文字 `docs/architecture.md`。

## 46. 日志约定文档

**Symphony 位置:** `elixir/docs/logging.md`

必填上下文字段(`issue_id` + `issue_identifier` + `session_id`)、`key=value` 消息格式、确定性措辞、每模块日志范围、新日志检查清单。

tasking 无日志约定文档。

## 47. token 记账规则文档

**Symphony 位置:** `elixir/docs/token_accounting.md`(304 行)

`total_token_usage` vs `last_token_usage` 区分、turn-completed usage 不可叠加、按 `thread_id` key、推荐策略(跟踪 absolute_total + accumulated_total、忽略 last 和 generic usage)。

tasking 无此文档,且实现违反了其中的核心规则。

## 48. snapshot 测试 + evidence fixture

**Symphony 位置:** `test/support/snapshot_support.exs`、`test/fixtures/status_dashboard_snapshots/*.evidence.md`

`UPDATE_SNAPSHOTS=1` 工作流、`.snapshot.txt`(ANSI) + `.evidence.md`(纯文本)双 fixture、CRLF→LF 规范化、ANSI strip。

tasking 无 snapshot 测试。

## 49. 10MB stdout 行缓冲上限

**Symphony 位置:** `flow.html`、`app_server.ex` `@port_line_bytes 1_048_576`(1MB 块,累积到任意长度)

agent 输出有行缓冲上限。

tasking 的 `stdout += d.toString()` 无上限累积,长时间运行可能 OOM。

## 50. CI SHA pin + `persist-credentials: false` + least-privilege

**Symphony 位置:** `.github/workflows/`

action 版本 pin 到不可变 SHA、`persist-credentials: false`、显式 `permissions: contents: read`。

tasking 用 `@v4` 可变标签,无 credential/permission 加固。
