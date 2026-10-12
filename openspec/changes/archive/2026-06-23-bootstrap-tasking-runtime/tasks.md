## 1. 项目脚手架与工具链

- [x] 1.1 初始化 `package.json`(name `tasking`、type module、Node 22+ engine、`bin` 入口指向 CLI、build/lint/test 脚本)
- [x] 1.2 配置 TypeScript(`tsconfig.json`、strict、ESM、NodeNext、输出目录 `dist/`)
- [x] 1.3 添加开发工具:`vitest`(测试运行器)、linter/formatter(`biome` 或 `eslint`+`prettier`)、`tsx` 用于开发运行
- [x] 1.4 创建 `src/` 目录树,镜像能力划分:`cli/`、`config/`、`scheduler/`、`router/`、`worker/`、`workspace/`、`adapters/jira/`、`adapters/feishu/`、`observability/`、`plugin/`、`shared/`
- [x] 1.5 添加 `WORKFLOW.md` 示例 fixture 与 `.gitignore`(忽略 `dist/`、`node_modules/`、本地工作区、inbox sqlite 文件)
- [x] 1.6 配置 CI 在 push 时运行 `lint`、`typecheck`、`test`;将命令记录到 `AGENTS.md` 与 `README`

## 2. 共享领域模型与类型

- [x] 2.1 在 `src/shared/types.ts` 定义归一化 `Task` 实体(id、identifier、title、description、priority、state、branch_name、url、labels、blocked_by、created_at、updated_at、source),镜像 Symphony §4.1 与设计
- [x] 2.2 定义 `OrchestratorRuntimeState`、`RunningEntry`、`RetryEntry`、`Workspace`、`RunAttempt`,以及 decision/attempt 状态枚举
- [x] 2.3 定义类型化错误类别联合(`missing_workflow_file`、`workflow_parse_error`、`workflow_front_matter_not_a_map`、`template_parse_error`、`template_render_error`、tracker 错误、workspace 错误)

## 3. 配置层(cli-runtime)

- [x] 3.1 实现 `WORKFLOW.md` 加载器:front matter + prompt body 切分,`missing_workflow_file`/解析错误(Symphony §5)
- [x] 3.2 实现配置解析:默认值、`$VAR` 间接引用、`~` 展开、相对 `workspace.root` 解析、绝对路径规范化(Symphony §6.1)
- [x] 3.3 实现类型化 getter 与 `opencode.*`、`tracker.*`、`router.*`、`feishu.*`、`polling.*`、`workspace.*`、`hooks.*`、`agent.*` 配置块
- [x] 3.4 实现派发预校验(启动 + 每 tick),返回类型化错误(Symphony §6.3)
- [x] 3.5 实现动态 `WORKFLOW.md` watch + 重载(保留上一良好配置、不崩溃)(Symphony §6.2)
- [x] 3.6 单元测试:默认值、`$VAR`、`~`、相对 root、缺失/非法文件、严格模板渲染失败、重载回退

## 4. CLI 入口(cli-runtime)

- [x] 4.1 实现 `src/cli/index.ts` 子命令路由(`init`、`start`、`status`、`logs`、`triage`),带位置参数工作流路径与 `--port`
- [x] 4.2 实现 `tasking init` 脚手架(入门 `WORKFLOW.md`、拒绝覆盖)
- [x] 4.3 实现 `tasking start` 装配:加载配置 → 校验 → 启动 daemon(调度器 + 工作区 + 可观测性)→ 优雅 SIGINT/SIGTERM 关闭
- [x] 4.4 实现 `tasking status`(读取内存快照,daemon 未运行时非零退出)
- [x] 4.5 实现 `tasking logs`(tail/打印近期结构化日志)
- [x] 4.6 实现 `tasking triage`(触发一次 route-agent 运行)
- [x] 4.7 测试:无子命令用法退出、未知子命令退出、缺失默认工作流退出、npx 执行冒烟

