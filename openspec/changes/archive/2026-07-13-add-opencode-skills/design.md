## Context

Symphony 有 6 个 `.codex/skills/` 技能（commit、pull、push、land、debug、linear），针对 Codex + GitHub + Linear 技术栈。tasking 使用 opencode + GitLab + Jira，需要迁移这些技能并做三处替换：

- Codex app-server → `opencode run`（一次性子进程，非长连接）
- GitHub CLI (`gh`) → GitLab CLI (`glab`)
- Linear GraphQL → Jira REST（已有 `jira_rest` MCP 工具）

三层超时模型已就绪（不活跃 10min + 墙钟 1h + stall 2h + SIGKILL），agent 在单 turn 内可长时间持续工作。opencode 原生支持 `.opencode/skills/*/SKILL.md` 格式（tasking 自身的 `.opencode/skills/` 已用此格式）。

技能文件不通过 tasking 代码注入——预放在开发仓库的 `.opencode/skills/` 目录中，随 `after_create` hook 的 `git clone` 进入 workspace。`injectMcpConfig` 只写 `.opencode/opencode.json`（merge 语义），不碰 skills 目录。

## Goals / Non-Goals

**Goals:**
- 迁移 5 个技能（commit、pull、push、debug、land）到 tasking 适配的 opencode 技能格式
- 新增 `land_watch.py` GitLab API 版传感器脚本
- WORKFLOW.md prompt body 新增技能引用指引
- 技能文件和脚本经过测试验证
- 发现并修复迁移过程中暴露的 tasking 流程不足

**Non-Goals:**
- 不迁移 `linear` skill（已被 `jira_rest` MCP 工具覆盖）
- 不实现 Codex Review bot 系统（GitLab 无等价机制，只保留人类 review 处理）
- 不修改 tasking 的 workspace 注入逻辑（技能由仓库自带，不注入）
- 不修改三层超时模型（已就绪）

## Decisions

### 决策 1：技能预放在开发仓库，不通过 tasking 注入

**选择**：技能文件放在开发仓库的 `.opencode/skills/` 目录，随 `after_create` 的 `git clone` 进入 workspace。

**理由**：
- `injectMcpConfig` 只写 `.opencode/opencode.json`（merge 语义），不碰 skills 目录
- 技能跟代码版本绑定，不同仓库可以有不同技能
- 零代码改动——不需要新增注入逻辑
- opencode 原生从 `.opencode/skills/` 加载技能

**备选**：tasking 在 workspace 初始化时注入技能模板。增加代码复杂度，且不同仓库需要不同技能时灵活性差。

### 决策 2：技能文件存放在 tasking 仓库的 `assets/skills/` 作为参考模板

**选择**：在 tasking 仓库的 `assets/skills/` 目录存放技能模板文件，供用户复制到自己的开发仓库。

**理由**：
- 提供开箱即用的参考实现
- 不强制用户从 Symphony 仓库搬运
- 用户可以根据自己的仓库定制

### 决策 3：`land_watch.py` 从 GitHub API 改写为 GitLab API

**选择**：保留 Python asyncio 框架和 exit code 协议，替换所有 API 调用。

**替换映射**：

| 功能 | Symphony (GitHub) | tasking (GitLab) |
|------|-------------------|-------------------|
| MR 信息 | `GET /repos/.../pulls/<n>` | `GET /projects/:id/merge_requests/:iid` |
| mergeable | `pr.mergeable` | `mr.detailed_merge_status` |
| CI 状态 | `GET /commits/<sha>/check-runs` | `GET /projects/:id/merge_requests/:iid/pipelines` |
| review 评论 | `GET /pulls/<n>/comments` + `GET /issues/<n>/comments` | `GET /projects/:id/merge_requests/:iid/discussions` |
| approve | `GET /pulls/<n>/reviews` | `GET /projects/:id/merge_requests/:iid/approvals` |
| merge | `gh pr merge --squash` | `glab mr merge --squash` |
| CLI | `gh api` | `glab api` |

