## 1. 移除 review_state 死字段

- [x] 1.1 从 `TrackerConfig` 接口删除 `review_state` 字段（`src/config/config-types.ts`）
- [x] 1.2 从 `DEFAULTS.tracker` 删除 `review_state` 默认值（`src/config/config-types.ts`）（无此默认值，no-op）
- [x] 1.3 从 `resolveTracker` 删除 `review_state` 解析行（`src/config/resolver.ts`）
- [x] 1.4 从 `WORKFLOW.md.example` front matter 删除 `review_state` 行及其注释
- [x] 1.5 更新测试：`tests/config.test.ts`、`tests/jira-tracker-http.test.ts`、`tests/mcp.test.ts`、`tests/worker.test.ts` 中删除 `review_state` 字段引用
- [x] 1.6 更新 `docs/configuration.md`：删除 `review_state` 行，标注已移除（无引用，no-op）

## 2. 扩展 RenderContext 注入 terminal_states

- [x] 2.1 `RenderContext` 接口新增 `terminal_states: string` 字段（`src/worker/prompt.ts`）
- [x] 2.2 `resolveVariable` 函数新增 `"terminal_states"` 根变量分支
- [x] 2.3 `renderPrompt` 签名扩展，接受 `terminal_states` 参数并填入 `RenderContext`
- [x] 2.4 `runner.ts` 调用 `renderPrompt` 处从 `config.tracker.terminal_states` 取数组 `.join(", ")` 传入

## 3. 更新 buildContinuationGuidance 引用技能

- [x] 3.1 修改 `buildContinuationGuidance` 文本，引用 `debug` 和 `land` 技能

## 4. 创建 jira 技能

- [x] 4.1 创建 `assets/skills/jira/SKILL.md`，含 YAML front matter（`name: jira`、`description: ...`）
- [x] 4.2 编写 transitions 查询与转换指南（`GET /issue/{key}/transitions`、`POST /issue/{key}/transitions`）
- [x] 4.3 编写评论读写指南（`GET /issue/{key}/comment`、`POST /issue/{key}/comment`）
- [x] 4.4 编写附件读写指南（`GET /issue/{key}?fields=attachment`、`jira_upload_attachment`）
- [x] 4.5 编写标签添加指南（`PUT /issue/{key}/labels`）
- [x] 4.6 编写 base64 编码方法（`fs.readFileSync(path).toString('base64')`）
- [x] 4.7 编写状态转换规则：先查 transitions、按名称选 id、不硬编码 id、不自行 transition 到终态

## 5. 重写 WORKFLOW.md.example prompt body

- [x] 5.1 重写 prompt body：引用 pull/commit/push/jira 技能替代原始 git 命令和内联 jira_rest 示例
- [x] 5.2 `{% if attempt %}` 分支：引用 land 和 debug 技能
- [x] 5.3 添加 `{{ terminal_states }}` 渲染：告诉 agent 禁止转入的终态
- [x] 5.4 移除所有内联 jira_rest API 路径示例（移至 jira 技能）
- [x] 5.5 移除所有原始 git 命令（`git add -A`、`git commit -m`、`git push`）
- [x] 5.6 确保 front matter 与 prompt body 用 `---` 分隔，front matter 不含 `review_state`

## 6. 更新 prompt 渲染测试

- [x] 6.1 更新 `tests/prompt.test.ts`：现有测试用例适配 `terminal_states` 参数
- [x] 6.2 新增测试：terminal_states 从配置数组预 join 为逗号分隔字符串
- [x] 6.3 新增测试：模板渲染 `{{ terminal_states }}` 输出正确的终态名称
- [x] 6.4 新增测试：首次 attempt 引用 pull/commit/push/jira 技能名
- [x] 6.5 新增测试：重试 attempt 引用 land/debug 技能名
- [x] 6.6 新增测试：模板不包含原始 git 命令（`git add -A`、`git commit -m`、`git push`）
- [x] 6.7 新增测试：模板不包含内联 jira_rest API 路径示例
- [x] 6.8 新增测试：模板不包含 `review_state` 引用
- [x] 6.9 新增测试：buildContinuationGuidance 引用 debug 和 land 技能

## 7. 更新技能测试

- [x] 7.1 更新 `tests/skills.test.ts`：新增 jira 技能 front matter 格式验证
- [x] 7.2 新增测试：jira 技能包含 transitions 查询示例
- [x] 7.3 新增测试：jira 技能包含状态转换示例
- [x] 7.4 新增测试：jira 技能包含评论读写示例
- [x] 7.5 新增测试：jira 技能包含附件读写示例
- [x] 7.6 新增测试：jira 技能包含标签添加示例
- [x] 7.7 新增测试：jira 技能包含 base64 编码方法
- [x] 7.8 新增测试：jira 技能指示先查 transitions、不硬编码 id

## 8. 更新文档

- [x] 8.1 更新 `docs/configuration.md`：删除 `review_state` 配置项说明（无引用，no-op）
- [x] 8.2 更新 `docs/usage.md`：更新 prompt 模板说明，引用 jira 技能
- [x] 8.3 更新 `docs/skills.md`：新增 jira 技能章节
- [x] 8.4 更新 `docs/README.md`：索引如有变化则同步

## 9. 验证

- [x] 9.1 运行 `npm run lint` 全绿
- [x] 9.2 运行 `npm run typecheck` 全绿
- [x] 9.3 运行 `npm test` 全绿
