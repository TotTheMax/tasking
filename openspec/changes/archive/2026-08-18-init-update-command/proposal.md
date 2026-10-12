## Why

升级 `tasking`（`npm i -g @ai-agent-infra/tasking@new`）后，新版的技能与 WORKFLOW.md 模板/prompt body 改动不会流到用户环境：`tasking init` 对已存在的技能目录一律跳过（`src/cli/init.ts` 的 `copySkills`），而 `--force` 是全量破坏性覆盖（会丢凭证）。用户没有一条"把 tasking 拥有的资产带上来、同时不碰我拥有的 WORKFLOW.md"的升级路径（见 `docs/known-issues.md` 待做第 1 条）。

## What Changes

- 新增 `tasking init --update` 非破坏性升级操作：从 `assets/skills/` 同步**全部 6 个** tasking 拥有的技能到 `.opencode/skills/`（缺失即新装；与源字节不一致的既有文件先备份为 `<file>.bak` 并打印警告，然后覆盖）。
- `--update` SHALL NOT 写 WORKFLOW.md，只打印结构化报告：新增 config 字段清单（模板 frontmatter 有而用户文件没有的键）+ 默认值；以及 prompt body 的 unified diff（frontmatter 不进 diff，避免凭据噪音）。
- 新增 `tasking init --restore` 回撤操作：把 `.opencode/skills/**` 下的每个 `.bak` 备份还原为当前技能文件，恢复 `--update` 覆盖前的用户版本。
- `--update`、`--restore`、`--force` 三者互斥；`--update`/`--restore` 要求已有 WORKFLOW.md。
- 更新 `docs/usage.md`（命令文档）与 `docs/known-issues.md`（移除已实现的待做项）。

## Capabilities

### New Capabilities
- `init-update`: `tasking init --update` 技能同步（备份+警告+覆盖）与 `tasking init --restore` 回撤，以及 WORKFLOW.md 结构化漂移报告（新增字段 + prompt body diff）。

### Modified Capabilities
<!-- 无现有 spec 的 REQUIREMENT 发生变化；新行为由 init-update 独立承载。 -->

## Impact

- `src/cli/init.ts`：新增 `update`/`restore` 模式入口、技能同步/备份/回撤逻辑、WORKFLOW.md 报告逻辑；`copySkills` 保持原样（`init` 初始安装仍跳过已有技能）。
- `src/cli/index.ts`：`tasking init` 的 `parseArgs` 增加 `--update` / `--restore` 布尔 flag；USAGE 更新。
- `tests/init.test.ts`：新增 `--update` / `--restore` 用例。
- 依赖 `node:fs`/`node:path` 现有 API；无新增依赖。
