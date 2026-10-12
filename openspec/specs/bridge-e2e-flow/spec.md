# bridge-e2e-flow Specification

## Purpose
TBD - created by archiving change feishu-mock-e2e-tests. Update Purpose after archive.
## Requirements
### Requirement: 修正后 mock 与真实飞书 API 形状一致
测试 mock SHALL 以真实飞书 IM API 形状构造响应，使测试验证的是"与真实 API 一致"而非"与错误假设一致"：`reply_in_thread` 响应 SHALL 返回 `thread_id`；`create_time` SHALL 用 13 位毫秒时间戳（由 `toSecondsStr` 归一化为秒）；`listMessages` 请求 SHALL 用 `container_id_type=chat`，`listThreadReplies` SHALL 用 `container_id_type=thread`，mock SHALL 按容器类型区分返回；消息 sender SHALL 含真实字段（`sender_id.open_id`、`sender_name`、`sender_type`）。

#### Scenario: reply_in_thread 响应返回 thread_id
- **WHEN** 测试 mock 响应 `replyInThread` 请求
- **THEN** 响应含 `thread_id`，且 bridge 将之持久化到 binding

#### Scenario: create_time 用 13 位毫秒并归一化为秒
- **WHEN** mock 消息 `create_time` 为 13 位毫秒字符串
- **THEN** `toSecondsStr` 将其归一化为 10 位秒字符串，cursor 比较用秒

#### Scenario: 容器类型区分 chat 与 thread
- **WHEN** mock 收到 `listMessages`（chat）与 `listThreadReplies`（thread）请求
- **THEN** 分别按 `container_id_type=chat` 与 `container_id_type=thread` 返回对应容器消息

#### Scenario: 消息 sender 含真实字段
- **WHEN** mock 构造消息对象
- **THEN** 含 `sender_id.open_id`、`sender_name`、`sender_type`，可被 `parsePolledMessage` 完整解析

### Requirement: 端到端全流程测试覆盖两个入口
端到端流程测试 SHALL 用修正后的 mock 覆盖完整链路：飞书入口（`/issue` 建 issue）与 Jira 入口（tracker 派发）两种方式创建 issue → agent 执行（mock worker）→ 飞书/Jira 修改状态 → agent 添加 Jira comment → forwardComments 桥到飞书话题 → 话题内人回复桥成 Jira comment → 完结 → binding 置 terminal。测试 SHALL 验证 cursor 推进、sentinel 去重、binding 生命周期。

#### Scenario: 飞书入口全流程
- **WHEN** intake 群收到 `/issue` 消息且后续状态流转到 terminal
- **THEN** 创建 Jira issue + binding、回执已创建、话题建立、状态可经 `/state` 流转、完结后 binding terminal

#### Scenario: Jira 入口全流程
- **WHEN** tracker 派发 Jira issue 且后续状态流转到 terminal
- **THEN** `onDispatch` 建立飞书话题与 binding、`onTerminate` 回执已完结、binding terminal

#### Scenario: cursor 推进与 sentinel 去重
- **WHEN** 同一周期内存在 sentinel（via 飞书）comment 与已处理消息
- **THEN** sentinel comment 不被回投、已处理消息不重复桥接、cursor 单调推进

### Requirement: 真实 API 集成测试覆盖 Jira 入口全流程
真实 API 集成测试 SHALL 镜像 mock E2E 的全流程但指向真实飞书 bot/群 + 真实 Jira TEST 项目，由 `INTEGRATION=1` 门控（CI 不跑）；凭据（`FEISHU_E2E_*`/`JIRA_E2E_*`）SHALL 从 `tests/helpers/e2e-creds.ts` 解析，来源为真实环境变量或 gitignored `.env` 文件（Node 22 原生 `loadEnvFile`，真实环境变量优先；无代码默认值）；`INTEGRATION != 1` 时干净跳过，`INTEGRATION=1` 但某凭据解析为空 SHALL 快速失败并列出缺失键。测试 SHALL 经真实 `CommentBridge`（直调 `onDispatch`/`onTerminate`，与 Scheduler 事件驱动同一代码路径，直调以隔离共享 TEST 项目），agent stub SHALL 经真实 `JiraTracker` 发真实 comment（`postComment`）与转真实状态（`transitionIssue`），逼近 agent 真实场景而非空跑。测试 SHALL 覆盖 Jira 入口全流程：真实 Jira TEST 项目建 issue → `onDispatch` 建真实飞书话题与 binding → agent stub 真实 Jira comment 经 `forwardComments` 桥到真实飞书话题 → 完结 `onTerminate` 回执 → binding terminal。

