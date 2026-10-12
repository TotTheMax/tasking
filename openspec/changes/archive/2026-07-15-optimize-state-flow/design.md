## Context

Symphony 的状态流转基于三层状态桶，review 反馈有两条路径：

| 桶 | Symphony 状态 | 调度器行为 | 工作区 |
|---|---|---|---|
| **active** | Todo, In Progress, Merging, Rework | 轮询 + 派发 + 续轮 | 保留 |
| **neither（隐式 review）** | Human Review | 停止 worker | 保留 |
| **terminal** | Done, Closed, Cancelled | 停止 worker | 清理 |

### Symphony 的双路径 review 处理

人 review 后把 issue 移到哪个状态决定路径：

- **人移回 `Todo`（PR 还开着）** → 增量修复（`WORKFLOW.md:110, 124, 170-184, 238-241`）
  - agent 被重新派发（Todo 在 active_states）
  - 扫 PR 评论 → 逐条处理或回复 → push 到**同一分支** → 验证 → 转回 `Human Review`
  - 不关 PR、不换分支

- **人移到 `Rework`** → 全量重置（`WORKFLOW.md:252-262`）
  - agent 被重新派发（Rework 在 active_states）
  - 关旧 PR → 删旧 workpad → 从 `origin/main` 创**新分支** → 从头来
  - "full approach reset, not incremental patching"

两条路都可循环多轮，直到人 approve → 移到 `Merging` → agent 跑 `land` → `Done`。

### tasking 对应配置

```yaml
active_states:
  - 待办        # 初始态 / 增量修复入口（PR 还在时）
  - 处理中      # 工作中态
  - 合并中      # 合并态（land 技能）
  - 返工        # 全量重置态
terminal_states:
  - 完成
# 代码评审中 不放任何列表 → 隐式 review 态
```

tasking 的调度器 `reconcileTrackerStates`（`scheduler.ts:509-529`）已实现三分支，`trackerStateChecker`（`scheduler.ts:259-264`）已支持 worker 停止。无需改调度器代码——只改模板和技能。

约束：
- Liquid 引擎不支持 `for` 循环，状态名需预 join
- `review_state` 已在上一个变更中移除，不重新引入——review 态是隐式的
- 状态名是 Jira 部署特定的，模板不能硬编码具体中文名

## Goals / Non-Goals

**Goals:**
- 模板有明确的 State Flow 小节，用 `{{ active_states }}` 和 `{{ terminal_states }}` 解释三层模型 + 双路径 review
- workflow 步骤在每一步加入显式状态转换指引，区分增量修复和全量重置
- front matter 示例推荐 4 状态配置（含返工态）
- jira 技能补充 State Flow 说明
- 测试覆盖 state flow 渲染

**Non-Goals:**
- 不改调度器逻辑（三分支已实现）
- 不重新引入 `review_state` 配置字段
- 不改 Liquid 引擎
- 不硬编码具体状态名（用注入的配置值）

## Decisions

### D1: 注入 active_states 到 RenderContext

**选择**：`RenderContext` 新增 `active_states: string`（预 join 逗号分隔字符串），与已有 `terminal_states` 配合。

```typescript
export interface RenderContext {
  task: Task;
  attempt: number | null;
  terminal_states: string;
  active_states: string;
}
```

`runner.ts` 调用 `renderPrompt` 时从 `config.tracker.active_states.join(", ")` 传入。

**理由**：agent 需要知道哪些状态是 active（它会在这些状态下被派发），才能理解完整流转和判断自己在哪条路径上。

### D2: 模板新增 State Flow 小节（含双路径）

**选择**：在 prompt body 的 Skills 小节后、Workflow 小节前，新增 State Flow 小节：

