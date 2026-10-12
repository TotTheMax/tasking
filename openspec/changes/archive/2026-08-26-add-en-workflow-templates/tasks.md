## 1. 英文模板资产（TDD：先断言结构等价，再产出译文）

- [x] 1.1 写失败测试（新文件 `tests/en-templates.test.ts`）：三个英文模板存在、顶部含 `<!-- tasking-workflow-lang: en -->` 哨兵；与对应 zh 模板的 frontmatter YAML key 集合一致、prompt body 的 Liquid 表达式集合一致、协议哨兵（`<!-- tasking-workflow: code-mr -->`、`## 🔍 拷问 / Grill Questions`）跨语言逐字节一致；zh 模板文件内容与 git HEAD 版本逐字节一致（防误改）
- [x] 1.2 产出 `WORKFLOW.en.md.example`、`WORKFLOW.code-mr.en.md.example`、`WORKFLOW.grill-openspec.en.md.example`：YAML 注释与 prompt 正文中文说明全部英译，状态名占位值保留并加英文提示注释，使 1.1 全绿

## 2. init 语言选项（TDD）

- [x] 2.1 写失败测试（`tests/init.test.ts`）：非交互 `--lang en` × 三变体分别写入对应英文模板且含语言哨兵；不带 `--lang` 输出与现状一致（zh）；`--lang fr` 报错列出支持值且不写文件
- [x] 2.2 实现：`TemplateLanguage` 类型 + `normalizeLang` + `resolveExampleFile(workflow, lang)`；非法值报错退出码 1；输出摘要行增加 `Language:`

## 3. 交互式语言引导（TDD）

- [x] 3.1 写失败测试（`tests/init.test.ts`）：TTY 且未指定 `--lang` 时出现 Template language 选择问答，选 English 得英文模板；指定 `--lang` 时跳过该问答
- [x] 3.2 实现：交互流程在 workflow 选择后弹「Template language」选择框（`中文` 在前为默认），显式 `--lang` 跳过

## 4. --update 语言识别（TDD）

- [x] 4.1 写失败测试（`tests/init.test.ts`）：en 哨兵的 WORKFLOW.md 跑 `--update` 用英文模板漂移报告且 `.tasking/WORKFLOW.md.reference` 复制自英文模板；无哨兵用 zh 模板；`--lang en` 显式覆盖并在输出标注 `(explicit --lang)`
- [x] 4.2 实现：`detectTemplateLanguage`（含 en 哨兵 → en，否则 zh）接入 `runUpdate` 模板选取与输出行；CLI parseArgs 增加 `--lang`

## 5. 打包 / 帮助 / 文档同步

- [x] 5.1 package.json `files` 增加 3 个英文模板；help.ts usage 与 options 增加 `--lang <zh|en>` 行（同步断言帮助文本的既有测试保持绿）
- [x] 5.2 README 与 docs/{usage,configuration}.md 双语页补 `--lang` 说明；`npm run lint && npm run typecheck && npm test && npm run build` 全绿