## 5. 工作区管理器(workspace-management)

- [x] 5.1 实现工作区 key 清洗(将非 `[A-Za-z0-9._-]` 替换为 `_`)与确定性路径 `<root>/<sanitized_id>`
- [x] 5.2 实现创建/复用语义,带 `created_now` 标志与 `after_create` 门控(Symphony §9.2)
- [x] 5.3 实现四个生命周期 hook(`after_create`、`before_run`、`after_run`、`before_remove`),带 `hooks.timeout_ms`(默认 60000)与文档化失败语义(Symphony §9.4)
- [x] 5.4 实现三条安全不变式:cwd == 工作区、工作区位于 root 内(绝对前缀检查)、key 已清洗(Symphony §9.5)
- [x] 5.5 实现 `workspace.root` 解析(默认 `<tmp>/tasking_workspaces`、`~`、`$VAR`、相对 `WORKFLOW.md`)
- [x] 5.6 实现启动 terminal 工作区清理(查询 tracker、删除目录、运行 `before_remove`、拉取失败时警告并继续)
- [x] 5.7 测试:确定性路径、清洗、创建 vs 复用、hook 失败/中止、hook 超时、cwd 不匹配中止、路径逃逸拒绝、root 解析

## 6. Prompt 构建(opencode-worker / cli-runtime)

- [x] 6.1 集成严格 Liquid 兼容模板引擎(未知变量/filter 失败)
- [x] 6.2 以 `task`/`issue` 与 `attempt` 为输入渲染;续轮指引构建器用于后续调用(Symphony §12)
- [x] 6.3 body 为空时回退默认 prompt;文件/解析错误绝不回退(Symphony §5.4)
- [x] 6.4 测试:渲染 task+attempt、未知变量失败、未知 filter 失败、续轮指引与原 prompt 不同

## 7. opencode worker 层(opencode-worker)

- [x] 7.1 实现子进程启动器:`opencode run --dir <workspace> --agent <build> "<prompt>"`,以工作区为 cwd,可配置 `opencode.command`(默认 `opencode run`)
- [x] 7.2 实现有界续轮循环(首次 prompt = 完整,后续 = 续轮指引,上限 `agent.max_turns`,调用间重新检查 tracker)(Symphony §7.1、§16.5)
- [x] 7.3 实现 attempt 生命周期阶段与失败分类:succeeded/failed/timed_out/stalled/canceled_by_reconciliation(Symphony §7.2)
- [x] 7.4 实现 `opencode.turn_timeout_ms` 强制与异常退出检测
- [x] 7.5 实现 attempt 前后 `before_run`/`after_run` hook 执行
- [x] 7.6 实现从 opencode 输出提取 token 用量 + 进程级计时回退 + rate-limit 捕获(Symphony §13.5)
- [x] 7.7 实现 agent-runner 契约:创建/复用工作区 → 构建 prompt → 启动 → 转发事件 → 出错失败 → 成功保留工作区(Symphony §10.7)
- [x] 7.8 测试:cwd == 工作区、可配置命令、max-turns 上限、turn 超时分类、异常退出分类、hook 中止、用量提取、回退计时、成功后保留工作区

## 8. Jira tracker 适配器(jira-tracker)

- [x] 8.1 实现使用 JQL(`project = <KEY>` + 活跃状态)的 `fetch_candidate_issues()`,分页(页大小 50、30s 超时)、顺序保持(Symphony §11.2 类比)
- [x] 8.2 实现 `fetch_issues_by_states(state_names)`(空列表 = 无操作)与用于 reconcile 的 `fetch_issue_states_by_ids(ids)`(Symphony §11.1)
- [x] 8.3 实现归一化到共享 `Task` 模型:小写 labels、整数/null priority、ISO 时间戳解析、从 issue link 派生 `blocked_by`(Symphony §11.3)
- [x] 8.4 实现 Jira 认证/端点配置(endpoint、`$VAR` api key、必需 project key/slug、规范环境变量 `JIRA_API_TOKEN`)与 Cloud 的 Basic auth
- [x] 8.5 实现错误类别:`unsupported_tracker_kind`、`missing_tracker_api_key`、`missing_tracker_project_slug`、`jira_api_request`、`jira_api_status`、负载错误(Symphony §11.4)
- [x] 8.6 强制 tracker 写入边界:编排器无变更(Symphony §11.5)
- [x] 8.7 遵循 `active_states`/`terminal_states` 默认与大小写不敏感比较
- [x] 8.8 测试:JQL 过滤、分页顺序、空状态无操作、归一化(labels/priority/blocker)、缺失凭据校验、错误映射、编排器无写入

