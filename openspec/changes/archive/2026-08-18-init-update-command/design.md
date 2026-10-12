## Context

`tasking init`（`src/cli/init.ts`）目前只有两种写入模式：初始安装（`copySkills` 对已存在技能目录一律跳过）与 `--force`（全量破坏性覆盖 WORKFLOW.md，丢凭证）。升级 `tasking` 后新版技能与 WORKFLOW.md 模板/prompt body 的改进无法带下来。`docs/known-issues.md` 待做第 1 条给出目标边界：技能 = tasking 拥有（自动更新）；WORKFLOW.md = 用户拥有（绝不自动覆盖）；config schema 靠 `DEFAULTS` 兜底。已确认的决策：技能改过则备份+警告后覆盖并提示备份位置，且新增回撤命令；`--update` 始终同步全部 6 个已发布技能；报告采用结构化形态（新增 config 字段 + prompt body diff）。

## Goals / Non-Goals

**Goals:**
- `tasking init --update` 非破坏性升级：同步全部 6 个技能（缺失新装、改过备份+覆盖）、不写 WORKFLOW.md、打印结构化漂移报告。
- `tasking init --restore` 回撤：把 `.opencode/skills/**` 下的 `.bak` 备份还原为当前技能文件。
- `--update`/`--restore`/`--force` 互斥；`--update` 要求已存在 WORKFLOW.md。

**Non-Goals:**
- 不做 workflow 探测来决定同步技能集（已确认始终同步全部）。
- 不实现 `.skill-lock` 锁定机制（留作后续）。
- 不自动写回 WORKFLOW.md 或 config。
- 不引入新的运行时依赖。

## Decisions

1. **模式路由在 `runInit` 内**：`InitOptions` 增加 `update`/`restore`；`runInit` 先校验三个布尔 mode 互斥（`--force`/`--update`/`--restore` 同时给则报错返回 1），再分派 `runUpdate`/`runRestore`。两者均无交互提示，走非交互输出路径（`opts.output ?? process.stdout`）。
   - 备选：新增 `tasking upgrade` 子命令。被 issue 描述否决（明确要 `tasking init --update`）。

2. **技能同步 = 全量 6 个，逐文件字节比对**：复用 `skillsForWorkflow("grill-openspec")` 作为全部技能清单。对每个 `<skill>/<file>`：目标不存在 → 拷贝（ok）；存在且字节一致（`Buffer.equals`）→ 跳过（up to date）；存在且不一致 → 先把目标复制为 `<file>.bak`（同目录，重复运行时覆盖旧备份），再覆盖，打印警告并告知备份路径。
   - 备选：按 workflow 探测同步子集 —— 已确认放弃（收益不高）。
   - 备选：`.skill-lock` 锁定 —— 已确认放弃（留后续）。

3. **WORKFLOW.md 报告只读不改**：用 `parseWorkflowContent`（`src/config/loader.ts`）分别解析用户 WORKFLOW.md 与当前模板，产出两部分：
   - **新增 config 字段**：递归比对模板 frontmatter 与用户 frontmatter，收集模板中有而用户没有的 dotted path（如 `opencode.variant`），默认值取模板值。
   - **prompt body diff**：对两侧 `prompt_template` 做行级 LCS unified diff（仅 `-`/`+` 行），frontmatter 不进 diff，避免凭据噪音。
   - 模板选择：无 `--workflow` 时从用户 prompt body 标记探测（含 `## 🔍 拷问 / Grill Questions` → grill-openspec，否则 default）；探测不出按 default。探测只影响报告模板，不影响技能同步（始终全量）。
   - diff 用自实现的行级 LCS（约 40 行），不引入外部 diff 依赖、不依赖 `diff` CLI。

4. **`--restore` 只动 `.bak`**：递归扫描 `wfDir/.opencode/skills/**/*.bak`，逐个 `renameSync` 还原为去 `.bak` 的原名（覆盖当前技能文件）。无备份 → 打印提示，退出 0。

5. **CLI 接线**：`src/cli/index.ts` 的 init `parseArgs` 增加 `update`/`restore` 布尔 flag，透传给 `runInit`；USAGE 增加两行。

## Risks / Trade-offs

- [备份被多次 `--update` 覆盖] → `.bak` 只保留最近一次运行前的用户版本；回撤 = 回到上次 update 前，符合直觉且实现简单。将来要保留历史可再演进。
- [探测 workflow 失败导致报告模板错配] → 影响仅报告内容；`--workflow` 可显式覆盖，探测逻辑只认固定的模板标记，错配概率低。
- [`--update` 报告含用户敏感值（如 `env:` 中的 token）] → 报告只列新增字段路径+模板默认值、prompt body diff，不打印用户 frontmatter 内容；模板默认值无敏感信息。
- [自实现 diff 与 `git diff` 风格不一致] → 目的只是给人看改动概览，行级 `-`/`+` 足够；不追求补丁可应用性。

## Migration Plan

纯增量：`npm run build` 产出新 CLI；用户按需运行 `tasking init --update`。回滚 = `tasking init --restore`。无 schema/存储迁移。