**去掉的逻辑**：
- Codex Review bot 过滤（`## Codex Review — <persona>` 评论处理）
- bot 用户过滤（`CODEX_BOTS` 集合）
- `[codex]` 前缀回复协议

**保留的逻辑**：
- asyncio 三路并发监控（review + CI + head SHA）
- exit code 协议（0=成功, 2=review, 3=CI失败, 4=head变化, 5=冲突）
- 指数退避 rate limit 处理
- 轮询去重（check runs / pipelines 按 name 去重取最新）

### 决策 4：WORKFLOW.md prompt body 新增技能引用

**选择**：在 `{% if attempt %}` 分支中新增技能引用指引，告诉 agent 使用技能。

```liquid
{% if attempt %}
This is attempt {{ attempt }}. Check `git status` and `git log` to see what was done. Continue any unfinished work.
If you have an open MR, use the `land` skill to monitor CI, address review feedback, and merge when ready.
{% else %}
...
{% endif %}
```

**理由**：agent 在 attempt > 1 时可能已经有 MR 在 review 中，需要 land 技能处理后续流程。首次 attempt 不需要（还没有 MR）。

### 决策 5：debug 技能重写为 tasking 日志格式

**选择**：保留 Symphony debug 技能的关联追踪方法论，替换为 tasking 的日志路径和事件名。

| | Symphony | tasking |
|---|---|---|
| 日志文件 | `log/symphony.log*` | `tasking.log` |
| 任务关联键 | `issue_identifier` / `issue_id` | `task_identifier` / `task_id` |
| 会话关联键 | `session_id`（`thread_id-turn_id`） | `session_id`（opencode session） |
| 生命周期事件 | `Codex session started/completed` | `dispatch` / `turn_started` / `turn_completed` |
| stall 信号 | `Issue stalled ... restarting with backoff` | `stalled run terminated` |
| retry 信号 | `scheduling retry` | `scheduleRetry` |

### 决策 6：测试策略

**选择**：
- 技能文件内容测试：验证 front matter 格式、命令映射正确性
- `land_watch.py` 单元测试：mock GitLab API 响应，验证 exit code 逻辑
- WORKFLOW.md prompt 测试：验证 `{% if attempt %}` 分支包含技能引用
- 集成验证：确认 workspace 初始化后 `.opencode/skills/` 可被 opencode 加载

## Risks / Trade-offs

- **[风险] `glab` CLI 可用性** → agent 运行环境需要有 `glab` 在 PATH 上。缓解：在 skill 中说明前置条件，提示用户确保 `glab auth status` 可用。

- **[风险] GitLab MR review 模型与 GitHub PR 不同** → GitLab 用 discussions（统一线程），GitHub 用 issue comments + inline review comments。land_watch.py 的评论过滤逻辑需要适配 GitLab 的 discussions API。缓解：在改写时统一用 `GET /discussions` 端点。

- **[风险] GitLab CI 无 `--watch` 等价** → `gh pr checks --watch` 是阻塞等待，`glab ci status` 是一次性查询。land_watch.py 已有轮询循环（每 10s），改为轮询 `glab ci status` 即可。

- **[取舍] 技能预放在仓库** → 每个仓库需要维护自己的技能副本。缓解：tasking 仓库的 `assets/skills/` 提供参考模板，用户可以直接复制。

- **[风险] 迁移过程中发现 tasking 流程不足** → 可能需要在迁移中暂停修复 bug。缓解：每个 bug 修复单独处理，不阻塞技能迁移主线。

## Open Questions

- `land_watch.py` 的 GitLab project ID 解析：是从 MR URL 中提取还是从 `glab mr view` 输出中解析？需要在实现时确定。
- GitLab MR 的 `detailed_merge_status` 枚举值与 GitHub 的 `mergeable` 字段映射需要验证（不同 GitLab 版本可能不同）。
