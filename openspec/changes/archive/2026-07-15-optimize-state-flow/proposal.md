## Why

当前 WORKFLOW.md.example 的 prompt body 缺少明确的状态流转指引——agent 不知道在任务开始、创建 MR、合并代码、完成时分别该转入哪个状态。Symphony 的流转模型（Todo → In Progress → Human Review → Merging/Done + Rework 双路径）通过三层状态桶（active / neither / terminal）实现了丝滑的任务生命周期，其中 review 反馈有两条路：增量修复（人移回初始态，PR 还在 → 同分支改）和全量重置（人移到返工态 → 关 MR、新分支、从头来）。tasking 的模板没有把这个流程说清楚。

## What Changes

- 扩展 `RenderContext`，注入 `active_states`（预 join 逗号分隔字符串），与已有的 `terminal_states` 配合，让模板能同时显示两类状态名称。
- 在 `WORKFLOW.md.example` prompt body 中新增 **State Flow** 小节，参照 Symphony 的流转模型，用配置注入的状态名解释完整生命周期（含双路径 review 处理）：
  - **active 状态**（`{{ active_states }}`）：调度器在这些状态下会派发/续轮 agent。包含初始态（如"待办"）、工作中态（如"处理中"）、合并态（如"合并中"）、返工态（如"返工"）。
  - **review 状态**（既不 active 也不 terminal）：agent 创建 MR 后转入此态，调度器停止 worker 但保留工作区。等人决定下一步。
  - **terminal 状态**（`{{ terminal_states }}`）：调度器清理工作区。
- 重写 workflow 步骤，在每一步加入显式状态转换指引，**含双路径 review 处理**：
  1. 开始工作时：从初始 active 态转入工作中 active 态
  2. 创建 MR + 扫完反馈 + CI 绿后：转入 review 态（neither active nor terminal）
  3. 人 review 后两条路：
     - **增量修复**：人移回初始 active 态（PR 还在）→ agent 被重新派发 → 同分支改 → push → 扫完反馈 → 转回 review 态
     - **全量重置**：人移到返工 active 态 → agent 被重新派发 → 关旧 MR → 从 `origin/main` 创新分支 → 从头来 → 转回 review 态
  4. 人 approve 后移到合并 active 态 → agent 被重新派发 → 跑 `land` 技能 → merge 成功后转入 terminal 态
- 更新 `WORKFLOW.md.example` front matter 的 `active_states` 示例：从 `["To Do", "In Progress"]` 改为 `["待办", "处理中", "合并中", "返工"]`，体现三层状态模型 + 双路径 review 处理。
- 更新 `jira` 技能：新增 State Flow 小节，解释三层状态桶、双路径 review 处理、agent 在每个阶段的转换职责。
- 更新 `buildContinuationGuidance`：续轮指引中提示检查 Jira 状态，根据所处状态决定是增量修复还是全量重置。
- 新增 `docs/state-flow.md` 流程文档：用 Mermaid 图 + 文字说明完整展示 tasking 的状态流转过程，包括三层状态模型、双路径 review 处理、调度器 reconcile 三分支、配置示例。
- 全面测试：active_states 注入、State Flow 渲染、双路径步骤验证。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `workflow-prompt-optimization`: 模板新增 State Flow 小节（含双路径）；注入 active_states；workflow 步骤加入显式状态转换（含增量/重置分支）；front matter active_states 示例更新
- `opencode-worker`: `RenderContext` 新增 `active_states` 字段；`renderPrompt` 调用点传入
- `opencode-skills`: `jira` 技能新增 State Flow 小节（三层状态桶 + 双路径 review + 各阶段转换职责）

## Impact

- **代码**：`src/worker/prompt.ts`（RenderContext + resolveVariable）、`src/worker/runner.ts`（传参）、`WORKFLOW.md.example`（front matter + prompt body）
- **技能**：`assets/skills/jira/SKILL.md` 新增 State Flow 小节
- **测试**：`tests/prompt.test.ts`（active_states 注入 + State Flow 渲染 + 双路径步骤验证）、`tests/skills.test.ts`（jira 技能 State Flow 验证）
- **配置**：`WORKFLOW.md.example` front matter 的 `active_states` 示例值更新（BREAKING：已有用户的 active_states 配置仍有效，但示例推荐加入"合并中"和"返工"等效态）
- **文档**：`docs/state-flow.md`（新建，含 Mermaid 流程图 + 状态图）、`docs/configuration.md`、`docs/usage.md` 需同步说明三层状态模型 + 双路径 review 处理