#### Scenario: INTEGRATION=1 且 .env 齐备即跑真实链路
- **WHEN** `INTEGRATION=1` 且 6 个凭据经环境变量或仓库根 `.env` 文件解析非空
- **THEN** 测试对真实飞书 bot/群与真实 Jira TEST 项目跑 Jira 入口全流程，断言真实话题建立、agent 真实 comment 出现在真实飞书话题、binding terminal

#### Scenario: INTEGRATION != 1 时干净跳过
- **WHEN** `INTEGRATION != 1`（不论环境变量/`.env` 是否设置）
- **THEN** 测试干净跳过（不失败），CI 不跑真实链路

#### Scenario: 环境变量或 .env 文件提供凭据
- **WHEN** 设置某 `FEISHU_E2E_*`/`JIRA_E2E_*` 环境变量（或仓库根 `.env` 文件含该键）且 `INTEGRATION=1`
- **THEN** 真实环境变量优先、其次 `.env` 文件；测试用解析后的值跑真实链路

#### Scenario: agent stub 做真实 Jira 操作
- **WHEN** `onDispatch` 建立话题与 binding 后 agent stub 执行
- **THEN** stub 经真实 `JiraTracker` 调 `postComment`（真实 Jira comment）与 `transitionIssue`（真实状态流转），随后 `forwardComments` 将该真实 comment 桥到真实飞书话题

#### Scenario: 默认 Jira 凭据与 WORKFLOW.md tracker 解耦
- **WHEN** `.env` 的 `JIRA_E2E_API_KEY`/`JIRA_E2E_ENDPOINT` 指向可访问 TEST 项目的用户（可与 WORKFLOW.md `$JIRA_API_TOKEN` 同值）
- **THEN** 真实 Jira TEST 项目的 `createIssue`/`postComment`/`transitionIssue` 成功（非 400/401）

#### Scenario: 测试清理真实 Jira issue
- **WHEN** 真实集成测试结束（无论成功失败）
- **THEN** 创建的真实 Jira TEST issue 被删除，不残留测试数据

### Requirement: E2E 凭据键名单一真源
真实 API 集成测试的 6 个凭据（`FEISHU_E2E_APP_ID`/`FEISHU_E2E_APP_SECRET`/`FEISHU_E2E_INTAKE_CHAT_ID`/`JIRA_E2E_ENDPOINT`/`JIRA_E2E_API_KEY`/`JIRA_E2E_PROJECT_KEY`）SHALL 不提交任何字面量默认值（`E2E_DEFAULTS` 全为空字符串），`tests/helpers/e2e-creds.ts` 作为凭据键名与解析逻辑的唯一真源；解析 SHALL 支持两来源：真实环境变量 > 仓库根 gitignored `.env` 文件（经 Node 22 原生 `process.loadEnvFile()` 加载，`override=false` 语义）；仓库 SHALL 提交 `.env.example` 模板；`docs/known-issues.md` SHALL NOT 重复字面量值，SHALL 指向该模块。`INTEGRATION=1` 且任一凭据解析为空 SHALL 快速失败（`missingE2ECreds` 校验），列出缺失键并提示 `cp .env.example .env`。

#### Scenario: 无代码默认值
- **WHEN** 未设任何 `FEISHU_E2E_*`/`JIRA_E2E_*` 环境变量且无 `.env` 文件
- **THEN** `tests/helpers/e2e-creds.ts` 的 6 个默认值解析为空字符串，`INTEGRATION=1` 时快速失败并列出全部缺失键

#### Scenario: 环境变量覆盖默认值
- **WHEN** 设置某 `FEISHU_E2E_*`/`JIRA_E2E_*` 环境变量
- **THEN** 环境变量值覆盖代码默认值（`process.env.X ?? DEFAULT`）

#### Scenario: .env 文件覆盖默认值但不覆盖真实环境变量
- **WHEN** 仓库根存在 `.env` 文件含某 `FEISHU_E2E_*`/`JIRA_E2E_*` 键，且该键未设真实环境变量
- **THEN** `.env` 值生效；若同一键已设真实环境变量，则真实环境变量优先（`loadEnvFile` 默认 `override=false`）

#### Scenario: INTEGRATION=1 且凭据为空则快速失败
- **WHEN** `INTEGRATION=1` 且某解析后凭据为空（如显式设空串覆盖默认值，或默认缺失）
- **THEN** `missingE2ECreds` 校验失败，抛出错误列出缺失键并提示 `cp .env.example .env`

#### Scenario: 提交 .env.example 模板
- **WHEN** 查看仓库根
- **THEN** 存在 `.env.example`，含 6 个凭据键的说明与占位值，供 `cp .env.example .env` 后填写个人测试环境

#### Scenario: known-issues.md 不重复字面量
- **WHEN** 查看 `docs/known-issues.md` 的真实 API 集成测试说明
- **THEN** 不含 6 个凭据的字面量值，改为指向 `tests/helpers/e2e-creds.ts`（防双写漂移）

