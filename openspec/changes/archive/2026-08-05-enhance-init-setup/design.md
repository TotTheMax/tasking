## Context

`tasking init` 目前只处理 Jira 凭据收集和 opencode 安装检查。但 agent 运行还需两个运行时依赖：

1. **glab CLI** — `land` skill 用它创建、监控、合并 MR。当前 init 不检查 glab 是否安装。
2. **GITLAB_TOKEN / GITLAB_HOST** — glab 预认证所需环境变量。WORKFLOW.md.example 的 `env:` 段已含 `$GITLAB_TOKEN` / `$GITLAB_HOST` 引用，但 init 不提示用户设置。

此外 `land` skill（`assets/skills/land/{SKILL.md, land_watch.py}`）需要放在仓库的 `.opencode/skills/land/` 目录下 agent 才能使用。当前用户需手动从 tasking 包拷贝。

init 有两条路径：
- **交互式**（`runInteractiveInit`）：收集 Jira 凭据 → 测试连接 → 写 WORKFLOW.md → checkOpencode → openEditor → printCompletionHint
- **非交互式**（`runNonInteractiveInit`）：拷 WORKFLOW.md.example → 创建工作区目录 → 打印路径

## Goals / Non-Goals

**Goals:**
- 在交互式 init 中检测 glab 是否安装，缺失时打印警告（不阻断）
- 在交互式 init 中，当 `GITLAB_TOKEN` 环境变量未设时，打印 GitLab 凭据提示（两种方式：export 或直接写配置）
- 在交互式 + 非交互式 init 中，将 `land` skill 拷贝到 `.opencode/skills/land/`（相对 WORKFLOW.md 目录）
- 永不覆盖已存在的 skill 文件

**Non-Goals:**
- 交互式收集 GitLab 凭据 — init 保持 Jira 为中心
- 检查 python3 可用性 — `land_watch.py` 依赖，过于细粒度
- 安装其他 skill（commit/pull/push/debug/jira）— 仅 `land` 是 MR 生命周期必需
- 验证 GitLab 连通性 — 类似 Jira 连接测试，但 GitLab 凭据不是 init 收集的

## Decisions

### D1: checkGlab 镜像 checkOpencode

`which glab` 检查，找不到打印警告，不阻断。放在 `checkOpencode` 之后。

**为什么**：opencode 和 glab 是 agent 的两个硬依赖——opencode 是 worker 本体，glab 是 MR 工具。对称检查让用户在 init 阶段就发现缺失，而非 agent 跑到合并 MR 时才失败。

### D2: GitLab 提示条件触发

仅当 `process.env.GITLAB_TOKEN` 未设时打印提示。提示内容说明两种方式：export 环境变量（`~/.bashrc`）或直接写 `env:` 配置段。

**为什么**：`JIRA_API_KEY` tip 无条件打印是因为用户刚在交互式问答中输入了 token。GitLab token 不走交互收集——如果环境变量已设，说明用户已知道，提示是噪音；未设才需要提示。

### D3: skill 直接拷到 .opencode/skills/land/

拷贝目标为 WORKFLOW.md 同目录下的 `.opencode/skills/land/`，不是旁边临时目录。

**为什么**：SKILL.md 中 `land_watch.py` 路径硬编码为 `.opencode/skills/land/land_watch.py`。拷到别处再让用户移，路径不对则 agent 调用脚本时找不到文件。直接拷到最终位置零摩擦。

### D4: 永不覆盖已存在 skill

`.opencode/skills/land/` 已存在则静默跳过，不管 `--force`。

**为什么**：WORKFLOW.md 是配置模板，`--force` 重拿新模板合理。skill 是用户可能深度定制的内容（改步骤、改脚本逻辑），覆盖风险高。已存在说明用户已有此 skill，不需再拷。

### D5: 非交互式也拷 skill

`runNonInteractiveInit` 也调用 skill 拷贝逻辑。

**为什么**：skill 拷贝是文件操作（同拷 WORKFLOW.md.example），不是人向提示。CI/自动化场景也需 skill 文件就位。GitLab 提示不加到非交互式（那是提醒人做事），但 skill 拷贝是替人放文件。

### D6: 拷贝失败不阻断

skill 拷贝出错（权限不足等）只打印警告，init 继续执行。

**为什么**：与 checkOpencode 一致——init 不应因辅助文件拷贝失败而中止主流程。用户可后续手动拷。

## Risks / Trade-offs

- [GITLAB_TOKEN 在当前 shell 已设但未写入 .bashrc] → init 跳过提示，但后续 daemon 启动时可能没有此变量。与 JIRA_API_KEY 同等风险，可接受。
- [skill 拷贝因权限不足失败] → 打印警告，init 继续。用户可手动从 tasking 包拷贝。
- [用户已自定义 land skill] → 永不覆盖保护用户改动。但用户无法通过 init 更新到新版 skill——需手动删除旧版再跑 init。
