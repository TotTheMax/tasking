## 1. readline 问答基础设施

- [x] 1.1 创建 `src/cli/prompts.ts`：封装 `readline/promises` 的 `ask(question: string, defaultValue?: string): Promise<string>` 工具函数
- [x] 1.2 实现 `askSelect(question: string, options: string[]): Promise<string>` 用于 auth_mode 选择（basic/bearer）

## 2. Jira 状态拉取

- [x] 2.1 在 `src/adapters/jira/tracker.ts` 新增 `fetchProjectStatuses(): Promise<string[]>` 方法，调 Jira `/project` 或 `/statuses` API 拉取项目状态列表
- [x] 2.2 编写测试：mock Jira API 返回状态列表

## 3. 交互式 init 流程

- [x] 3.1 重写 `src/cli/init.ts` `runInit`：检测 `process.stdin.isTTY`，是 TTY 且非 `--non-interactive` 时走交互式流程
- [x] 3.2 实现凭据问答：endpoint → api_key → auth_mode（select）→ api_user（条件）→ project_key，api_key 写入 `$JIRA_API_KEY` 引用
- [x] 3.3 问答完成后用凭据实例化 `JiraTracker`，调 `fetchProjectStatuses()` 测试连接（5s 超时），成功打印状态列表，失败打印错误不阻断
- [x] 3.4 检查 `opencode` 安装（`which opencode`），找不到打印警告不阻断
- [x] 3.5 生成 WORKFLOW.md：填入问答结果，其余用 WORKFLOW.md.example 默认值
- [x] 3.6 尝试打开编辑器：`$VISUAL` → `$EDITOR` → `code`，spawn detached + stdio ignore，全失败则打印路径
- [x] 3.7 打印完成提示：列出需手动编辑的字段（active_states、terminal_states、review_state、after_create）

## 4. 非交互模式

- [x] 4.1 `--non-interactive` 标志或 stdin 非 TTY 时，复制 WORKFLOW.md.example（当前行为）
- [x] 4.2 `src/cli/index.ts` 更新 `init` 子命令参数解析，支持 `--non-interactive`

## 5. 测试

- [x] 5.1 编写 `tests/init.test.ts`：交互式流程（mock stdin/stdout，验证凭据写入 $JIRA_API_KEY、api_user 条件问答、auth_mode 选择）
- [x] 5.2 测试 Jira 连接成功：打印状态列表
- [x] 5.3 测试 Jira 连接失败：打印错误仍生成配置
- [x] 5.4 测试 opencode 未安装：打印警告
- [x] 5.5 测试非交互模式：直接复制 example
- [x] 5.6 测试 `--force` 覆盖

## 6. 验证

- [x] 6.1 运行 `npm run lint && npm run typecheck && npm test` 全绿
- [x] 6.2 更新 `docs/usage.md` 的 `tasking init` 命令文档
