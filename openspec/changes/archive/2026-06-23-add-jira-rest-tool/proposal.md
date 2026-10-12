## Why

tasking 当前能让 opencode agent 在工作区里干活,但 agent **没有能力回写 Jira**(转状态、评论、加标签)。这导致 agent 做完工作后 Jira 状态不变,tasking 的 retry 循环发现"仍活跃"就无限重新派发——用户实际遇到了一个任务连跑 20 轮空转。Symphony SPEC 早在 §10.5 就解决了这个问题:内置 `linear_graphql` 客户端工具,复用编排器已配的 tracker 凭据,让 agent 自己写 tracker。tasking 需要实现等价的 `jira_rest` 工具,并优化 prompt 让 agent 知道何时、如何回写 Jira(包括代码任务走 review 交接态、非代码任务直接完成的差异化流程)。

## What Changes

- **新增 `jira_rest` 内置 MCP server** — 一个轻量 Node 脚本,随 tasking npm 包分发,复用 WORKFLOW.md 里已配的 Jira 凭据(endpoint、api_key、auth_mode),向 opencode agent 暴露 `jira_rest` 工具。agent 调用 `jira_rest({ method, path, body })`,tasking 代为执行 Jira REST API,agent 不接触 token。等价于 Symphony SPEC §10.5 的 `linear_graphql`。
- **`runAttempt` 启动前自动注入 workspace 级 `.opencode/opencode.json`** — 在 `createWorkspace` 之后、`spawn(opencode run)` 之前,向工作区写入 `.opencode/opencode.json`,指向 tasking 内置的 MCP server 脚本,并注入 tracker 凭据为 env vars。仅影响该工作区的 opencode 进程,**不污染全局 opencode 配置**。
- **优化 `WORKFLOW.md` prompt 模板** — 参考 Symphony SPEC §11.5 的"交接态"设计:
  - **代码任务**:agent 完成代码 → commit/push → 创建 PR(如有)→ 用 `jira_rest` 转状态为 review 交接态(如"待审核")→ 添加评论含 PR 链接/变更摘要 → 等人工 review + merge → 人工转"完成"。
  - **非代码任务**:agent 完成 → 用 `jira_rest` 直接转"完成"。
  - **任务跟踪**:agent 在 Jira 中添加评论(进展、决策、阻塞)、标签(如 `agent-done`、`needs-review`),便于团队跟踪。
- **更新 `WORKFLOW.md.example` 与文档** — 反映新的 prompt 模板与 `jira_rest` 工具说明。

## Capabilities

### New Capabilities
- `jira-rest-tool`: 内置 `jira_rest` MCP server 与 workspace 级自动注入机制。让 opencode agent 能回写 Jira(状态转换、评论、标签),复用 WORKFLOW.md 已配凭据,agent 不接触 token。等价于 Symphony SPEC §10.5 `linear_graphql`。
- `workflow-prompt-optimization`: 优化 `WORKFLOW.md` prompt 模板,定义代码任务(走 review 交接态)与非代码任务(直接完成)的差异化 Jira 回写流程,以及任务跟踪评论/标签规范。参考 Symphony SPEC §11.5 交接态设计与 §12.3 attempt 语义。

### Modified Capabilities
<!-- 无现有 spec 的 REQUIREMENTS 变更;本次为新增能力 + prompt 模板优化。 -->

## Impact

- **新增源码**:`src/mcp/jira-server.ts`(MCP server 脚本)、`src/mcp/inject.ts`(workspace 级配置注入)。
- **修改源码**:`src/worker/runner.ts`(`runAttempt` 调用注入)、`src/cli/init.ts`(starter prompt 更新)、`WORKFLOW.md.example`。
- **新增依赖**:可能需要 `@modelcontextprotocol/sdk` 或直接用 stdio JSON-RPC 手写(倾向后者,避免额外依赖)。
- **不影响现有行为**:`jira_rest` 工具仅在 workspace 级注入,不修改全局 `~/.config/opencode/opencode.json`。
- **文档同步**:`docs/configuration.md`、`docs/usage.md` 需补充 `jira_rest` 说明。
