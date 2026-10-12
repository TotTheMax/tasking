## Context

tasking 的 worker(`opencode run` 子进程)在工作区里干活,但 agent 没有工具回写 Jira(转状态、评论、加标签)。Symphony SPEC §10.5 用内置 `linear_graphql` 客户端工具解决了这个问题——复用编排器已配的 tracker 凭据,让 agent 自己调 API 写 tracker。tasking 需要实现等价的 `jira_rest` 工具。

关键约束(来自 Symphony SPEC):
- §11.5:"Symphony does not require first-class tracker write APIs in the orchestrator. Ticket mutations are typically handled by the coding agent using tools defined by the workflow prompt."
- §11.5:"Workflow-specific success often means 'reached the next handoff state' (for example `Human Review`) rather than tracker terminal state `Done`."
- §10.5:"Reuse the configured Linear endpoint and auth from the active Symphony workflow/runtime config; do not require the coding agent to read raw tokens from disk."
- §12.3:prompt 模板可根据 `attempt` 给不同指令(首次 vs 续轮 vs 重试)。

当前状态:`src/plugin/tools.ts` 已有 opencode plugin 框架(用于 inbox 工具),`src/adapters/jira/tracker.ts` 已有 Jira REST 调用与 auth 逻辑(bearer/basic),`src/worker/runner.ts` 已有 workspace 创建与 spawn 逻辑。差的只是把 Jira REST 能力暴露为 agent 可用的工具 + 注入机制 + prompt 优化。

干系人:使用 tasking 的工程团队(希望 agent 自动完成 Jira 状态闭环)、review 者(需要看到 PR 链接与变更摘要)。

## Goals / Non-Goals

**Goals:**
- 实现 `jira_rest` MCP server,复用 WORKFLOW.md 凭据,agent 不接触 token。
- 在 `runAttempt` 启动 `opencode run` 前,自动向工作区注入 workspace 级 `.opencode/opencode.json`,不污染全局配置。
- 优化 prompt 模板:代码任务走 review 交接态(不直接 Done),非代码任务直接完成,agent 添加评论/标签便于跟踪。
- agent 完成后回写 Jira 状态,tasking retry 发现非活跃 → 停止派发,解决无限循环。

**Non-Goals:**
- 不在编排器(tasking)中实现 first-class tracker 写 API(遵循 Symphony §11.5 边界)。
- 不自动 merge PR(人工 review + merge 后人工/agent 转"完成")。
- 不实现 demo 视频上传(只在 prompt 中建议 agent 在评论中附截图链接/说明)。
- 不修改全局 `~/.config/opencode/opencode.json`(仅 workspace 级注入)。
- 不引入额外 npm 依赖(MCP server 用 stdio JSON-RPC 手写)。

## Decisions

### 决策 1:用 stdio JSON-RPC 手写 MCP server,不引入 SDK 依赖
**选择:** `src/mcp/jira-server.ts` 直接实现 MCP 协议的 `tools/list` 和 `tools/call` 方法,通过 stdio JSON-RPC 通信,不依赖 `@modelcontextprotocol/sdk`。

**理由:** tasking 只需暴露一个 `jira_rest` 工具,MCP 协议的 `initialize`/`tools/list`/`tools/call` 三个方法足够。引入 SDK 会增加包体积和依赖链。手写约 100 行,可控且零依赖。

**备选:** 用 `@modelcontextprotocol/sdk`——更标准但增加依赖,且 SDK 的 stdio transport 对 ESM 的兼容性需验证。暂缓。

### 决策 2:workspace 级 `.opencode/opencode.json` 注入,不修改全局配置
**选择:** `runAttempt` 在 `createWorkspace` 后、spawn 前,向 `<workspace>/.opencode/opencode.json` 写入 MCP server 配置:

```json
{
  "mcp": {
    "jira": {
      "type": "local",
      "command": ["node", "<tasking-dist>/mcp/jira-server.js"],
      "env": {
        "JIRA_ENDPOINT": "<from WORKFLOW.md>",
        "JIRA_AUTH_MODE": "<bearer|basic>",
        "JIRA_API_KEY": "<from WORKFLOW.md>",
        "JIRA_API_USER": "<from WORKFLOW.md>"
      }
    }
  }
}
```