```
## State Flow

Three state buckets control how the scheduler manages your task:

- **Active** ({{ active_states }}): The scheduler dispatches agents in these states.
  Includes initial state, in-progress state, merging state, and rework state.
- **Review** (neither active nor terminal): Transition here after creating MR. The scheduler
  stops your worker but preserves the workspace. Wait for human review.
- **Terminal** ({{ terminal_states }}): The scheduler cleans the workspace.

### Flow

1. Start (active) → transition to in-progress state (active) before working
2. Create MR, sweep feedback, CI green → transition to review state (neither)
3. Human reviews — two paths:
   - **Incremental fix**: human moves back to initial active state (PR still open) →
     you get re-dispatched → fix on same branch → push → sweep → back to review
   - **Full reset**: human moves to rework active state → you get re-dispatched →
     close old MR, new branch from origin/main, start over → back to review
4. Human approves → moves to merging active state → you get re-dispatched →
   run `land` skill → merge → transition to terminal state
```

**理由**：参照 Symphony 的状态图 + 双路径 review 处理，用配置注入的状态名解释三层模型，不硬编码具体名称。

### D3: workflow 步骤加入显式状态转换（含双路径分支）

**选择**：重写代码任务步骤，在每步加入状态转换指引，review 反馈区分增量/重置：

```
### For code tasks:
1. Use `jira` skill: transition from current state to an in-progress active state
2. Use `pull` skill to sync branch
3. Make code changes
4. Use `commit` skill to commit
5. Use `push` skill to create MR
6. Sweep MR feedback, ensure CI is green
7. Use `jira` skill: transition to a review state (neither in {{ active_states }} nor {{ terminal_states }}), add comment, add `needs-review` label
8. Your worker will stop. Workspace is preserved.

When re-dispatched from review (human moved your task):
- If back to initial active state (PR still open) → **incremental fix**: read Jira comments,
  fix on same branch, push, sweep, transition back to review state
- If to rework active state → **full reset**: close old MR, new branch from origin/main,
  start over, transition back to review state
- If to merging active state → run `land` skill to merge, then transition to terminal state
```

**理由**：参照 Symphony Step 0/2/3/4 的路由逻辑——agent 被重新派发时先看当前状态，再决定增量还是重置。

### D4: front matter active_states 示例更新

**选择**：`WORKFLOW.md.example` 的 `active_states` 示例从 `["To Do", "In Progress"]` 改为 `["待办", "处理中", "合并中", "返工"]`。

**理由**：
- 体现三层状态模型（初始态 + 工作中态 + 合并态 + 返工态都在 active）
- 与用户自托管 Jira 的中文状态名一致
- 注释说明：review 态（如"代码评审中"）不放在任何列表中
- 注释说明：人 review 后移到"返工"=全量重置，移回"待办"=增量修复

### D5: jira 技能补充 State Flow 小节

**选择**：在 `assets/skills/jira/SKILL.md` 新增 State Flow 小节，解释：
- 三层状态桶（active / neither / terminal）
- 双路径 review 处理（增量修复 vs 全量重置）
- agent 在每个阶段的转换职责
- 转换前先查 transitions、按名称选 id
- 代码任务不自行转 terminal

### D6: buildContinuationGuidance 更新

**选择**：续轮指引文本加入"检查当前 Jira 状态，根据所处状态决定是增量修复还是全量重置"的提示。

## Risks / Trade-offs

- **[active_states 注入增加模板复杂度]** → 预 join 字符串在模板中自然可读，Liquid 引擎无需改动
- **[front matter 示例改为中文状态名]** → 英文 Jira Cloud 用户需自行替换。注释中标注这是自托管示例，Cloud 用户用英文名
- **[模板变长]** → State Flow 小节约 20 行（含双路径），可接受——agent 需要这个上下文才能正确流转
- **[依赖用户正确配置 4 状态]** → 模板和文档需说清楚配置方法，否则流转不丝滑。如果用户没配"返工"态，全量重置路径不可用——模板需容忍此情况
- **[增量 vs 重置的判断由人决定]** → 模板不替 agent 决定走哪条路，而是根据人把 issue 移到哪个状态来路由——与 Symphony 一致