## 9. 结构化调度器(structured-scheduler)

- [x] 9.1 实现作为单一变更权威的 `OrchestratorRuntimeState`(running/claimed/retry_attempts/completed/总量)(Symphony §4.1.8、§7)
- [x] 9.2 实现轮询 tick:reconcile → 预校验 → 拉取候选 → 排序 → 派发(Symphony §8.1、§16.2)
- [x] 9.3 实现候选资格 + 排序(priority 升序、created_at 最旧、identifier 字典序;必需标签;Todo-blocker 门控)(Symphony §8.2)
- [x] 9.4 实现并发控制:全局 `max_concurrent_agents` + 按状态 `max_concurrent_agents_by_state`(小写键、非法忽略)(Symphony §8.3)
- [x] 9.5 实现 retry 队列:先取消已存在再创建、失败退避 `min(10000*2^(n-1), max_retry_backoff_ms)`、续轮 1000ms 固定(Symphony §8.4)
- [x] 9.6 实现活动运行 reconcile:停滞检测(`stall_timeout_ms`,`<=0` 禁用)+ tracker 状态刷新(terminal→清理、active→快照、其他→停止不清理、刷新失败→保留)(Symphony §8.5)
- [x] 9.7 实现 worker 退出处理:正常→续轮 retry(attempt 1);异常→退避 retry;聚合运行时累计(Symphony §16.6)
- [x] 9.8 保证结构化热循环中无 LLM
- [x] 9.9 测试:tick 顺序、校验失败跳过、无重复派发、排序、标签门控、blocker 门控、槽位耗尽、退避公式、缺失释放、停滞检测、terminal 清理、状态刷新失败保留、续轮 retry、重启重新派发

## 10. Inbox 存储(unstructured-router)

- [x] 10.1 在配置数据目录下实现 SQLite 后端 inbox,含 `inbox_items` 表(id、source、source_msg_id UNIQUE、received_at、raw_payload、status、decision、decided_at、task_id)
- [x] 10.2 实现 `pop_untriaged(batch_size)`(按 received_at FIFO)与 `mark_decision(id, decision)` 推进状态为 `decided`
- [x] 10.3 实现 `mark_dispatched(id, task_id)` 推进状态为 `dispatched`
- [x] 10.4 保证 `source_msg_id` 幂等插入与跨重启持久
- [x] 10.5 测试:重复插入幂等、FIFO pop、状态转换、跨重启存活

## 11. 飞书源适配器(feishu-source)

- [x] 11.1 实现飞书事件接入(仅 v1 IM 文本),针对配置机器人的 @mention 过滤
- [x] 11.2 实现幂等接入 inbox(source=feishu、source_msg_id、received_at、raw_payload)
- [x] 11.3 实现 `feishu.reply` 操作(向会话发送文本回复),失败被暴露
- [x] 11.4 实现飞书认证/端点配置(app id/secret、校验/加密 key、`$VAR`),启用但缺失时校验错误
- [x] 11.5 保证接入不阻塞结构化调度器
- [x] 11.6 测试:mention 接入、无 mention 忽略、富文本跳过、重复幂等、回复成功、回复失败暴露、缺失凭据校验

## 12. opencode plugin 工具(unstructured-router)

