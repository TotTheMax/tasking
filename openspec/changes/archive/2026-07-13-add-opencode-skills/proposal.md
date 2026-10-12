## Why

tasking 当前 agent 指引全部在 `WORKFLOW.md` prompt body 中，缺少结构化的 git/MR 操作技能。Symphony 有 6 个 `.codex/skills/` 技能（commit、pull、push、land、debug、linear），但它们针对 Codex + GitHub + Linear，不能直接用于 opencode + GitLab + Jira。三层超时模型已就绪（不活跃 10min + 墙钟 1h + stall 2h + SIGKILL），agent 在单 turn 内可长时间持续工作，使得 land 这类需要轮询 CI/review 的长流程变为可行。

## What Changes

- 新增 5 个 opencode 技能文件（`.opencode/skills/*/SKILL.md`），预放在开发仓库中，随 `after_create` hook 的 git clone 进入 workspace：
  - `commit`：规范化 git commit（session 上下文 → 分析变更 → 类型前缀 → 72 列消息 → `git commit -F`）
  - `pull`：merge origin/main 到特性分支 + 冲突解决指导（zdiff3、rerere）
  - `push`：push 分支 + 创建/更新 GitLab MR（`glab mr create`）
  - `debug`：tasking 日志关联追踪（`tasking.log`、`task_identifier`/`session_id` 关联键）
  - `land`：GitLab MR 落地（CI 监控 + review 处理 + squash-merge + `land_watch.py` 传感器）
- 新增 `land_watch.py`（GitLab API 版），替代 Symphony 的 GitHub API 版本
- 跳过 Symphony 的 `linear` skill（已被 `jira_rest` MCP 工具 + WORKFLOW.md 覆盖）
- `land` skill 去掉 Codex Review bot 逻辑（GitLab 无等价机制），只保留人类 review 评论处理
- WORKFLOW.md prompt body 新增技能引用指引（`{% if attempt %}` 场景引导 agent 使用 land 技能）
- 迁移过程中发现并修复 tasking 流程不足之处

## Capabilities

### New Capabilities

- `opencode-skills`: opencode 技能系统——预放在开发仓库 `.opencode/skills/` 目录中的 `SKILL.md` 文件，随 workspace 初始化自动可用，agent 通过 opencode 原生 skill 加载机制读取并执行

### Modified Capabilities

- `workflow-prompt-optimization`: WORKFLOW.md prompt body 新增 attempt > 1 时引用 land 技能的指引段落
- `opencode-worker`: 明确技能文件在 workspace 中的位置约定和加载方式（不注入，由仓库自带）

## Impact

- 新增 `assets/skills/` 目录存放技能模板（或直接写入目标仓库，取决于实现方式）
- 新增 `assets/skills/land/land_watch.py`（GitLab API 版传感器脚本）
- `WORKFLOW.md.example` prompt body 新增技能引用段落
- `docs/` 新增技能说明文档
- 测试：技能文件内容验证（front matter 格式、命令映射正确性）、`land_watch.py` 逻辑测试（mock GitLab API）
- 可能发现并修复 tasking 在 workspace 初始化、skill 加载、prompt 引用方面的不足
