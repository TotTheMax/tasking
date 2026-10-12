## Purpose

测试策略契约：面向开发代理/贡献者，定义端到端关键子系统的必跑测试集（mock E2E 硬门禁）、真实 API 集成测试的运行条件（`INTEGRATION=1`、live 环境可达）与一键运行命令。
## Requirements
### Requirement: 端到端关键子系统变更必跑 mock E2E
仓库的开发引导（AGENTS.md）SHALL 规定：修改飞书适配器、Jira 适配器、调度器或飞书↔Jira comment bridge 逻辑后，必须运行 mock 驱动的端到端测试（`tests/e2e.test.ts` 与 `tests/bridge-flow.test.ts`）。该测试集是硬门禁，已由 `npm test`/CI 覆盖。

#### Scenario: 修改 Jira 适配器后引导必跑 mock E2E
- **WHEN** 开发者/代理修改 `src/adapters/jira/` 或 `src/adapters/feishu/`、`src/scheduler/`、`src/bridge/` 逻辑
- **THEN** AGENTS.md 引导其运行 `tests/e2e.test.ts` + `tests/bridge-flow.test.ts`（mock E2E），且 CI 中的 `npm test` 强制其通过

### Requirement: 真实 API 集成测试在 live 环境可达时必跑
仓库的开发引导 SHALL 规定：当 live 测试环境可达时（本地开发），上述端到端关键子系统变更还必须运行真实 API 集成测试（`INTEGRATION=1` 运行 `tests/integration-real.test.ts`）；环境不可达时，须在 commit 或 MR 中注明未跑原因。该测试不纳入 CI（CI 无内网路由），不可达不阻塞。

#### Scenario: live 环境可达时运行真实集成
- **WHEN** 修改 bridge 逻辑且本地可达真实飞书测试 bot/群与真实 Jira TEST 项目
- **THEN** 开发者运行 `INTEGRATION=1` 的真实集成测试（`tests/integration-real.test.ts`）并确认通过

#### Scenario: live 环境不可达时注明原因
- **WHEN** 修改适配器逻辑但运行环境无法访问真实 Jira/飞书（如 CI 的 ubuntu-latest）
- **THEN** 该测试不被强制运行，且开发者须在 commit message 或 MR 描述中注明原因

### Requirement: 提供一键 E2E 运行脚本
`package.json` SHALL 提供两个脚本：`test:e2e`（运行 `tests/e2e.test.ts` 与 `tests/bridge-flow.test.ts`）与 `test:integration`（以 `INTEGRATION=1` 运行 `tests/integration-real.test.ts`），使开发引导可以直接引用命令。

#### Scenario: test:e2e 运行 mock E2E
- **WHEN** 运行 `npm run test:e2e`
- **THEN** vitest 执行 `tests/e2e.test.ts` 与 `tests/bridge-flow.test.ts`，且不执行真实集成测试

#### Scenario: test:integration 运行真实集成
- **WHEN** 运行 `npm run test:integration`
- **THEN** 以 `INTEGRATION=1` 执行 `tests/integration-real.test.ts`，连接真实飞书/Jira 测试资源

### Requirement: 引导与文档一致
`AGENTS.md`、`docs/zh/development.md`、`docs/en/development.md` 的测试策略 SHALL 相互一致，均引用 `npm run test:e2e` / `npm run test:integration` 命令名；docs 双语同步由 `tests/docs-links.test.ts` 维护文件名 parity。

#### Scenario: AGENTS.md 与 docs 引用同一命令
- **WHEN** 阅读 AGENTS.md 与 docs/zh/development.md、docs/en/development.md 的测试策略
- **THEN** 三者描述一致的必跑规则与命令名 `npm run test:e2e`、`npm run test:integration`

### Requirement: 卡片按钮行为以 mock 测试加人工验收覆盖
卡片按钮点击由真人产生，无法在自动化测试中合成，因此按钮的动作路由、守卫、确认流程与去重 SHALL 由 mock 驱动的单元/集成测试覆盖（含"W 处理函数先返回、慢操作延后"），真实 API 集成测试 SHALL 只验证发卡/更新卡/上传文件能成功与卡片可渲染；按钮的端到端行为 SHALL 列入人工验收清单并在文档中写明，不得因自动化缺口而省略。

#### Scenario: mock 测试覆盖按钮动作
- **WHEN** 运行测试套件
- **THEN** 中断/重试/完整输出/结束（含两步确认）、旧卡守卫与重复点击去重均有 mock 驱动用例

#### Scenario: 真实集成覆盖卡片与文件接口
- **WHEN** `INTEGRATION=1` 且 live 环境可达
- **THEN** 测试真实发送卡片、更新卡片与上传发送文件均成功

#### Scenario: 文档登记人工验收步骤
- **WHEN** 查阅开发/使用文档
- **THEN** 存在明确的按钮人工验收步骤（点哪几个按钮、预期看到什么）

### Requirement: 卡片交互由回路测试守卫
凡带回调按钮的卡片（桥或直连），其按钮行为 SHALL 由回路测试守卫：从**渲染出的卡**抽取按钮 value，经真实事件通道路由（`startEventChannel`）分发，断言**用户可见结果**（话题回复/卡片更新/文件消息），而非仅直调 handler。每个新增按钮 SHALL 同步加入守卫套件 `tests/card-roundtrip.test.ts`。回路的输入载荷 SHALL 默认采用缺 `operator.name` 的真实形态（fixture），防住"显示裸 open_id"类回归。存量直调单元测试不受影响（直调测 handler 逻辑，回路测接缝）。

#### Scenario: 回路从渲染产物出发
- **WHEN** 守卫套件验证某个按钮
- **THEN** 它从渲染卡 JSON 中抽取该按钮的 value（含路由判别字段与渲染序号），经真实路由分发，不手造 value 绕过接缝

#### Scenario: 新按钮必进套件
- **WHEN** 某 change 新增一个带回调按钮的卡片
- **THEN** 守卫套件同步包含该按钮的回路用例

#### Scenario: 缺操作人姓名的回调
- **WHEN** 回路分发的回调事件不带 `operator.name`
- **THEN** 涉及操作人显示的行为从群成员表解析显示名，不出现裸 open_id

#### Scenario: 同一原始事件重投
- **WHEN** 同一回调事件被原样重投
- **THEN** 写操作（如确认转状态）只执行一次并提示已处理，幂等读取操作（如刷新）可重复执行

