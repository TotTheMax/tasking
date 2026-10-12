# 让 init / doctor 与 start 共用 workflow path

## Why

`tasking start` 早已接受位置参数 `[workflow-path]`，可加载任意位置的 `WORKFLOW.md`；但 `tasking init`（生成 / `--update` / `--restore`）与 `tasking doctor` 都把目标写死为 `cwd/WORKFLOW.md`。于是配置能放在别处运行、却无法在别处初始化、升级或体检——同一个部署的路径语义在三条命令间分裂，运维者只能靠 `cd` 绕开。

## What Changes

- `tasking init [workflow-path]`：**三种模式（生成 / `--force`、`--update`、`--restore`）都接受位置参数**；缺省 `./WORKFLOW.md`，相对 cwd 解析，与 `start` 完全一致。位置参数是**纯文件路径**（传目录视为错误）。生成模式下父目录不存在时 SHALL 递归创建。
- `tasking doctor [workflow-path]`：接受同一位置参数；缺省 `./WORKFLOW.md`。dotenv SHALL 从 `dirname(workflow path)` 加载（对齐 `start`）。
- **关联产物跟随 `dirname(workflow path)`**：skills 装到该目录 `.opencode/skills/`；漂移参考副本写到该目录 `.tasking/<basename>.reference`（原固定名 `WORKFLOW.md.reference` 改为按目标文件名）；备份沿用 `<workflow path>.bak`。
- 抽出共享的 `resolveWorkflowPath(cwd, positional)`（及关联目录派生），由 `start` / `init` / `doctor` 共用，保证三者语义唯一。
- `src/cli/help.ts` 为 `init` / `doctor` 补 `[workflow-path]`；双语 `docs/{zh,en}/usage.md` 同步用法。
- 新增 ADR 0033（workflow path 决定关联产物位置），并给 ADR 0007 加指针。
- 输出文案只把"指向具体目标文件"的 `WORKFLOW.md` 字样改为实际路径/`basename`；概念性文案（如"edit WORKFLOW.md manually"、doc 指引）保持原样。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-runtime`: init 生成骨架接受 `[workflow-path]`；“工作流文件路径解析”从仅 `start` 扩展为 `start` / `init` / `doctor` 共用同一 workflow path 语义。
- `init-update`: `--update` / `--restore` 在 workflow path 上作业，skills / `.tasking/` / `.bak` 跟随其所在目录。
- `interactive-init`: 交互式生成的写盘、备份、编辑器打开都指向 workflow path。
- `feishu-setup-doctor`: `doctor` 接受可选 `[workflow-path]`，dotenv 从 `dirname(path)` 加载。

## Impact

- **代码**：`src/cli/index.ts`（init/doctor 入口透传位置参数）、`src/cli/init.ts`（路径下传 + `basename`/`dirname` 派生 + 递归建父目录）、`src/cli/doctor.ts`（可选路径 + dotenv 基准）、`src/cli/help.ts`、新增共享路径解析 helper。
- **测试**：`tests/init.test.ts`（自定义路径的生成 / `--update` / `--restore`）、`tests/doctor.test.ts`（自定义路径 + dotenv 基准）、`tests/cli-commands.test.ts` / `tests/cli.test.ts`（位置参数透传）。现有 `runInit(dir, opts)` / `runDoctor(cwd, …)` 调用签名向后兼容（新增可选参数），旧用例不改。
- **文档**：`docs/{zh,en}/usage.md`；`docs/adr/0033-*`（新增）、`docs/adr/0007-*`（指针）。
- **门禁**：不触及 Feishu adapter / Jira adapter / scheduler / 评论桥，`npm run test:e2e` 非必需；按需跑命中子系统单测 + 全量 `npm run lint && npm run typecheck && npm test`。
