## 1. 基线生成与漂移判定（T1）

- [x] 1.1 抽取共享裁剪 helper：把 `generateWorkflowContent` 的"读模板 → `trimFrontmatter` → interface_language 处理"抽成 `applyTemplateTrimming(content, workflow, feishuEnabled, lang)`（先写失败单测断言 helper 输出与 `generateWorkflowContent(null, workflow, null, lang)` 完全一致），生成路径与基线路径共用
- [x] 1.2 fresh 文件零漂移：先写失败测试（`runInit` 生成后立即 `--update`：`no missing config fields` + body `identical` + `.tasking/` 无 `<basename>.reference`），再把 `reportWorkflowDrift` 的 config 比对基线换为 `applyTemplateTrimming` 产物解析出的键集合
- [x] 1.3 裁剪段不计缺失：先写失败测试（minimal 文件下 `opencode.variant`/`polling`/`interface_language` 不出现在报告），随 1.2 一并通过
- [x] 1.4 feishu 镜像：先写失败测试（桥启用文件删 `intake_chat_id` → 被报；`enabled: false` 文件 → feishu 段内键不报），再实现基线 `feishuEnabled` 取自用户解析配置

## 2. 触发条件与既有用例重构造（T2）

- [x] 2.1 reference 触发条件收紧：改造"writes/removes `.tasking/<basename>.reference`"两用例为真实漂移构造（active 段字段删除或 body 改动），断言 fresh 运行不写且清除旧副本
- [x] 2.2 旧漂移构造用例重写：`reports config fields missing` / `labels missing … DEFAULTS` / `renders array defaults as JSON` 三用例改用 active 段字段（如 `hooks.timeout_ms`、`tracker.required_labels`）构造缺失，保留原断言措辞
- [x] 2.3 `--workflow`/`--lang` 覆盖切基线：补用例（feishu-direct 文件 + `--workflow code-mr` → hooks/env 计缺失；body diff 用 code-mr 模板）

## 3. 文案与帮助（T3）

- [x] 3.1 表头改 `Config (fields missing vs a fresh init today — they fall back to DEFAULTS):`（先写失败断言新表头、旧半句不出现）
- [x] 3.2 `src/cli/help.ts` 的 `--update` 描述从 "vs the detected template" 改为基线语义（保持单行英文风格；既有 help 用例断言不回退）

## 4. 文档与 ADR（T4）

- [x] 4.1 双语 `docs/{zh,en}/usage.md` 的 `--update` 行：缺失字段口径改为"对比当前生成基线"；`tests/docs-links.test.ts` 绿
- [x] 4.2 新增 `docs/adr/0034-drift-baseline-generator-output.md`（基线=生成器当日产物而非原始模板；A/A+/B/C 取舍与代价），ADR 0028"三台机器"处加指针
- [x] 4.3 确认 `CONTEXT.md` 的 **Drift baseline** 词条与 init --update 回填已就位（本变更已先行写入）

## 5. 门禁收尾

- [x] 5.1 `npm run lint && npm run typecheck && npm test` 全绿；`npx vitest run tests/init.test.ts tests/cli.test.ts` 定向复核
- [x] 5.2 真机冒烟：`npm run build` 后对 fresh 文件与手改文件各跑一次 `init --update`，验证零漂移/真实漂移两条路径与 reference 行为
- [x] 5.3 `openspec validate --changes` 复核（活动变更保持不含日期的 `update-drift-baseline`）
