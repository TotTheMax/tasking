## 1. jira_rest MCP server

- [x] 1.1 实现 `src/mcp/jira-server.ts`:stdio JSON-RPC server,处理 `initialize`/`tools/list`/`tools/call` 三个方法
- [x] 1.2 `tools/list` 返回 `jira_rest` 工具声明(name、description、inputSchema 含 method/path/body)
- [x] 1.3 `tools/call` 对 `jira_rest` 执行 Jira REST 调用:从 env vars 读 endpoint/auth_mode/api_key/api_user,构造 Authorization header,发 fetch 请求,返回响应
- [x] 1.4 错误处理:Jira 非 2xx 返回 `{ success: false, status, error }` 给 agent,不崩溃;未知工具名返回错误,不崩溃
- [x] 1.5 测试:MCP server 的 `tools/list` 返回正确声明、`tools/call` 执行 Jira 调用并返回结果、非 2xx 返回错误

## 2. workspace 级 MCP 配置注入

- [x] 2.1 实现 `src/mcp/inject.ts`:`injectMcpConfig(workspacePath, trackerConfig)` 向 `<workspace>/.opencode/opencode.json` 写入 `jira` MCP server 配置
- [x] 2.2 凭据通过 `env` 字段注入(`JIRA_ENDPOINT`/`JIRA_AUTH_MODE`/`JIRA_API_KEY`/`JIRA_API_USER`),`$VAR` 在注入前解析
- [x] 2.3 MCP server 脚本路径用 `__dirname` 相对路径推导(指向 `dist/mcp/jira-server.js`)
- [x] 2.4 若工作区已存在 `.opencode/opencode.json`,合并 `mcp.jira` 配置而非覆盖整个文件
- [x] 2.5 测试:注入后文件存在且含正确 MCP 配置、已有配置被合并而非覆盖、凭据 env vars 正确解析

## 3. runAttempt 集成注入

- [x] 3.1 在 `src/worker/runner.ts` `runAttempt` 中,`createWorkspace` 后、spawn 前调用 `injectMcpConfig`
- [x] 3.2 注入使用 `config.tracker`(EffectiveConfig 中的 tracker 配置)
- [x] 3.3 测试:`runAttempt` 执行后工作区存在 `.opencode/opencode.json` 含 jira MCP 配置

## 4. 新增 tracker.review_state 配置项

- [x] 4.1 在 `TrackerConfig` 新增 `review_state: string | null`(可选,默认 null)
- [x] 4.2 在 `resolveTracker` 解析 `review_state`(从 WORKFLOW.md front matter 读取)
- [x] 4.3 在 `DEFAULTS.tracker` 不设默认(保持 null,表示未配置)
- [x] 4.4 测试:配置 `review_state: "待审核"` 时 resolver 正确解析、未配时为 null

## 5. 优化 WORKFLOW.md prompt 模板

- [x] 5.1 在 `src/cli/init.ts` 的 starter WORKFLOW prompt body 中加入 `jira_rest` 使用指南(API 路径示例)
- [x] 5.2 加入代码任务流程:完成代码 → commit/push → 查 transitions → 转 review 交接态 → 加评论(变更摘要+PR链接)→ 加 `needs-review` 标签 → 不直接完成
- [x] 5.3 加入非代码任务流程:完成工作 → 加评论(工作摘要)→ 直接转完成
- [x] 5.4 加入"先查 transitions 再转状态"指示(不硬编码 transition id)
- [x] 5.5 加入跟踪信息指示:评论附变更摘要/PR链接/demo说明、加标签(`needs-review`/`agent-done`)
- [x] 5.6 根据 `attempt` 区分首次(完整指令)与重试(检查工作区状态继续)的 prompt
- [x] 5.7 更新 `WORKFLOW.md.example` 反映新 prompt 模板
- [x] 5.8 测试:prompt 模板渲染后包含 jira_rest 用法、代码/非代码任务两条路径、attempt 区分

## 6. package.json 与分发

- [x] 6.1 `files` 字段加入 `dist/mcp/`(确保 MCP server 脚本纳入 npm 包)
- [x] 6.2 验证 `npm publish --dry-run` 包含 `dist/mcp/jira-server.js`

## 7. 文档更新

- [x] 7.1 `docs/configuration.md` 新增 `tracker.review_state` 字段说明
- [x] 7.2 `docs/usage.md` 新增 `jira_rest` 工具说明(agent 如何用、自动注入机制)
- [x] 7.3 `docs/architecture.md` 补充 tracker 写边界说明(agent 通过 jira_rest 写,编排器只读)
- [x] 7.4 `AGENTS.md` 追加 jira_rest 工具说明

## 8. 集成测试

- [x] 8.1 端到端:runAttempt → 注入 .opencode/opencode.json → mock opencode run 启动 → 验证 MCP 配置存在
- [x] 8.2 agent 转 review 态后 tasking retry 停止派发(mock tracker 返回非活跃状态)
- [x] 8.3 agent 转完成后 tasking reconcile 清理工作区(mock tracker 返回终端状态)
- [x] 8.4 已有 .opencode/opencode.json 时不覆盖已有配置(合并测试)

## 9. 全量验证

- [x] 9.1 `npm run lint && npm run typecheck && npm test` 全部通过
- [x] 9.2 `npm run build` 后 `node dist/cli/index.js --help` 正常
- [x] 9.3 `npm publish --dry-run` 包含 `dist/mcp/` 且无密钥
