## Context

帮助文本集中在 `src/cli/help.ts` 的 `COMMANDS` 数组（单一事实源），`subcommandHelp` 与顶层 help 都从它渲染。`init` 的 option 描述中有 `--update` 一项只写了技能同步，漏掉了 `runUpdate`（`src/cli/init.ts`）实际执行的 workflow 相关逻辑：workflow/lang 探测与打印、WORKFLOW.md 漂移报告、`.tasking/WORKFLOW.md.reference` 引用模板。文档（`docs/{en,zh}/usage.md`）已正确描述该行为，帮助文本滞后。

## Goals / Non-Goals

**Goals:**
- `tasking init -h` 中 `--update` 描述与实际行为一致（技能同步 + WORKFLOW.md 漂移报告）。
- 逐条核对全部子命令与 option 描述，确认无其他失真项。
- 增加一条回归断言，防止帮助文本再次与实际行为脱节。

**Non-Goals:**
- 不修改任何命令、flag 的运行时行为。
- 不重写帮助渲染机制（`COMMANDS` 数组结构保持不变）。
- 不改文档（`docs/{en,zh}/usage.md` 已正确）。

## Decisions

**D1：只在 `help.ts` 改 `--update` 的 description 字符串。** 帮助文本的单一事实源就是 `COMMANDS` 数组，运行时行为无需改动。描述保持一行英文、沿用现有"动词短语 + 括号补充"风格（如 `--restore` 的写法）。新文案：
`Re-sync tasking skills (modified files backed up as <file>.bak) and report WORKFLOW.md drift vs the detected template`
备选：把描述拆成多行或加 note——被否，`renderCommand` 对 description 按单行渲染，且现有风格均为一行。

**D2：新增回归测试断言 `--update` 描述包含 workflow 漂移报告。** `tests/cli.test.ts` 的 `init --help covers init options` 目前只断言选项名出现；在其后加一条断言，校验 `--update` 描述包含 "WORKFLOW.md drift"（或等价语义），使帮助文本与实际行为的契约可测试。

**D3：不更新 openspec 主 specs 之外的目标。** `cli-runtime` 的"子命令帮助" requirement 只要求帮助含用法/选项说明，未约束描述准确性；通过 delta spec 增加该约束（以 `--update` 为例），并保持与实现一致。

## Risks / Trade-offs

- [描述文字与实际行为再次漂移] → D2 的回归断言 + delta spec 把"描述须含漂移报告语义"固化为 requirement。
- [其他命令存在未发现的不一致] → 已逐条对照 `index.ts`/`init.ts`/`daemon-info.ts` 核对全部 6 个子命令及 option，仅 `--update` 失真；后续靠评审兜底。
