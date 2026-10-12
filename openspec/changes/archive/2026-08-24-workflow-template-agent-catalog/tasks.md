## 1. 模板字段（先红后绿）

- [x] 1.1 写失败测试：三个 starter 模板（`WORKFLOW.md.example`、`WORKFLOW.code-mr.md.example`、`WORKFLOW.grill-openspec.md.example`）的 `opencode` 块均含 `agents: []`（`tests/prompt.test.ts` 新 describe，遍历三模板解析 frontmatter 断言 `opencode.agents` 为 `[]`）
- [x] 1.2 在 `WORKFLOW.md.example` 的 `opencode` 块 `agent: build` 后加 `agents: []` 及说明注释
- [x] 1.3 在 `WORKFLOW.code-mr.md.example` 的 `opencode` 块 `agent: build` 后加 `agents: []` 及说明注释
- [x] 1.4 在 `WORKFLOW.grill-openspec.md.example` 的 `opencode` 块 `agent: build` 后加 `agents: []` 及说明注释
- [x] 1.5 跑 `npm test` 确认新断言绿（三模板字段齐全）

## 2. 文档一致性

- [x] 2.1 核对 `docs/zh/usage.md` / `docs/en/usage.md` 的 `opencode.agents` 示例与模板默认一致（空数组，无校验）
- [x] 2.2 更新 `CONTEXT.md`（如需要）：`Agent catalog` 术语已存在，确认与模板默认一致，无需新增

## 3. 验证

- [x] 3.1 跑 `npm run lint` ＋ `npm run typecheck` ＋ `npm test`，全绿后提交
