## ADDED Requirements

### Requirement: 可选 agent 目录配置
配置 SHALL 在 `opencode` 块提供可选 `agents` 字段（字符串数组），作为已知 opencode agent profile 的咨询性目录。`opencode.agent`（默认 `build`）SHALL 始终作为兜底默认 agent。`agents` 缺省或为空数组时，SHALL 不对 agent 名做任何校验（任何 `agent:<name>` 值直通）。`agents` 非空时，SHALL 供 `/agent` 命令展示并对未知名产出友好提示。`agents` 不 SHALL 作为硬白名单阻止派发。

#### Scenario: 缺省 agents 不校验
- **WHEN** `opencode.agents` 未配置或为空数组
- **THEN** 任何 `agent:<name>` 标签的 name 直通使用，不做已知性校验

#### Scenario: agents 非空时展示并提示
- **WHEN** `opencode.agents` 为 `["build", "review"]`
- **THEN** `/agent` 命令展示该目录，且对不在目录中的 agent 名产出友好提示

#### Scenario: agent 字段始终为兜底默认
- **WHEN** 任务无 `agent:` 标签
- **THEN** 使用 `opencode.agent` 作为该任务的 agent

### Requirement: agent label 命名空间约定
per-task agent SHALL 由 Jira issue 上的 `agent:<name>` 标签指定（`agent:` 为保留前缀）。该标签 SHALL 是 per-task agent 的唯一事实源——创建时设定、派发时读取、运行中切换均操作此同一标签。`agent:` 前缀 SHALL 不与 `required_labels` 派发门冲突（agent 标签不影响派发资格）。

#### Scenario: agent 标签指定 per-task agent
- **WHEN** 某 issue 有标签 `agent:review`
- **THEN** 该任务解析出的 agent 为 `review`（而非默认 `build`）

#### Scenario: 无 agent 标签回退默认
- **WHEN** 某 issue 无任何 `agent:` 前缀标签
- **THEN** 该任务使用 `opencode.agent` 默认值

#### Scenario: agent 标签不影响派发资格
- **WHEN** 某 issue 有 `agent:review` 但不含 `required_labels` 中的某标签
- **THEN** 该任务派发资格仅由 `required_labels` 判定，`agent:` 标签不参与门禁

### Requirement: agent 解析规则
SHALL 存在单一纯函数 `resolveAgent(task, config)`，被 worker（每 turn）与 bridge（`/agent` 列表）共享调用。解析 SHALL：从 `task.labels` 中查找 `agent:` 前缀标签并取冒号后的 name；未找到则返回 `opencode.agent`。`opencode.agents` 非空时，SHALL 对 name 与目录项做大小写不敏感匹配，匹配成功 SHALL 使用目录项的原始大小写作为 `--agent` 值；name 不在目录中时 SHALL 标记警告但仍回退默认 agent（不抛错、不阻止派发）。`opencode.agents` 为空时 SHALL 将 name 原样（已被 `normalizeLabels` 小写化）作为 `--agent` 值。多个 `agent:` 标签时 SHALL 确定性地取第一个匹配。

#### Scenario: 标签命中目录用目录大小写
- **WHEN** `opencode.agents` 为 `["Build", "Review"]` 且任务标签含 `agent:review`
- **THEN** 解析出的 agent 为 `Review`（目录原始大小写）

#### Scenario: 标签未在非空目录中则警告并回退
- **WHEN** `opencode.agents` 为 `["build"]` 且任务标签含 `agent:foo`
- **THEN** 解析产出警告，agent 回退为 `opencode.agent` 默认值，不阻止派发

#### Scenario: 空目录原样取标签值
- **WHEN** `opencode.agents` 为空且任务标签含 `agent:review`
- **THEN** 解析出的 agent 为 `review`（标签值，已小写化）

