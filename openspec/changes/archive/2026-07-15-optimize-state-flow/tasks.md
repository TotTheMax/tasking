## 1. 扩展 RenderContext 注入 active_states

- [x] 1.1 `RenderContext` 接口新增 `active_states: string` 字段（`src/worker/prompt.ts`）
- [x] 1.2 `resolveVariable` 函数新增 `"active_states"` 根变量分支
- [x] 1.3 `runner.ts` 调用 `renderPrompt` 处从 `config.tracker.active_states` 取数组 `.join(", ")` 传入

## 2. 更新 buildContinuationGuidance

- [x] 2.1 修改 `buildContinuationGuidance` 文本，加入检查 Jira 状态的提示（根据所处状态决定增量修复还是全量重置）

## 3. 重写 WORKFLOW.md.example prompt body

- [x] 3.1 新增 State Flow 小节：用 `{{ active_states }}` 和 `{{ terminal_states }}` 解释三层状态模型（active / review / terminal）
- [x] 3.2 State Flow 小节包含完整流转路径说明（开始→工作中→review→双路径→合并→完成）
- [x] 3.3 State Flow 小节说明双路径 review 处理：增量修复（人移回初始态，同分支改）vs 全量重置（人移到返工态，关 MR、新分支）
- [x] 3.4 重写代码任务步骤，加入显式状态转换指引（每步标注转入什么类型的状态）
- [x] 3.5 代码任务步骤包含 re-dispatch 后的路由指引（初始态=增量、返工态=重置、合并态=land）
- [x] 3.6 重试 attempt 分支：引用 `land` 技能和 `debug` 技能，提示检查当前状态
- [x] 3.7 更新 front matter `active_states` 示例为 `["待办", "处理中", "合并中", "返工"]`（实际用"重置处理"）
- [x] 3.8 更新 front matter 注释：说明 review 态不放在两个列表中，说明增量修复 vs 全量重置

## 4. 更新 jira 技能

- [x] 4.1 在 `assets/skills/jira/SKILL.md` 新增 State Flow 小节
- [x] 4.2 State Flow 小节解释三层状态桶（active / neither / terminal）
- [x] 4.3 State Flow 小节说明双路径 review 处理：增量修复（同分支改、push、扫完反馈）vs 全量重置（关 MR、新分支、从头来）
- [x] 4.4 State Flow 小节说明各阶段转换职责（开始→工作中 active 态；创建 MR→review 态；land merge→terminal 态）
- [x] 4.5 更新 Workflow Summary 小节与 State Flow 一致

## 5. 更新 prompt 测试

- [x] 5.1 更新 `tests/prompt.test.ts`：现有测试用例适配 `active_states` 参数
- [x] 5.2 新增测试：模板渲染 `{{ active_states }}` 输出正确的活跃状态名称
- [x] 5.3 新增测试：模板包含 State Flow 小节
- [x] 5.4 新增测试：State Flow 解释三层模型（active / review / terminal）
- [x] 5.5 新增测试：State Flow 包含双路径 review 处理说明
- [x] 5.6 新增测试：代码任务步骤包含显式状态转换指引
- [x] 5.7 新增测试：步骤包含 re-dispatch 后的路由指引（增量/重置/合并）
- [x] 5.8 新增测试：重试 attempt 引用 land/debug 技能并提示检查状态
- [x] 5.9 新增测试：buildContinuationGuidance 提示检查 Jira 状态并决定增量还是重置
- [x] 5.10 更新 WORKFLOW.md.example 读取测试，适配新的 prompt body 结构

## 6. 更新技能测试

- [x] 6.1 新增测试：jira 技能包含 State Flow 小节
- [x] 6.2 新增测试：jira 技能 State Flow 说明三层状态桶
- [x] 6.3 新增测试：jira 技能 State Flow 说明双路径 review 处理
- [x] 6.4 新增测试：jira 技能 State Flow 说明各阶段转换职责

## 7. 更新文档

- [x] 7.1 更新 `docs/configuration.md`：说明三层状态模型、active_states 配置建议（含返工态）
- [x] 7.2 更新 `docs/usage.md`：新增状态流转说明章节（含双路径 review 处理）
- [x] 7.3 更新 `docs/skills.md`：jira 技能描述补充 State Flow

## 8. 新增流程文档

- [x] 8.1 创建 `docs/state-flow.md`：完整的状态流转文档
- [x] 8.2 文档包含三层状态模型说明（active / review / terminal）及调度器行为（派发/停 worker/清理工作区）
- [x] 8.3 文档包含 Mermaid 流程图：完整流转路径（待办→处理中→代码评审中→双路径→合并中→完成）
- [x] 8.4 文档包含 Mermaid 状态图：三层状态桶与调度器行为映射
- [x] 8.5 文档包含双路径 review 处理说明（增量修复 vs 全量重置）及触发条件
- [x] 8.6 文档包含配置示例（active_states / terminal_states / 隐式 review 态）
- [x] 8.7 文档包含调度器三层 reconcile 分支代码引用（terminal/active/neither → scheduler.ts 行号）
- [x] 8.8 更新 `docs/README.md` 索引新增 `docs/state-flow.md`

## 9. 验证

- [x] 9.1 运行 `npm run lint` 全绿
- [x] 9.2 运行 `npm run typecheck` 全绿
- [x] 9.3 运行 `npm test` 全绿
