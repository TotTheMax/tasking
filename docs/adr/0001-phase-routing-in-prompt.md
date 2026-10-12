# 阶段路由放 prompt body，不放运行时代码

对于 grill-openspec workflow 变体，四技能阶段路由（grill → 实施 → 合并，加运行中升级）完全写在 `assets/workflows/WORKFLOW.grill-openspec.md.example` 的 prompt body 里，由 agent 在运行时根据产物 + 状态语义 + Jira comments/glab 查询自判。我们刻意不向 scheduler、runner、prompt 渲染器或 config schema 加任何阶段状态、阶段字段或路由逻辑。

理由：运行时零改动让一个新 workflow 变体以"一个模板文件 + 一个 `init --workflow` 选项"落地，对默认 workflow 零风险，且无需新模板变量（`prompt.ts` 的 strict Liquid 对未知变量抛错，加变量有摩擦）。代价是可观测性弱、以及共享的 turn 2+ 续轮指引（`buildContinuationGuidance`，MR 中心）在 grill 阶段略偏——记入 `docs/known-issues.md`，v1 接受。
