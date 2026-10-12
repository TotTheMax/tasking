## MODIFIED Requirements

### Requirement: 真实 API 集成测试覆盖 Jira 入口全流程
真实 API 集成测试 SHALL 镜像 mock E2E 的全流程但指向真实飞书 bot/群 + 真实 Jira TEST 项目，由 `INTEGRATION=1` 门控（CI 不跑）；凭据（`FEISHU_E2E_*`/`JIRA_E2E_*`）SHALL 从 `tests/helpers/e2e-creds.ts` 解析，来源按优先级：真实环境变量 > gitignored `.env` 文件（Node 22 原生 `loadEnvFile`）> 代码默认值；`INTEGRATION != 1` 时干净跳过，`INTEGRATION=1` 但某凭据解析为空 SHALL 快速失败并列出缺失键。测试 SHALL 经真实 `CommentBridge`（直调 `onDispatch`/`onTerminate`，与 Scheduler 事件驱动同一代码路径，直调以隔离共享 TEST 项目），agent stub SHALL 经真实 `JiraTracker` 发真实 comment（`postComment`）与转真实状态（`transitionIssue`），逼近 agent 真实场景而非空跑。测试 SHALL 覆盖 Jira 入口全流程：真实 Jira TEST 项目建 issue → `onDispatch` 建真实飞书话题与 binding → agent stub 真实 Jira comment 经 `forwardComments` 桥到真实飞书话题 → 完结 `onTerminate` 回执 → binding terminal。

#### Scenario: INTEGRATION=1 即跑真实链路
- **WHEN** `INTEGRATION=1`（凭据有代码默认值，无需设任何环境变量）
- **THEN** 测试对真实飞书 bot/群与真实 Jira TEST 项目跑 Jira 入口全流程，断言真实话题建立、agent 真实 comment 出现在真实飞书话题、binding terminal

#### Scenario: INTEGRATION != 1 时干净跳过
- **WHEN** `INTEGRATION != 1`（不论环境变量/`.env` 是否设置）
- **THEN** 测试干净跳过（不失败），CI 不跑真实链路

#### Scenario: 环境变量或 .env 文件覆盖默认凭据
- **WHEN** 设置某 `FEISHU_E2E_*`/`JIRA_E2E_*` 环境变量（或仓库根 `.env` 文件含该键）且 `INTEGRATION=1`
- **THEN** 真实环境变量优先、其次 `.env` 文件、最后代码默认值；测试用覆盖后的值跑真实链路

#### Scenario: agent stub 做真实 Jira 操作
- **WHEN** `onDispatch` 建立话题与 binding 后 agent stub 执行
- **THEN** stub 经真实 `JiraTracker` 调 `postComment`（真实 Jira comment）与 `transitionIssue`（真实状态流转），随后 `forwardComments` 将该真实 comment 桥到真实飞书话题

#### Scenario: 默认 Jira 凭据为 WORKFLOW.md tracker api_key 值
- **WHEN** 未设 `JIRA_E2E_API_KEY` 环境变量、`.env` 亦无该键，取代码默认值（= WORKFLOW.md 的 `tracker.api_key` 值，可访问 TEST 项目的同一用户）
- **THEN** 真实 Jira TEST 项目的 `createIssue`/`postComment`/`transitionIssue` 成功（非 400/401）

#### Scenario: 测试清理真实 Jira issue
- **WHEN** 真实集成测试结束（无论成功失败）
- **THEN** 创建的真实 Jira TEST issue 被删除，不残留测试数据

### Requirement: E2E 凭据默认值与单一真源
真实 API 集成测试的 6 个凭据（`FEISHU_E2E_APP_ID`/`FEISHU_E2E_APP_SECRET`/`FEISHU_E2E_INTAKE_CHAT_ID`/`JIRA_E2E_ENDPOINT`/`JIRA_E2E_API_KEY`/`JIRA_E2E_PROJECT_KEY`）SHALL 在 `tests/helpers/e2e-creds.ts` 内提供代码默认值（取 `process.env.X ?? DEFAULT`）并作为凭据键名与默认值的唯一真源；解析 SHALL 支持三来源优先级：真实环境变量 > 仓库根 gitignored `.env` 文件（经 Node 22 原生 `process.loadEnvFile()` 加载，`override=false` 语义）> 代码默认值；仓库 SHALL 提交 `.env.example` 模板；`docs/known-issues.md` SHALL NOT 重复字面量值，SHALL 指向该模块。`INTEGRATION=1` 且任一凭据解析为空 SHALL 快速失败（`missingE2ECreds` 校验），列出缺失键并提示 `cp .env.example .env`。

#### Scenario: 凭据有代码默认值
- **WHEN** 未设任何 `FEISHU_E2E_*`/`JIRA_E2E_*` 环境变量且无 `.env` 文件
- **THEN** `tests/helpers/e2e-creds.ts` 导出 6 个非空默认值（飞书专用测试 bot/群 + Jira TEST 项目），`integration-real.test.ts` 引用之

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