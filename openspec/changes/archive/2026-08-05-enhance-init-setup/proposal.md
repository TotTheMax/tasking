## Why

`tasking init` 只收集 Jira 凭据和检查 opencode，但 agent 运行还需要两个依赖：`glab` CLI（MR 生命周期管理）和 `GITLAB_TOKEN`/`GITLAB_HOST` 环境变量（glab 预认证）。此外 `land` skill 需要手动从 tasking 包拷到仓库的 `.opencode/skills/land/`。用户往往在 agent 跑到合并 MR 那一步才发现缺少这些依赖。

## What Changes

- `tasking init` 交互式流程新增 `glab` CLI 安装检查（`which glab`），找不到打印警告，不阻断——与 `checkOpencode` 对称
- 交互式流程新增 GitLab 环境变量条件提示：`process.env.GITLAB_TOKEN` 未设时打印，提示内容说明两种方式（export 环境变量或直接写 `env:` 配置段）
- `tasking init`（交互式 + 非交互式）新增 `land` skill 安装：拷贝 `assets/skills/land/{SKILL.md, land_watch.py}` 到 WORKFLOW.md 同目录下的 `.opencode/skills/land/`，已存在则跳过（永不覆盖），拷贝失败不阻断

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `interactive-init`: 新增 glab 安装检查、GitLab 环境变量条件提示、land skill 安装三个需求
- `cli-runtime`: init 生成工作流骨架需求增加 skill 安装行为（非交互式路径也拷贝 land skill）
- `opencode-skills`: 技能文件格式需求增加 `tasking init` 作为替代安装路径

## Impact

- `src/cli/init.ts`：新增 `checkGlab`、`printGitLabHint`（条件触发）、`copySkill` 函数；`runInteractiveInit` 和 `runNonInteractiveInit` 调用 `copySkill`
- `tests/init.test.ts`：新增 glab 检查、GitLab 提示条件触发、skill 拷贝（已存在跳过、文件完整性）测试
- `assets/skills/land/`：skill 源文件（`SKILL.md` + `land_watch.py`），跳过 `__pycache__`
- `openspec/specs/interactive-init/spec.md`：新增三个需求
- `openspec/specs/cli-runtime/spec.md`：修改 init 需求
- `openspec/specs/opencode-skills/spec.md`：修改技能文件格式需求
