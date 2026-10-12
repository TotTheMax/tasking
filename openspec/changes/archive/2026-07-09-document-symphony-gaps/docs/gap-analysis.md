# Symphony vs tasking 全部差异总览

> 本文档基于对 Symphony 仓库(`/home/xjiang3/workspace/local/symphony/symphony/`)全部文件的逐行比对生成。
> 比对范围:`SPEC.md`(2182 行)、`WORKFLOW.md`、`lib/` 下全部 22 个 `.ex` 文件、`.codex/skills/` 6 个技能、`docs/`、`test/` 全部 16 个测试文件、`.github/` CI/PR 模板、`flow.html` 架构图、`mix.exs`、`config.exs`,以及 tasking `src/` 全部 31 个 `.ts` 文件和 `tests/` 全部 16 个测试文件。

## 文档索引

| 文档 | 内容 |
|---|---|
| `symphony-only.md` | Symphony 有而 tasking 完全没有的能力 |
| `bugs-and-incomplete.md` | 两边都有但 tasking 有 bug 或不完善 |
| `implementation-differences.md` | 两边都有但实现机制不同 |
| `tasking-only.md` | 只有 tasking 有的能力(Symphony 没有) |
| `recommendations.md` | 根据实际情况建议 tasking 补齐/修复的优先级清单 |

## 差异统计

| 类别 | 数量 |
|---|---|
| Symphony 独有能力(tasking 完全没有) | ~45 项 |
| 两边都有但 tasking 有 bug/不完善 | ~25 项 |
| 两边都有但实现机制不同 | ~20 项 |
| tasking 独有能力(Symphony 没有) | ~12 项 |

## 有意替换(非缺口)

以下三处替换是设计决策,不算缺口:

1. **Linear → Jira**:GraphQL → REST/JQL,`project.slugId` → `project_key`/`project_slug`,cursor 分页 → offset 分页
2. **Codex app-server → `opencode run` CLI**:JSON-RPC 长连接 → 一次性子进程,thread/turn 协议 → `-s sessionId` 续接
3. **Elixir → TypeScript**:OTP GenServer → 类 + setTimeout/async-await,`Process.monitor` → AbortController

## 永久有意取舍(不计划补齐)

| 取舍 | 理由 |
|---|---|
| 不实现 Codex app-server JSON-RPC 协议 | `opencode run` 是稳定的 CLI 入口,协议耦合是维护风险 |
| 不实现 SSH worker 扩展 | 单机模型对 v1 足够,SSH 是附录 A 可选项 |
| 不实现 approval/user-input/dynamic-tool 协议层 | 由 `opencode` CLI 自行处理,tasking 不介入 |
| 不实现 `linear_graphql` 动态工具 | 用 MCP `jira_rest` 替代,集成模型不同 |
| 不实现 LiveView websocket | 用 SSE 或客户端轮询替代,不引入 Phoenix |
| 不实现 Erlang 热代码重载 | Node 不原生支持 |
