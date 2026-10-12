## MODIFIED Requirements

### Requirement: 配置解析含默认值与环境变量间接引用
配置层 SHALL 解析 `WORKFLOW.md` 的 YAML front matter,为可选字段应用内置默认值,仅对显式包含 `$VAR_NAME` 的值解析 `$VAR_NAME` 间接引用,对路径字段展开 `~`,并将相对 `workspace.root` 解析为相对于 `WORKFLOW.md` 所在目录。环境变量 SHALL NOT 全局覆盖 YAML 值。配置层 SHALL 支持 `env` 段:值为 `Record<string, string>`,每个值的 `$VAR_NAME` 间接引用 SHALL 以环境变量值替换,解析为空字符串时 SHALL 注入空字符串值。`env` 段缺失时 SHALL 默认为空对象。

#### Scenario: 缺失可选字段应用默认值
- **WHEN** `WORKFLOW.md` 省略 `polling.interval_ms`
- **THEN** 生效配置使用文档化的默认值

#### Scenario: 美元变量解析
- **WHEN** `tracker.api_key` 为 `$JIRA_TOKEN` 且环境设置了 `JIRA_TOKEN`
- **THEN** 解析后的配置使用该环境变量的值

#### Scenario: 空环境变量视为缺失
- **WHEN** `$VAR_NAME` 解析为空字符串
- **THEN** 该值视为缺失

#### Scenario: 家目录展开
- **WHEN** `workspace.root` 为 `~/tasking`
- **THEN** 展开为用户家目录

#### Scenario: 相对工作区根
- **WHEN** `workspace.root` 为相对路径且 `WORKFLOW.md` 位于 `/repo/WORKFLOW.md`
- **THEN** 生效根解析为相对于 `/repo`

#### Scenario: env 段美元变量解析
- **WHEN** `env.GITLAB_TOKEN` 为 `$GITLAB_TOKEN` 且环境设置了 `GITLAB_TOKEN`
- **THEN** 解析后的 `env.GITLAB_TOKEN` 使用该环境变量的值

#### Scenario: env 段缺失默认空对象
- **WHEN** `WORKFLOW.md` 省略 `env` 段
- **THEN** 生效配置的 `env` 为空对象 `{}`