**理由:** opencode 启动时先读工作区的 `.opencode/opencode.json` 再读全局配置,workspace 级配置不影响其他 opencode 使用。凭据通过 MCP server 的 `env` 注入,agent 进程本身看不到这些环境变量(只有 MCP server 子进程能访问)。

**备选:** 修改全局 `~/.config/opencode/opencode.json`——会影响所有 opencode 会话,污染用户环境。已排除。

### 决策 3:`jira_rest` 工具暴露原始 REST 接口,不封装高级语义
**选择:** agent 调用 `jira_rest({ method: "POST", path: "/issue/OS-262/transitions", body: { transition: { id: "31" } } })`,tasking 代为执行并返回 Jira API 响应。

**理由:** 与 Symphony `linear_graphql` 暴露原始 GraphQL 一致——编排器不做业务逻辑(§2.2),状态转换的语义(转哪个状态、加什么评论)由 prompt 定义,不由工具硬编码。agent 通过 prompt 知道该转什么状态、加什么评论。

**备选:** 封装高级工具如 `jira_transition_to_done`、`jira_add_comment`——更易用但把业务逻辑固化到工具层,违背 Symphony "logic lives in the workflow prompt" 原则。

### 决策 4:prompt 模板区分代码任务与非代码任务的 Jira 回写流程
**选择:** 在 `WORKFLOW.md.example` 的 prompt body 中定义两条路径:

**代码任务**(工作区有 git 仓库):
1. 完成代码修改 → commit → push
2. 用 `jira_rest` 转状态为 review 交接态(配置项 `tracker.review_state`,默认 "待审核")
3. 用 `jira_rest` 添加评论:变更摘要 + PR 链接(如有)+ 文件列表
4. 用 `jira_rest` 添加标签 `needs-review`
5. **不直接转"完成"**——等人工 review + merge 后由人工转"完成"

**非代码任务**(文档、调研等):
1. 完成工作
2. 用 `jira_rest` 添加评论:工作摘要 + 产出文件
3. 用 `jira_rest` 直接转"完成"

**理由:** Symphony §11.5:"Workflow-specific success often means 'reached the next handoff state' rather than tracker terminal state `Done`." 代码任务需要人工 review,不能自动完成;非代码任务可直接完成。prompt 模板用 `attempt` 区分首次/重试(§12.3)。

### 决策 5:新增 `tracker.review_state` 配置项
**选择:** 在 `tracker` 配置块新增 `review_state`(可选,默认 `null`),prompt 模板渲染时传入,agent 据此知道转哪个交接态。

**理由:** 不同团队 review 状态名不同(如 "待审核"、"In Review"、"Code Review")。配置化比硬编码灵活。`null` 时 prompt 提示 agent 不自动转 review 态,只添加评论等待人工处理。

## Risks / Trade-offs

- **[风险] workspace 级 `.opencode/opencode.json` 与用户已有配置冲突** → 若用户已在工作区 `.opencode/` 有配置,注入会覆盖。**缓解:** 注入前检查是否已存在,已存在则合并 MCP 配置而非覆盖整个文件。
- **[风险] MCP server 脚本路径在 npx 分发时找不到** → `node <dist>/mcp/jira-server.js` 需要知道 tasking 安装路径。**缓解:** 使用 `__dirname` 相对路径或 `process.execPath` 推导;npm 包 `files` 字段加入 `dist/mcp/`。
- **[风险] Jira transition ID 因部署不同而不一致** → transition 的 `id` 是 Jira 内部的,不同部署不同。**缓解:** prompt 里让 agent 先 `GET /issue/{key}/transitions` 查可用 transitions,再选对应名称的 id 执行。不硬编码 id。
- **[权衡] 暴露原始 REST 而非高级语义工具** → agent 需要知道 Jira REST API 的路径。接受:通过 prompt 指导,比硬编码更灵活。
- **[权衡] 不自动 merge PR** → 代码任务需要人工 review + merge。接受:这是安全设计,遵循 Symphony 的"handoff state"理念。
