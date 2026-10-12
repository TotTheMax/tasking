## 1. grill-openspec 模板

- [x] 1.1 创建 `WORKFLOW.grill-openspec.md.example`：front matter 与 `WORKFLOW.md.example` 一致；prompt body 编码四阶段路由（grill/实施/合并/运行中升级）+ 拷问 comment 标记头 `## 🔍 拷问 / Grill Questions` + 不硬编码状态名（只用 `{{ active_states }}`/`{{ review_state }}`/`{{ terminal_states }}`）+ 只用现有模板变量 + 返工不重新 grill + 未答走推荐 + 注明技能由目标仓库提交
- [x] 1.2 写失败测试：`renderPrompt` 渲染 grill-openspec 模板不抛 `unknown variable`/`unknown filter`，且渲染产物含四阶段关键词（grill/拷问/实施/合并/archive）且不含字面量状态名（"待办"/"合并中"/"重置处理"/"代码评审中"）
- [x] 1.3 实现/调整模板让 1.2 通过

## 2. init --workflow 选项

- [x] 2.1 写失败测试：`tasking init --workflow grill-openspec --non-interactive` 生成的 `WORKFLOW.md` 内容来自 grill 模板（断言含 grill-openspec 特有标记、不含默认模板独有的内容）
- [x] 2.2 实现：`InitOptions` 加 `workflow?: "default" | "grill-openspec"`；`runInit` 按 workflow 选模板文件（default→`WORKFLOW.md.example`，grill-openspec→`WORKFLOW.grill-openspec.md.example`）；让 2.1 通过
- [x] 2.3 写失败测试：`--workflow default` 与不传 `--workflow` 行为一致（都生成默认模板内容）
- [x] 2.4 实现/验证：让 2.3 通过
- [x] 2.5 写失败测试：未知 `--workflow unknown` 报错以非零码退出、不生成 `WORKFLOW.md`
- [x] 2.6 实现：未知值校验 + 非零退出；让 2.5 通过
- [x] 2.7 写失败测试：交互式 init 未指定 `--workflow` 时调用 `askSelect` 问 workflow；已指定时不调用 `askSelect`
- [x] 2.8 实现：交互式流程接入 workflow 选择问答（已指定跳过）；让 2.7 通过
- [x] 2.9 `src/cli/index.ts` 的 `init` 子命令解析 `--workflow` 并传入 `runInit`

## 3. 文档同步

- [x] 3.1 `docs/state-flow.md` 加 grill-openspec 流转图与四阶段说明
- [x] 3.2 `docs/configuration.md` 加 `--workflow` 选项（取值 `default`/`grill-openspec`，默认 `default`）与模板变体小节
- [x] 3.3 `docs/usage.md` 加 `tasking init --workflow grill-openspec` 用法示例与"4 个技能由目标仓库提交进 `.opencode/skills/`"说明

## 4. 验证

- [x] 4.1 `npm run lint` 全绿
- [x] 4.2 `npm run typecheck` 全绿
- [x] 4.3 `npm test` 全绿

> 注：delta specs 同步到主 specs 由 `openspec archive` 在归档时完成（`openspec archive` 会 update main specs），不在实施阶段手动同步。
