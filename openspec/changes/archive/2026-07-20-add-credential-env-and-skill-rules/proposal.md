## Why

Agent 运行时有两个反复出现的问题：(1) agent 绕过 `jira_rest` MCP 工具，直接用 `curl` 调 Jira API，导致凭据硬编码在命令行中；(2) agent 使用 `glab` 时不知 token 已在环境变量中，花大量时间搜索配置文件，多次失败后甚至退回用 `git` 手动创建 MR。根因是凭据未通过配置统一注入 worker 环境，且技能文件缺乏强制约束。

## What Changes

- WORKFLOW.md front matter 新增 `env` 段：`env: { GITLAB_TOKEN: $GITLAB_TOKEN, GITLAB_HOST: $GITLAB_HOST }`，与 Jira 凭据管理方式一致
- config resolver 解析 `env` 段的 `$VAR` 间接引用，解析为空字符串时视为缺失
- runner spawn `opencode run` 时合并 `config.env` 到子进程环境变量
- jira 技能新增强制规则：禁止 curl/wget/任何 HTTP 客户端直接调 Jira API，必须用 `jira_rest` MCP 工具
- push/land 技能新增强制规则：`glab` 已通过 `GITLAB_TOKEN` 环境变量预认证，直接使用 `glab` 命令，禁止搜索 token 文件或 `glab auth login`

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cli-runtime`: 新增 `env` 配置段解析与 `$VAR` 间接引用
- `opencode-worker`: worker spawn 时合并 `config.env` 到子进程环境变量
- `opencode-skills`: jira 技能新增禁止 curl 强制规则；push/land 技能新增 glab 预认证声明

## Impact

- `src/config/config-types.ts` — 新增 `EnvConfig` 接口与 `DEFAULTS.env`
- `src/config/resolver.ts` — 解析 `env` 段，`$VAR` 间接引用
- `src/worker/runner.ts` — spawn 时合并 `config.env` 到 `env`
- `assets/skills/jira/SKILL.md` — 顶部加强制规则
- `assets/skills/push/SKILL.md` — 顶部加强制规则
- `assets/skills/land/SKILL.md` — 顶部加强制规则
- `WORKFLOW.md.example` — front matter 加 `env` 段示例
- `tests/config.test.ts` — env 解析测试
- `tests/worker.test.ts` — env 注入测试
- `docs/configuration.md` — env 段文档
