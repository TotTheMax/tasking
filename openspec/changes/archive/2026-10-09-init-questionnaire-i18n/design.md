## Context

init 问卷的翻译依赖写入层：`translatingWritable`（translate/output.ts）拦截 `write(chunk)` 整块查字典，但 `style.boxLine` 等先给内容包上边框/缩进/换行（style.ts:51-52），带壳串与字典裸句键逐字节不等 → EXACT/PATTERNS 全部失配 → 兜底规则（`^(.*)$` 恒等）原样放行。对照：飞书回复与 doctor 均为**组装层**翻译（先组装裸串 → `translate()` → 再包装/发送），已验证可行；init 是唯一依赖失效写入层的面。字典 328 条英文译文已备齐（translate-coverage 门禁强制），zh locale 下 `translate()` 为 no-op。

与用户对齐的共识：

| 决策点 | 结论 |
|---|---|
| 范围 | 仅 init 问卷；doctor（已完成）、TUI、硬编码英文段、`translatingWritable` 不动 |
| 问卷语言判定 | ① `--lang` 显式 → 问卷前 `setLocale`；② 无 `--lang` → 前两问 zh、答完即切（现状）；③ `--force` 重跑 → 读旧 WORKFLOW.md `interface_language` 种子 |
| 接口形态 | 方案 B 全量切换：`{value, label}` 类型化选项，不留旧 `string[]` 签名 |
| 测试 | stub 机械更新、zh 断言零改动、新增 en 用例三件套 |
| 非目标 | `promptStateAutofill` 手工三元双语、字典增改、doctor/TUI |

## Goals / Non-Goals

**Goals:**

- `init --lang en`：问卷从第一问起（框线标题、说明、问题、选项标签）渲染英文；zh 默认行为逐字节不变。
- 选项的显示标签与协议值结构性解耦：改文案/翻译不可能影响分支判断（类型层面免疫）。
- 翻译机制收敛为一套（组装层），与飞书侧、doctor 同构。

**Non-Goals:**

- `promptStateAutofill` 手工三元双语（`zh ? "确认写入（默认）" : "Confirm (default)"`）的统一——已能工作，留作后续清理。
- doctor / TUI / status 的翻译（doctor 已完成；其余面后续按需）。
- 字典与 `translate()` 机制本身的任何改动；`translatingWritable` 移除（保留为幂等双保险：已是英文的串查不中字典、原样过）。
- 非交互 init（`--non-interactive`）——路径已正确（先 setLocale 再输出）。

## Decisions

**D1 组装层翻译，seam 在 style 与 prompts。**
`style.ts` 的 `boxHeader/boxLine/bold/dim` 对传入内容调 `translate()` 后再包边框/加样式；`createPromptInterface` 的 `ask`/`askSelect` 对问题文本与选项标签在渲染前 `translate()`。依据：仓库内已验证的可行路径（doctor.ts:192-197、飞书回复）即"先组装裸串再翻译"；写入层不拆除，幂等无害。init.ts 的 131 处 `style.*` 调用点因此**零改动**。

**D2 askSelect 类型化选项（方案 B），全量切换。**
```ts
interface SelectOption<T> { value: T; label: string }
askSelect<T>(question: string, options: ReadonlyArray<SelectOption<T>>): Promise<T>
```
返回 `T`（字面量联合），调用方 `choice === "jira"` 拼错编译不过；label 纯展示。被否决的替代：A（中文原文兼任 ID，显示翻译返回原文）——防串扰靠规约+测试，改文案仍有静默弄断分支的风险；新旧签名并存——两种写法留判断负担。调用点 9 处全在 init.ts、`PromptInterface` 仅 init 使用，涟漪封闭：9 处调用点 + init.test.ts 约 15 处 stub 一次性机械改造。

**D3 问题文本的翻译时机。**
`ask`/`askSelect` 收到的 question 常为复合串（`${style.bold("Feishu app_id")} (…应用凭证)`）——Han 位于 style 助手内外两侧。翻译点：prompts.ts 对 question 整串与每个 label 调 `translate()`（此时 style 内层已过 D1 的翻译，ASCII 无 Han no-op；外层 Han 由字典 PATTERNS 锚定匹配，如 edition 相关 pattern 已在库）。复合串渲染后流经 `translatingWritable` 时已是英文/无 Han，二次 translate 幂等。

**D4 动态数据标签照过 translate()，不做 raw 旁路。**
群名、Jira issue types 等用户数据标签与静态文案走同一 `translate()`：EXACT 查非自有长句必 miss，PATTERNS 为锚定的自有句型（`^…$`）不匹配随机数据，兜底恒等——原样返回。字典键全部是本项目 authored 长句，用户数据撞键概率≈0；加 raw 标记是 Speculative Generality。风险记录于此，如未来出现真实撞键再加旁路。

**D5 问卷语言判定三规则（时序）。**
`--lang` 给出（或 `--force` 且旧 WORKFLOW.md 有 `interface_language`）→ `runInteractiveInit` 在任何输出前 `setLocale`；否则前两问 zh（鸡生蛋：语言本身是第二问，接受并记录），答完立即 `setLocale`（现状）。`--force` 种子读取复用 `parseWorkflowContent`，读不到/解析失败静默回退 zh。

**D6 不立 ADR、零字典改动。**
接口改造可逆（权衡记录于本文件）；字典 328 条与 `translate-coverage` 门禁原样复用。无新术语——CONTEXT.md 的 Interface language 词条本就声明 CLI output 跟随 interface_language，本变更是让实现符合既有定义。

## Risks / Trade-offs

- [stub 全量改造引入机械错误（改漏/改错 value）] → 编译期类型即门禁（value 联合类型与判断点必须吻合）；zh 行为断言零改动本身是回归网。
- [label 显示翻译与 promptOverride（测试 stub）路径不一致] → stub 本就不经 `createPromptInterface`，返回 value 而非 label——B 的天然副产物，测试反而更稳。
- [用户数据撞字典键] → 见 D4，概率≈0，已记录。
- [`--force` 种子读旧文件失败] → 静默回退 zh，行为等同现状，无新增失败面。

## Migration Plan

纯增量：无配置/数据迁移。旧交互行为（zh 默认）不变；`--lang en` 从"中文问卷"变为"英文问卷"是修复而非破坏。回滚 = revert 提交。

## Open Questions

（无——决策已在逐题拷问中全部收敛。）
