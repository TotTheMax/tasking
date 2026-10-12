## 1. 类型化选项接口（方案 B 全量切换）

- [x] 1.1 在 `tests/init.test.ts` 以新签名写失败测试：stub 的 `askSelect` 返回 value（如 `"jira"`），任务来源选择后走接 Jira 分支（断言出现 Jira endpoint 问答）。红后将 `src/cli/prompts.ts` 的 `PromptInterface.askSelect` 改为 `askSelect<T>(question, options: ReadonlyArray<SelectOption<T>>): Promise<T>`（新增 `SelectOption` 导出），机械更新 `tests/init.test.ts` 全部 stub 与 `src/cli/init.ts` 9 处调用点为 `{value, label}` 形态（ASCII 标签处 value=label），zh 行为断言零改动，转绿
- [x] 1.2 运行 `npm run typecheck`——value 联合类型与全部判断点吻合（拼错即编译错误），`npm test -- tests/init.test.ts` 全绿确认零行为回归

## 2. 组装层翻译

- [x] 2.1 在 `tests/init.test.ts` 写失败测试：zh 默认下问卷输出与现状逐字节一致（快照既有用例即回归网，确认全部通过后）在 `src/cli/style.ts` 的 `boxHeader/boxLine/bold/dim` 对内容调 `translate()` 再包边框，zh no-op 零变化，转绿
- [x] 2.2 在 `tests/init.test.ts` 写失败测试：`createPromptInterface` 的 `ask`/`askSelect` 对问题文本与选项标签渲染前翻译——en locale 下经真实 `createPromptInterface`（非 stub）驱动任务来源问，断言输出含 "Feishu direct only (default)" 与英文说明行。红后在 `src/cli/prompts.ts` 渲染路径注入 `translate()`（返回值取 value），转绿

## 3. 问卷语言判定时序

- [x] 3.1 在 `tests/init.test.ts` 写失败测试：`--lang en` 下交互式 init 的**第一问**（任务来源框线+说明+选项）即为英文。红后在 `runInteractiveInit` 开头：`--lang` 显式给出时 `setLocale` 先于任何输出，转绿
- [x] 3.2 在 `tests/init.test.ts` 写失败测试：`--force` 重跑且旧 WORKFLOW.md 含 `interface_language: en` 时问卷以英文开始；旧文件无该键/解析失败时 zh 开始且不报错。红后实现读取旧文件 interface_language 种子（复用 `parseWorkflowContent`，失败静默回退），转绿
- [x] 3.3 在 `tests/init.test.ts` 补确认用例（应直接通过）：不带 `--lang` 时前两问维持 zh、选择 English 后后续切换英文（现状行为不变）

## 4. 门禁与收尾

- [x] 4.1 `npm run lint`、`npm run typecheck`、`npm test`（全量，重点 `tests/init.test.ts`、`tests/translate*.test.ts` zh 断言零改动全绿）
- [x] 4.2 人工冒烟（可选，非门禁）：`npm run dev -- init --lang en` 目测首问英文、选项英文、分支正确；不带 `--lang` 确认中文问卷与现状一致
