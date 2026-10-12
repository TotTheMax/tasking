## 1. env 配置段

- [x] 1.1 `src/config/config-types.ts`：新增 `EnvConfig` 接口（`Record<string, string>`），`EffectiveConfig` 新增 `env: EnvConfig`，`DEFAULTS.env` 为 `{}`
- [x] 1.2 `src/config/resolver.ts`：解析 `env` 段——遍历键值对，对含 `$VAR` 的值用 `resolveDollarVar` 解析（与 `tracker.api_key` 相同逻辑），空环境变量解析为空字符串；`env` 段缺失时默认 `{}`
- [x] 1.3 `src/config/validator.ts`：`env` 段无必需校验（空对象合法）

## 2. runner env 注入

- [x] 2.1 `src/worker/runner.ts` `runDefaultSubprocess`：`spawn` 的 `env` 参数改为 `{ ...process.env, ...opts.config.env }`
- [x] 2.2 `src/worker/runner.ts` `RunAttemptOptions` 的 `config` 类型确保含 `env` 字段（从 `EffectiveConfig` 传入，已含）

## 3. jira 技能强制规则

- [x] 3.1 `assets/skills/jira/SKILL.md`：正文最前面（front matter 之后）加 `## ⚠️ 强制规则` 小节，内容为禁止 curl/wget/HTTP 客户端直接调 Jira API，必须用 `jira_rest` MCP 工具，列出违反后果

## 4. push/land 技能 glab 预认证声明

- [x] 4.1 `assets/skills/push/SKILL.md`：正文最前面加 `## ⚠️ 强制规则` 小节，声明 glab 已通过 `GITLAB_TOKEN` 预认证，禁止搜索 token/`glab auth login`/手动创建 MR
- [x] 4.2 `assets/skills/land/SKILL.md`：同上，加相同的 `## ⚠️ 强制规则` 小节

## 5. WORKFLOW.md.example 示例

- [x] 5.1 `WORKFLOW.md.example`：front matter 加 `env` 段示例（`GITLAB_TOKEN: $GITLAB_TOKEN`、`GITLAB_HOST: $GITLAB_HOST`）

## 6. 测试

- [x] 6.1 `tests/config.test.ts`：`env` 段 `$VAR` 解析——设环境变量后配置含解析值
- [x] 6.2 `tests/config.test.ts`：`env` 段缺失默认空对象
- [x] 6.3 `tests/config.test.ts`：`env` 段空环境变量解析为空字符串
- [x] 6.4 `tests/worker.test.ts`：spawn 时 `config.env` 合并到子进程环境——mock spawnRunner 验证 env 参数含 `config.env` 的键值
- [x] 6.5 `tests/skills.test.ts`：jira 技能含强制规则禁止 curl
- [x] 6.6 `tests/skills.test.ts`：push 技能含 glab 预认证声明
- [x] 6.7 `tests/skills.test.ts`：land 技能含 glab 预认证声明

## 7. 文档

- [x] 7.1 `docs/configuration.md`：新增 `env` 段字段说明（类型、默认值、`$VAR` 解析规则）
- [x] 7.2 运行 `npm run lint && npm run typecheck && npm test` 全部通过
