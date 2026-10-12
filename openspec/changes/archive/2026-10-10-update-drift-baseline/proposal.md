# `init --update` 漂移基线改为"生成器当日产物"

## Why

`init` 按 ADR 0028 有意裁剪生成物（非本变体的段整段注释、zh 版省略 `interface_language`），而 `init --update` 的缺失字段报告却拿**未裁剪的原始模板**当基线——于是刚生成、一个字未动的文件立刻报 ~11 条"missing"，还触发写入 `.tasking/<name>.reference`（尽管 prompt body 是 identical）。报告把"裁剪设计如此"（噪音）与"升级后模板新增字段"（真漂移）混为一谈，对默认路径与自定义路径同样复现。

## What Changes

- **漂移基线重定义**（见 `CONTEXT.md` 词条 **Drift baseline**）：缺失字段改比"今天 init 会生成什么"——对探测到的（或 `--workflow`/`--lang` 显式覆盖的）variant × lang 走**与 init 同一条生成路径**产出内容、解析其 frontmatter，**只比键、不比值**（占位凭证与真实值不构成漂移）。
- **镜像用户的结构选择（A+）**：基线生成时 feishu 段的形态跟随**用户文件里的 `feishu.enabled`**——桥用户保留 feishu 段的升级感知。
- **reference 触发条件**收紧为 `（新基线下存在缺失字段）∨（prompt body diff）`；fresh 文件 → `no missing config fields`、**不写** reference 且清掉旧 reference。reference 副本仍复制**原始模板**（canonical 全量，真实漂移时可见被裁剪段里有什么可用）。
- **不动的部分**：prompt body diff 仍比原始模板（裁剪不触及 body，二者本同源）；`no missing config fields` 等既有文案保留。
- **表头微调**：`Config (fields missing from your file — …; optional sections are commented out in generated files):` → `Config (fields missing vs a fresh init today — they fall back to DEFAULTS):`；`src/cli/help.ts` 的 `--update` 描述同步（"vs the detected template" → 基线语义）。
- **代价（明确接受）**：只存在于被裁剪段的新可选字段不再列入报告（仍走 DEFAULTS、文档与 reference 可见；`generated-config-trimming` 的分段护栏测试继续守护模板新增段的可见性）。
- 新增 ADR 0034，并在 ADR 0028 的"三台以模板为基准的机器"处加指针；`CONTEXT.md` 词条已先行落盘。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `init-update`: 「--update 不写 WORKFLOW.md，只报告漂移」的**缺失字段基线**从"模板 frontmatter 有而用户没有"改为"漂移基线有而用户没有"（含 feishu.enabled 镜像与 `--workflow`/`--lang` 覆盖同切基线）；reference 写入条件随之收紧。
- `interactive-init`: 「Template language 选择问答」中"`--update` SHALL 把 `interface_language` 纳入 drift 报告"一句按新基线修订——zh 基线按生成器语义省略该字段、不再列为缺失；en 基线含该字段、缺失照报。

## Impact

- **代码**：`src/cli/init.ts`（抽取共享的模板裁剪 helper；`reportWorkflowDrift` 换基线来源与表头）、`src/cli/help.ts`（一句描述）。
- **测试**：`tests/init.test.ts`——3 个用"删 `opencode.variant`/`opencode.agents`（minimal 的注释段）造漂移"的旧用例改用 active 段字段（如 `tracker.required_labels`）或 body 改动构造；2 个 reference 写入/清除用例同法重构造；新增"fresh 文件零缺失且不写 reference""feishu 镜像（桥启用缺 feishu 键被报 / 未启用不报）"用例。
- **文档**：`docs/{zh,en}/usage.md` 的 `--update` 行一处措辞；`docs/adr/0034-*`（新增）、`docs/adr/0028-*`（指针）。
- **门禁**：不触及 Feishu/Jira adapter、scheduler、评论桥——按需跑 `tests/init.test.ts` + 全量 `npm run lint && npm run typecheck && npm test`；`openspec validate --changes` 复核。
