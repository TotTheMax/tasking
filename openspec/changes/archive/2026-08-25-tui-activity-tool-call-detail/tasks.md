## 1. 捕获层（worker）

- [x] 1.1 TDD：扩展 `OpencodeEvent` 接口并让 `parseOpencodeLine` 从 `tool_use` 的 `part.state` 提取执行详情（`title`/`input`/`output`/`exit`/`status`/`durationMs`）——先在 `tests/worker.test.ts` 写红（场景：tool_use 执行详情被捕获、非零退出码、state 缺失降级），再实现。
- [x] 1.2 TDD：`runAttempt` 的 `onActivity` 透传把新详情字段复制进 `ActivityEvent`——在 `tests/worker.test.ts` 断言 activity 事件携带详情字段（先红后绿）。

## 2. 数据模型（ActivityStore）

- [x] 2.1 TDD：扩展 `ActivityEvent` 接口（新增可选 `title`/`input`/`output`/`exit`/`status`/`durationMs`），并断言 `record`/`recent` 原样保留详情字段——在 `tests/activity-store.test.ts` 先红后绿。

## 3. TUI 渲染（terminal-dashboard）

- [x] 3.1 TDD：`formatActivity` 列表行对 `tool_use` 渲染 `🔧 <工具> · <摘要>`（`title` 优先，其次 `input.command`/`filePath`，最后回退工具名），按终端宽度截断——在 `tests/terminal-dashboard.test.ts` 先红后绿。
- [x] 3.2 TDD：`exit` 非 0 时列表行以 `✗` 警示色渲染——先红后绿。
- [x] 3.3 TDD：`formatActivityDetail`/`getActivityDetailBody` 对 `tool_use` 渲染结构化详情块（状态/退出码高亮、工具名、参数区 bash `command` 原样/其余 JSON、输出区、耗时），详情字段缺失时隐藏对应行——先红后绿。
- [x] 3.4 TDD：详情输出区大输出截断（超过 100 行仅显示末尾并加 `… (N more lines)`；`metadata.truncated` 追加 `… (opencode truncated)`）——先红后绿。

## 4. HTTP API

- [x] 4.1 TDD：`tests/observability.test.ts` 断言 `/api/v1/<id>/activity` 透出新增详情字段（同源模型，后端无改动，仅测试覆盖）。

## 5. 文档与门禁

- [x] 5.1 同步 `docs/usage.md` 与 `docs/architecture.md`（`docs/zh/` 与 `docs/en/` 双语）中 activity 视图对工具调用详情的描述。
- [x] 5.2 跑完整门禁：`npm run lint`、`npm run typecheck`、`npm test`（含 `tests/worker.test.ts`、`tests/observability.test.ts`、`tests/terminal-dashboard.test.ts`）、`npm run build` 全部通过。
- [x] 5.3 提交代码与 `openspec/changes/tui-activity-tool-call-detail/` 到 `feature/TAS-24-tui-activity-tool-detail` 分支并推送，创建 GitLab MR。