### Requirement: 飞书 /agent 命令（列表）
飞书桥 SHALL 支持 `/agent` 命令（无参）。在 intake 群中，SHALL 回复当前默认 agent（`opencode.agent`）与 `opencode.agents` 目录（为空时提示未配置目录）。在已绑定 issue 的话题内，SHALL 额外回复该任务当前解析出的 agent（由 `resolveAgent` 从该 issue 的标签与配置算出）。`/agent` SHALL 不变更任何状态或标签。

#### Scenario: intake 群列默认与目录
- **WHEN** 在 intake 群发送 `/agent` 且 `opencode.agents` 为 `["build", "review"]`、`opencode.agent` 为 `build`
- **THEN** 回复列出默认 `build` 与目录 `build`、`review`

#### Scenario: intake 群未配置目录
- **WHEN** 在 intake 群发送 `/agent` 且 `opencode.agents` 为空
- **THEN** 回复默认 agent 并提示未配置 agent 目录

#### Scenario: 话题内显示任务当前 agent
- **WHEN** 在已绑定 `agent:review` issue 的话题内发送 `/agent`
- **THEN** 回复含该任务当前解析出的 agent `review`（及默认与目录）

### Requirement: 飞书 /agent <name> 命令（运行中切换）
飞书桥 SHALL 支持在已绑定 issue 的话题内发送 `/agent <name>` 切换该任务的 agent。SHALL 通过读-改-写更新该 issue 的标签：保留全部既有标签，移除任何现存 `agent:` 前缀标签，加入 `agent:<name>`。SHALL 回复确认并说明切换在下一 turn 边界生效（当前 turn 不中断）。在 intake 群发送 `/agent <name>` SHALL 回复提示该命令需在任务话题内使用。`/agent default` 或 `/agent -` SHALL 清除 `agent:` 标签（回退默认）。

#### Scenario: 话题内切换更新标签
- **WHEN** 在已绑定 issue 话题内发送 `/agent review` 且 issue 现有标签为 `["bug", "agent:build"]`
- **THEN** issue 标签变为 `["bug", "agent:review"]`，回复确认下一 turn 生效

#### Scenario: 切换保留无关标签
- **WHEN** 切换 agent 时 issue 有标签 `["ops", "agent:build"]`
- **THEN** `ops` 标签保留，仅 `agent:` 前缀标签被替换

#### Scenario: intake 群切换被拒
- **WHEN** 在 intake 群发送 `/agent review`
- **THEN** 回复提示 `/agent <name>` 需在任务话题内使用

#### Scenario: 清除回退默认
- **WHEN** 在话题内发送 `/agent default` 且 issue 有 `agent:review`
- **THEN** 移除 `agent:review` 标签，任务回退到 `opencode.agent` 默认

### Requirement: 飞书 /issue --agent 创建时指定
飞书 `/issue` 命令 SHALL 支持 `--agent <name>` 选项（与现有 `--type` 平行）。创建 issue 时 SHALL 在 labels 中加入 `agent:<name>`（与 `required_labels` 合并）。`--agent` 缺省时 SHALL 不加 `agent:` 标签（沿用默认 agent）。`--agent <name>` 中 name 不在非空 `opencode.agents` 目录时 SHALL 在创建回复中给出友好提示但 SHALL 仍创建并打标签。

#### Scenario: 创建时指定 agent 打标签
- **WHEN** 发送 `/issue 标题\n描述 --agent review`
- **THEN** 创建的 issue labels 含 `agent:review`

#### Scenario: 未指定 agent 不打标签
- **WHEN** 发送 `/issue 标题\n描述`（无 `--agent`）
- **THEN** 创建的 issue 不含 `agent:` 标签

#### Scenario: 未知 agent 仍创建并提示
- **WHEN** `opencode.agents` 为 `["build"]` 且发送 `/issue 标题\n描述 --agent foo`
- **THEN** issue 仍被创建并含 `agent:foo` 标签，回复含未知 agent 提示
