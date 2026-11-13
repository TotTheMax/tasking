## Why

opencode v2 没有"最近使用"回退：每个 turn 的模型解析为 会话显式值 → opencode 配置默认 → 最新可用模型。tasking 未配置 `opencode.model` 时创建会话不传 model、续轮也不重新应用，于是 (a) 全链路（日志/TUI/sidecar）只显示配置值 null，没人知道实际跑了什么模型；(b) 同一任务相邻 turn 可能因目录刷新/配置变更悄悄换模型（模型漂移），且不可见。另外用户在 init 时从未被引导配置模型，未配置这个坑是隐形的。

## What Changes

- **解析模型读回**：`session.create`/`session.get` 响应中的 `model` 字段读入 `SessionInfo`，turn 结果携带该值；零额外 API 调用（`session.get` 本就每 poll 调用）。
- **观测落地**：worker 日志 `launching opencode v2 turn` 与 direct 日志 `direct turn starting` 增加 `resolved_model`；首轮 prompt 后经事件刷新调度器条目，TUI/HTTP dashboard 的 Model 字段显示实际解析值；sidecar `.tasking-session.json` 增加 `resolved_model`（向后兼容读旧文件）。
- **漂移告警**：同一 opencode 会话相邻 turn 的解析模型不一致时打一条 `warn`（带 task/session 与 A→B），变化一次告警一条；worker 与 direct 两条路径都启用。
- **doctor 新增"模型解析"检查项**：未配置 → 探测 `model.default` 显示实际解析值并 **warn** 漂移风险；已配置 → 显示配置值并经 `model.list` 校验存在性，失效 **fail**；opencode 不可达 → **info** 降级。
- **init 模型选择**：交互式 init 在凭据类问题汇合后新增模型问题——跟随服务端默认（实时显示解析值与漂移风险）/ 关键词搜索选择（子序列模糊匹配、免费标签、空回车列最近发布 top 20）/ 手动输入 `provider/model`；选中写入 `opencode.model`，选"跟随"写 `null`。等待期 spinner 附教育性提示（双语）；探测 15s 超时降级为手输/跳过，init 不因探测失败而挂。
- **`--model <provider/model>` flag**：与 `--workflow`/`--lang` 预答惯例一致，仅格式校验（须含 `/`）。
- **非交互与 `--update`**：非交互安装跳过问题、不写 model（显式 `--model` 时除外，非 BREAKING）；`--update` 绝不触碰用户已配置的 `opencode.model`。
- **领域与决策记录**：CONTEXT.md 新增 `Model resolution` 术语（Configured model/Resolved model/Model drift）；ADR 0039 记录"init 显式选择 + 观测，优先于运行时钉住"及 opencode v2 解析规则考据。
- 不做：飞书轮次卡片的模型字段（回路测试成本高，TUI 已覆盖）；variant 追问（文档指路手填）；运行时软钉住。

## Capabilities

### New Capabilities

（无——全部为既有 capability 的需求变更）

### Modified Capabilities

- `opencode-v2-driver`: 会话操作读回解析模型，turn 结果携带解析模型，漂移判定以 turn 级相邻比对为准
- `opencode-worker`: worker 日志与事件链携带解析模型；相邻 turn 解析模型变化时告警
- `structured-scheduler`: 任务条目的 model 状态在 turn 进行中由解析事件刷新（显示实际值而非配置值）
- `direct-sessions`: direct 路径日志携带解析模型；相邻 turn 解析模型变化时告警
- `workspace-management`: session sidecar 记录 `resolved_model`，读取兼容无该字段的旧文件
- `feishu-setup-doctor`: 新增模型解析检查项（未配置 warn / 配置失效 fail / 不可达 info）
- `interactive-init`: 新增模型选择问题（搜索/降级/双语）与 `--model` 预答 flag

（`init-update` 不列入：`--update` 既有需求"不写 WORKFLOW.md，只报告漂移"已保证不改写 `opencode.model`，本次仅补回归测试。）

## Impact

- 代码：`src/driver/session-ops.ts`、`src/driver/turn-driver.ts`、`src/worker/runner.ts`、`src/scheduler/scheduler.ts`、`src/direct/{manager,driver}.ts`、`src/workspace/manager.ts`（sidecar）、`src/cli/{init,doctor,prompts}.ts`、`src/cli/help.ts`（`--model`）
- fixtures：新增 `tests/fixtures/opencode-v2/rest/model-list.json`、`model-default.json`（本机 `opencode-v2` wrapper v2.0.29 采集，provenance: captured）
- 测试：`tests/driver-session-ops.test.ts`、`tests/worker.test.ts`、`tests/direct-sessions.test.ts`、`tests/scheduler.test.ts`、`tests/workspace.test.ts`、`tests/cli.test.ts`/`tests/cli-commands.test.ts`、`tests/init.test.ts` 及 doctor 相关
- 文档：`docs/{zh,en}/configuration.md`（模型解析规则）、`docs/{zh,en}/usage.md`（doctor 项）、`docs/{zh,en}/getting-started.md`（init 模型选择）、README、`CONTEXT.md`、`docs/adr/0039-model-selection-observability-over-runtime-pinning.md`（双语 docs-links 门禁）
- 门禁：lint/typecheck/`npm test` 全绿；不触飞书/Jira 适配器，e2e 硬门禁不强制但随全量执行；无 BREAKING，`WORKFLOW.md` 配置面不变（`model` 键语义不变）
