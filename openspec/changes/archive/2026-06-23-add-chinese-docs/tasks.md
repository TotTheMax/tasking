## 1. 文档目录与索引

- [x] 1.1 创建 `docs/` 目录
- [x] 1.2 编写 `docs/README.md` 文档索引:列出每篇文档标题、用途、适用读者、相对链接;末尾附中英术语对照表(dispatch→派发、reconcile→对账/reconcile、workspace→工作区、claim→认领 等)

## 2. 使用指南

- [x] 2.1 编写 `docs/usage.md` 安装章节:全局安装 `npm install -g tasking`、`npx tasking` 免安装使用、Node 22+ 与 `opencode` 依赖要求
- [x] 2.2 编写快速上手章节:`tasking init` → 编辑 `WORKFLOW.md` → `tasking start` 闭环示例(含 Jira 与飞书两种最小配置)
- [x] 2.3 编写命令详解章节:逐个说明 `init`/`start`/`status`/`logs`/`triage` 的用法、参数(`[workflow-path]`、`--port`、`--force`)、退出码(0 正常、1 启动失败/未知子命令/无子命令)
- [x] 2.4 编写凭据配置章节:Jira(`$JIRA_API_TOKEN`、`api_user`、Basic auth)、飞书(`$FEISHU_APP_ID`/`$FEISHU_APP_SECRET`/`verification_token`/`encrypt_key`、启用开关)
- [x] 2.5 编写工作区与 hooks 章节:per-task 工作区路径布局、`after_create`/`before_run`/`after_run`/`before_remove` 四个 hook 的触发时机与失败语义、`hooks.timeout_ms`
- [x] 2.6 编写 prompt 模板章节:`{{ task.identifier }}`、`{{ attempt }}` 变量、`{% if %}`/`{% else %}`/`{% endif %}` 标签、严格模式(未知变量/filter 失败)、空 body 默认 prompt
- [x] 2.7 编写典型场景示例:仅 Jira 结构化、Jira + 飞书双源、启用 HTTP dashboard

## 3. 开发编译指南

- [x] 3.1 编写 `docs/development.md` 环境要求章节:Node 22+、npm、`opencode` CLI、可选 Jira/飞书凭据用于真实集成测试
- [x] 3.2 编写依赖安装章节:`npm install`、`better-sqlite3` 原生模块说明
- [x] 3.3 编写目录结构说明:`src/{cli,config,scheduler,router,worker,workspace,adapters/{jira,feishu},observability,plugin,shared}` 每个目录的职责一句话说明
- [x] 3.4 编写构建与检查命令章节:`npm run build`、`npm run typecheck`、`npm run lint`、`npm run lint:fix`、`npm test`、`npm run test:watch` 各自作用与产物(`dist/`)
- [x] 3.5 编写开发运行章节:`npm run dev -- start`、`npm run dev -- init`、tsx 直接运行源码
- [x] 3.6 编写发布流程章节:`npm publish`、`prepublishOnly` 自动构建、`files` 字段仅含 `dist`/`README.md`、`docs/` 不纳入发布、`bin` 入口指向 `dist/cli/index.js`
- [x] 3.7 编写代码风格约定章节:biome、双引号、分号、尾逗号、ESM/`"type": "module"`、NodeNext、strict TypeScript、vitest 测试约定、无注释(除非明确要求)

## 4. 架构概览

- [x] 4.1 编写 `docs/architecture.md` 双源双调度章节:结构化 Jira 确定性 轮询/派发/reconcile/retry(热循环无 LLM)与非结构化飞书 route agent 分诊,两者汇聚到共享 Task 模型与共享 worker
- [x] 4.2 编写共享 Task 模型章节:归一化字段(id/identifier/title/priority/state/labels/blocked_by/source 等)、Jira 归一化、飞书 route agent 产出
- [x] 4.3 编写 worker 子进程隔离章节:`opencode run --dir <workspace> --agent <build> "<prompt>"`、OS 级进程隔离、有界续轮循环、attempt 生命周期与失败分类
- [x] 4.4 编写状态持久化与重启恢复章节:调度状态(running/claimed/retry)内存不跨重启、inbox SQLite 跨重启存活、重启 = 重新轮询 tracker + 工作区复用
- [x] 4.5 编写安全不变式章节:cwd==工作区、工作区位于 root 内(绝对前缀检查)、key 仅含 `[A-Za-z0-9._-]`、hook 脚本完全受信

## 5. 配置参考

- [x] 5.1 编写 `docs/configuration.md` `WORKFLOW.md` 格式说明:YAML front matter + prompt body、front matter 非对象为错误、空 body 回退默认 prompt
- [x] 5.2 编写 `tracker` 块字段表:kind、endpoint、api_key、api_user、project_key、project_slug、required_labels、active_states、terminal_states(类型/默认值/必需/中文说明)
- [x] 5.3 编写 `polling` 与 `workspace` 块字段表:interval_ms、root(含默认 `<tmp>/tasking_workspaces`、`~`/`$VAR`/相对路径解析)
- [x] 5.4 编写 `hooks` 块字段表:after_create、before_run、after_run、before_remove、timeout_ms(默认 60000)
- [x] 5.5 编写 `agent` 块字段表:max_concurrent_agents、max_turns、max_retry_backoff_ms、max_concurrent_agents_by_state(小写键、非法忽略)
- [x] 5.6 编写 `opencode` 块字段表:command(默认 `opencode run`)、agent、turn_timeout_ms、stall_timeout_ms(`<=0` 禁用停滞检测)
- [x] 5.7 编写 `router` 与 `feishu` 块字段表:router(enabled/agent/batch_size/timeout_ms)、feishu(enabled/app_id/app_secret/verification_token/encrypt_key)
- [x] 5.8 编写 `server` 块字段表:port(`--port` 覆盖、`0` 临时端口、默认回环)
- [x] 5.9 编写解析规则章节:`$VAR_NAME` 仅对显式包含该形式的值生效、空值视为缺失、环境变量不全局覆盖 YAML、`~` 展开、相对 `workspace.root` 解析为相对于 `WORKFLOW.md` 所在目录
- [x] 5.10 编写动态重载与校验章节:文件变更检测重新应用、无效重载保留上一良好配置不崩溃、启动校验失败阻止启动、每 tick 校验失败跳过派发但保留 reconcile

## 6. 一致性校验

- [x] 6.1 对照 `src/config/resolver.ts` 的 `DEFAULTS` 与 `docs/configuration.md` 的默认值,确保一致
- [x] 6.2 对照 `package.json` 的 scripts/bin/files 与 `docs/development.md`,确保命令与发布说明一致
- [x] 6.3 对照 `WORKFLOW.md.example` 与 `docs/configuration.md` 字段表,确保示例与文档一致
- [x] 6.4 在 `AGENTS.md` 追加一条约定:修改配置 schema 或命令行为时,必须同步更新 `docs/configuration.md` 与 `docs/usage.md`
