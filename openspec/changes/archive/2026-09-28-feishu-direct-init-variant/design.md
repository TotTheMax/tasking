# Design: feishu-direct init 变体

## Context

变体机制现状：三变体 × 双语 = 六份模板，选择轴是 **prompt body**（default/code-mr/grill-openspec 分别定义 agent 的工作方式）；`detectWorkflow` 用哨兵标记三路探测；`skillsForWorkflow` 按变体定技能集。Change ① 引入 `tracker.kind: none` 后，直连专用部署需要一个生成入口。关键事实：**直连会话没有 Liquid 模板**（ADR 0022：用户消息即 prompt），因此在直连专用部署里变体轴塌缩——没有东西可供"工作流变体"去变化。这决定了 `feishu-direct` 是第 4 个变体而非新正交轴（`--source feishu × code-mr` 这类组合无意义，不能有意义组合的轴不该正交）。

## Goals / Non-Goals

**Goals:**
- `tasking init --workflow feishu-direct`（或交互选择）产出可直接运行的直连专用 WORKFLOW.md。
- 现有三变体行为零变化；语言轴、`--update` 漂移、agents catalog、DEFAULTS 覆盖等既有模板守卫全部自然延伸到新模板。

**Non-Goals:**
- 不做交互式 projects 收集（今天 init 也不问；模板留注释示例，用户改文件）。
- 不改现有三变体的模板内容与问答流。
- 不含 Change ① 的运行时语义（依赖其先行落地）。

## Decisions

### 1. 第 4 变体 `feishu-direct`（Q7 定案）
`SUPPORTED_WORKFLOWS` 增加枚举值；`WorkflowVariant` 类型扩展；`resolveExampleFile` 增加两文件映射（zh/en）；`normalizeWorkflow` 接受新值。`detectWorkflow` 四路探测：`FEISHU_DIRECT_MARKER` → `GRILL_MARKER` → `CODE_MR_MARKER` → default 兜底（新哨兵最优先，避免与 default 最小 body 混淆——新模板 body 沿用 default 正文，必须靠哨兵区分）。

### 2. 模板形态（Q7 + C 定案：全量注释）
- **tracker 块**：`kind: none` 生效 + **全量 Jira 字段注释**（endpoint/api_key/api_user/auth_mode/review_state/project_key/assignee/required_labels/active_states/terminal_states，同 default 模板）+ 头部注释"直连专用部署未启用 Jira 源；如需启用：改 `kind: jira` 并填写以下字段"。理由：用户看不到源码，WORKFLOW.md 是唯一配置参考。
- **feishu 块**：`enabled: true`、app_id/secret/intake（`$VAR` 引用）、direct 段完整注释（projects 对象/字符串两形态示例、path_roots、auto_approve、verbosity、max_concurrent、idle_ttl_ms）。
- **prompt body**：沿用 default 最小正文 + 顶部注释"直连会话以用户消息为 prompt；此 body 在启用 Jira 源后生效"。
- **哨兵**：`<!-- tasking-workflow: feishu-direct -->` 置于 prompt body 顶部。

### 3. 交互流裁剪（B 定案）
选择 `feishu-direct` 时：跳过 Jira 凭据三问与连接测试；跳过 "Enable Feishu bridge" 选择（`enabled: true` 烘焙——该变体里飞书就是全部）；跳过 issue types 问答（无 Jira 可查）；仅问 app_id/app_secret/intake_chat_id（复用现有 Feishu 问答）。glab/GitLab 检查跳过（无技能依赖）。

### 4. 技能集：空（同 default）
`skillsForWorkflow("feishu-direct")` 返回 `[]`——`land`/`install-glab`/opsx 系全部是 Jira 路径向。`--update` 技能同步逻辑自然处理（无技能可同步）。

### 5. 模板守卫延伸
`tests/en-templates.test.ts` PAIRS 扩为四对：zh/en Liquid 表达式对齐、协议哨兵按变体、`DEFAULTS.feishu` 键覆盖、`feishu.direct` 空配置解析、agents catalog（`opencode.agents: []` + 注释）、"zh 模板与提交版字节一致"守卫自动生效。`tests/prompt.test.ts` 新模板 body 渲染断言。

## Risks / Trade-offs

- **模板即文档的维护成本**：全量 Jira 注释意味着 default 模板的字段注释更新需同步 feishu-direct（四变体 × 双语 = 八份）。缓解：注释块结构一致，en-templates 的 DEFAULTS 覆盖测试会抓漂移；字段级注释变更本就少见。
- **变体语义放宽**：Workflow 定义从"仅 prompt body 有别"放宽为"feishu-direct 另定任务源"（CONTEXT.md 已同步）。后来者可能误以为可以随意加"配置型变体"——ADR 0026 与 CONTEXT.md 词条已声明这是特例（直连无模板使变体轴塌缩）。
- **依赖顺序**：实现必须在 Change ① 之后（`kind: none` 语义先存在），否则模板生成的配置无法启动。