- [x] 12.1 实现 `tasking` opencode plugin,暴露 `inbox.pop_untriaged`、`inbox.mark_decision`、`feishu.reply`
- [x] 12.2 保证工具签名声明的输入/输出可供 route agent 使用
- [x] 12.3 处理不支持/未知工具调用而不使 route-agent 运行停滞
- [x] 12.4 测试:每个工具正常路径、工具失败返回结构化错误、未知工具不停滞

## 13. Route agent 运行器(unstructured-router)

- [x] 13.1 实现 route agent 为带 triage `--agent` profile 与有界 prompt 的 `opencode run` 子进程
- [x] 13.2 以 `router.batch_size` 条目与 `router.timeout_ms` 约束运行;超时终止,条目保持 `untriaged`
- [x] 13.3 装配 route-agent 触发:每 tick 与 `tasking triage`/外部 cron;除非另行配置,同一时刻最多一个并发 route-agent 运行
- [x] 13.4 保证结构化调度器不被 route-agent 执行阻塞
- [x] 13.5 将决策 `Task`(派发意图)交给共享 worker 路径,受全局+按状态并发约束;inbox 标记 `dispatched` 带 `task_id`
- [x] 13.6 测试:未分诊→Task 决策、拒绝决策、批量有界、超时条目保持未分诊、决策任务经共享路径派发、并发受尊重

## 14. 可观测性(observability)

- [x] 14.1 实现结构化 JSON 行日志(stderr + 可选文件),带 `task_id`/`task_identifier`/`session_id` 上下文字段(Symphony §13.1)
- [x] 14.2 使启动/校验/派发失败对运维者可见;sink 失败时 daemon 存活(Symphony §13.2)
- [x] 14.3 实现运行时快照(运行中行含 turn_count、重试行、codex_totals、rate_limits),带 `timeout`/`unavailable` 模式(Symphony §13.3)
- [x] 14.4 实现聚合 token + 运行时记账(delta 跟踪绝对总量、加已结束会话运行时、快照含活动流逝时间)(Symphony §13.5)
- [x] 14.5 实现可选 HTTP dashboard 扩展(`/`、`/api/v1/*`、`--port` 覆盖、默认回环、不参与正确性)(Symphony §13.7)
- [x] 14.6 测试:上下文字段存在、sink 失败非致命、快照字段、超时模式、聚合正确性、端口启用 + 覆盖、dashboard 不参与正确性

## 15. 集成与端到端测试

- [x] 15.1 端到端 daemon 测试:Jira fixture → 工作区 → mock `opencode run` → 续轮 → terminal 清理
- [x] 15.2 端到端 router 测试:飞书 fixture → inbox → mock route agent → 决策任务 → 共享 worker
- [x] 15.3 并发/共享池测试:结构化 + 非结构化任务共享全局并发预算
- [x] 15.4 重启恢复测试:杀 daemon → 重启 → 重新轮询 → 重新派发;inbox 存活,retry timer 不存活
- [x] 15.5 真实集成 profile(由环境/凭据门控):Jira 冒烟(无 `JIRA_API_TOKEN` 时干净跳过)、飞书冒烟(无应用凭据时干净跳过)、针对临时工作区的 `opencode run` 冒烟

## 16. 分发与文档

- [x] 16.1 定稿 `bin` 入口并验证干净安装下 `npx tasking --help` 可用
- [x] 16.2 编写 `README.md`(安装、`tasking init`/`start`/`status`/`logs`/`triage`、`WORKFLOW.md` schema、安全姿态、Symphony 出处)
- [x] 16.3 文档化信任/安全姿态、审批/沙箱策略、hook 信任假设(Symphony §15)
- [x] 16.4 添加覆盖 Jira 结构化 + 飞书 router 配置块的 `WORKFLOW.md` 参考示例
- [x] 16.5 将 lint/typecheck/test 命令记录到 `AGENTS.md`
- [x] 16.6 npm publish dry-run 验证(包内容、无密钥)
