## Context

tasking worker (`opencode run`) 通过 `spawn(cmd, args, { env: process.env })` 启动子进程，环境变量直接继承 daemon 进程。Jira 凭据通过 MCP 工具（`jira_rest`）注入，经 `injectMcpConfig` 写入 `.opencode/opencode.json`，复用 `tracker.api_key`。但 GitLab 凭据（`GITLAB_TOKEN`）无配置入口，只能靠 daemon 启动前手动 `export`，且 agent 不知其在环境变量中。

agent 的 Jira 操作通过 `jira_rest` MCP 工具完成，但 agent 有 shell 权限（`--auto`），经常绕过 MCP 工具直接用 `curl` 调 Jira API，硬编码凭据。glab 操作同理——agent 不知 `GITLAB_TOKEN` 已在环境变量中，花时间搜索配置文件。

## Goals / Non-Goals

**Goals:**
- `env` 配置段：WORKFLOW.md 声明式注入环境变量到 worker 进程，与 Jira 凭据管理一致
- jira 技能强制规则：禁止 curl，必须用 `jira_rest` MCP 工具
- push/land 技能强制规则：glab 已预认证，直接使用

**Non-Goals:**
- GitLab MCP 工具（`gitlab_rest`）——glab CLI 已够用
- 凭据加密/密钥管理服务
- 禁止 agent 使用 shell 的技术手段（如 opencode permission deny）
- jira_rest MCP 工具本身的改动

## Decisions

### D1: `env` 配置段：声明式环境变量注入

WORKFLOW.md front matter 新增 `env` 段：

```yaml
env:
  GITLAB_TOKEN: $GITLAB_TOKEN
  GITLAB_HOST: $GITLAB_HOST
```

config resolver 解析 `env` 段：每个值支持 `$VAR` 间接引用（与 `tracker.api_key` 相同语义），解析为空字符串时视为缺失（值为空字符串）。

`EffectiveConfig` 新增 `env: Record<string, string>`。`DEFAULTS.env` 为空对象 `{}`。

### D2: runner spawn 合并 env

`runDefaultSubprocess` 或 `buildOpencodeCommand` 调用 `spawn` 时：

```typescript
spawn(cmd, args, {
  cwd,
  stdio: [...],
  env: { ...process.env, ...config.env },
  ...
});
```

`config.env` 的值已由 resolver 解析过 `$VAR`，此处直接合并到子进程环境。`process.env` 优先级低于 `config.env`——config 中显式声明的值覆盖继承的环境变量。

### D3: jira 技能强制规则

`assets/skills/jira/SKILL.md` 顶部（front matter 之后、正文最前面）加：

```markdown
## ⚠️ 强制规则

**禁止使用 curl、wget 或任何 HTTP 客户端直接调用 Jira REST API。**

所有 Jira 操作（transitions、comments、attachments、labels）必须通过 `jira_rest` MCP 工具完成。违反此规则会导致：
- 凭据暴露在命令行历史中
- 绕过 MCP 工具的认证与错误处理
- 操作不可追溯
```

### D4: push/land 技能 glab 预认证声明

`assets/skills/push/SKILL.md` 和 `assets/skills/land/SKILL.md` 顶部加：

```markdown
## ⚠️ 强制规则

**glab 已通过 `GITLAB_TOKEN` 环境变量预认证，直接使用 `glab` 命令。**

禁止：
- 搜索 token 文件（`~/.config/glab-cli/`、`~/.netrc` 等）
- 执行 `glab auth login` 或 `glab auth status`
- 用 `git push` + 手动在网页创建 MR 代替 `glab mr create`

直接使用 `glab mr create`、`glab mr view`、`glab mr merge` 等命令。
```

## Risks / Trade-offs

- [`env` 段值解析为空字符串时仍注入] — 空字符串环境变量可能导致 `glab` 报认证失败；agent 从技能指示中知道这是配置问题而非搜索问题
- [config.env 覆盖 process.env] — 设计如此：WORKFLOW.md 显式声明的值优先于继承的环境变量；未声明的变量仍从 process.env 继承
- [强制规则依赖 agent 遵守 prompt] — opencode agent 通常遵守 SKILL.md 中的 ⚠️ 强制规则；如需更强约束可在 `.opencode/opencode.json` 的 permission deny 中禁止 curl
