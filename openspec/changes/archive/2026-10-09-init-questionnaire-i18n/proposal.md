## Why

CONTEXT.md 的 Interface language 词条定义 tasking 自有文案（含 **CLI output**）按 `interface_language`（`--lang` 种子）渲染，但 init 问卷实际永远中文：翻译发生在写入层（`translatingWritable` 拦截整个 chunk），而 `style.boxLine` 先把内容包进边框/缩进/换行（style.ts:52），带壳串永远匹配不上字典的裸句键 → 落入兜底规则原样放行。字典里 init 文案的英文译文**已备齐**（translate-coverage 门禁强制覆盖全部 Han 字面量），机制失效纯属翻译层位置错配。随 Lark（海外版）落地，英文操作者跑 `init --lang en` 时首屏即中文，体验断裂。

## What Changes

- **翻译位置从写入层挪到组装层**：`style.boxHeader/boxLine/bold/dim` 对内容先 `translate()` 再包边框；`createPromptInterface` 的 `ask`/`askSelect` 对问题文本与选项标签在渲染前 `translate()`。zh locale 下 `translate()` 是 no-op，默认行为逐字节不变。
- **`askSelect` 选项类型化（方案 B，全量切换）**：`askSelect<T>(question, options: ReadonlyArray<{ value: T; label: string }>): Promise<T>`——标签纯展示（渲染瞬间翻译、用完即弃），协议走类型化 value，"改文案弄断分支"在类型层面不可能。9 个调用点 + init.test.ts 约 15 处 stub 一次性机械改造，不留旧签名。
- **问卷语言判定三规则**：① `--lang` 显式给出 → 问卷开始前 `setLocale`（第一问即英文）；② 不带 `--lang` → 前两问维持 zh（语言未知，鸡生蛋），答完模板语言立即切换（现状行为）；③ `--force` 重跑且已存在 WORKFLOW.md → 读旧文件 `interface_language` 预设问卷语言。
- **非目标**：`promptStateAutofill` 手工三元双语不动（已能工作，记后续清理）；doctor/TUI 不动（doctor 已全程组装层翻译）；`translatingWritable` 保留（幂等双保险）；字典 328 条零新增零修改；硬编码英文段（Prerequisites/Next Steps）不动。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `interactive-init`: 新增需求"问卷引导跟随界面语言"——`--lang en` 下问卷（框线标题/说明/问题/选项标签）SHALL 渲染英文；选项协议值 SHALL 与显示标签解耦（类型化 value）；`--force` 重跑 SHALL 沿用既有 WORKFLOW.md 的界面语言；zh 默认行为 SHALL 逐字节不变。

## Impact

- **代码**：`src/cli/style.ts`（4 个方法注入 translate）、`src/cli/prompts.ts`（PromptInterface 签名 + 显示翻译）、`src/cli/init.ts`（9 处 askSelect 调用点改 {value,label} + setLocale 时序 + `--force` 读旧 interface_language）、`src/translate/` 零改动。
- **测试**：`tests/init.test.ts`（stub 签名机械更新，zh 行为断言零改动；新增 en 用例三件套：`--lang en` 首问英文含选项、`--force` 种子、无 `--lang` 前两问 zh 不变）。
- **文档**：无新术语（Interface language 词条已覆盖 CLI，本变更是让实现符合既有定义）；不立 ADR（接口改造可逆，权衡记录于 design.md）。
- **不受影响**：飞书侧翻译（不经 style/prompts 层）、doctor、daemon、翻译字典、非交互 init 路径（已正确）。
