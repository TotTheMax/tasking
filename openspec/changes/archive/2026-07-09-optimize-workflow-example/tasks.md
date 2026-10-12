## 1. WORKFLOW.md.example 补全

- [x] 1.1 重写 `WORKFLOW.md.example` front matter，包含全部 10 个配置块的全部字段，每个字段加 `#` 内联注释
- [x] 1.2 补充 `WORKFLOW.md.example` prompt body，包含 `jira_rest`/`jira_upload_attachment` 工具指引 + 代码任务/非代码任务流程 + attempt 区分

## 2. init.ts 改为读取 example

- [x] 2.1 `src/cli/init.ts` 删除内联 `STARTER_WORKFLOW` 字符串，改为 `readFileSync` 读取 `WORKFLOW.md.example`
- [x] 2.2 确认 `tasking init` 生成的文件与 example 完全一致

## 3. 验证

- [x] 3.1 `npm run lint && npm run typecheck && npm test` 全绿
- [x] 3.2 `tasking init --force` 生成的 WORKFLOW.md 包含全部字段+注释
