## Why

opencode v2 删除了 `run` 的 `--dir`/`--variant` 标志、重写了 HTTP API 并改用共享后台服务架构——tasking 在 v2 机器上完全不可用（首个 turn 即以 "Unrecognized flag: --dir" 失败）。经 10 轮 spike 实验（见 spike 分支 `spike/opencode-v2-adaptation` 的 research.md 与 `tests/fixtures/opencode-v2/`），我们选定以 v2 原生 API（`opencode api` 命令 + 轮询）驱动 turn，并借此交付 v1 结构性做不到的**同步权限审批**。本变更**不兼容 opencode v1**（v1 支持冻结于 `support/v1` 分支，tasking 0.6.x）。

## What Changes

- **BREAKING** 不再支持 opencode v1；要求 `opencode >=2.0 <3`（大版本不符拒绝启动，未验证小版本警告放行）
- **BREAKING** worker 与直连会话的 turn 执行从"spawn `opencode run` 子进程 + stdout NDJSON 解析"改为 **api-CLI 驱动器**：`opencode api session.create/prompt` 提交、轮询 `session.get`/`session.permission.list`/`session.message.list` 取进度与终态、`session.interrupt` 中断；过程可见性从事件流变为轮询快照（间隔可配）
- **新能力：同步权限审批**——ask 权限挂起 → 飞书审批卡（允许一次/始终允许/拒绝）→ `session.permission.reply` 当场续跑；等待预算默认 30 分钟，超时自动拒绝并盖章
- 三层权限模型：工作区 `.opencode/opencode.json` 用户自有规则（tasking 只注入 `mcp.servers.jira` + `codemode:false`，不再写 permissions）→ 会话级 ruleset（`auto_approve: true` 注入全放；现有 perm/`perm_once`/`perm_on`/`/auto` 按钮与命令翻译为 `session.update` 放开/收回，可立即生效）→ 逐次审批卡
- MCP 注入改写为 v2 的 `mcp.servers` 格式；`--auto`/`--dir`/`--variant`/`--model` 拼装逻辑随 run 驱动一并退役
- 配置面：`opencode.command` 默认 `opencode`（旧值 `opencode run` 需手改）；新增 `opencode.poll_interval_ms`（2000）、`opencode.permission_timeout_ms`（1800000）、`opencode.server_url`（null=自动发现共享服务）；`model`+`variant` 保留双字段映射 `Model.Ref`
- 审批等待期间 `turn_timeout_ms`/`inactivity_timeout_ms` 暂停、`stall_timeout_ms` 感知等待态（不误杀）；daemon 重启对在飞会话执行 `session.active` 清扫 + `interrupt` + 正常重试
- usage 计费口径迁移：v2 tokens 无 `total`（`input/output/reasoning/cache`），合计口径重定义
- 测试：假 `opencode` CLI mock（fixtures 剧本）驱动全量单测/E2E；`@opencode/sdk` 契约层（devDep，验证硬编码 API 形状、服务于版本区间扩容）；真机冒烟并入 `INTEGRATION=1` 体系

## Capabilities

### New Capabilities
- `opencode-v2-driver`: 以 `opencode api` 命令驱动 turn 的执行内核——会话生命周期（create/prompt/interrupt/remove）、轮询循环（outcome/permission/message diff）、中断梯子（interrupt → 宽限 → 清理）、版本门禁（大版本拒绝/未验证警告/认证探活）、审批等待预算与计时器暂停规则、daemon 重启清扫
- `permission-approval`: 同步审批交互面——审批卡（允许一次/始终允许/拒绝、超时盖章、回访路径常驻可重判）、会话权限姿态（放开/仅一轮/收回，映射 `session.update`）、三层权限模型与 `auto_approve` 语义（false = ask 挂起而非自动拒绝）

### Modified Capabilities
- `opencode-worker`: turn 循环的执行层从子进程 spawn 换为 v2 驱动器调用；`Step usage` 计费口径改为轮询所得 tokens 之和；`auto_approve` 语义升级
- `direct-sessions`: 执行/中断/队列切换到驱动器（合并队列语义保持）；turn 卡片数据源改为轮询 diff；perm 按钮组翻译为会话姿态操作；审批卡投放到会话话题
- `task-activity`: 活动数据来源从 stdout 事件流改为轮询快照 diff；工具调用详情字段映射 v2 `content[]` 终态
- `structured-scheduler`: 停滞检测感知等待审批状态；daemon 重启清扫在飞会话
- `workflow-config`: `opencode` 配置段键变化（command 默认值、三新键、variant 映射、server_url）
- `feishu-setup-doctor`: opencode 项升级为版本门禁 + 服务探活 + 认证探测
- `workspace-management`: `.opencode/opencode.json` 注入改为 `mcp.servers.jira`（含 `codemode:false`），不写 permissions
- `terminal-dashboard`: 等待审批状态与倒计时展示
- `observability`: token/成本合计口径更新
