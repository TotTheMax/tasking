## Context

`buildOpencodeCommand`（`src/worker/runner.ts`）负责把 `OpencodeConfig` 组装成 `opencode run` 子进程参数：`<command> --format json [--auto] [-s <session>] --dir <workspace> --agent <agent> "<prompt>"`。`OpencodeConfig` 由 `resolveConfig`（`src/config/resolver.ts`）从 `WORKFLOW.md` frontmatter 的 `opencode` 块解析，默认值在 `DEFAULTS.opencode`（`src/config/config-types.ts`）。

opencode CLI 的 `opencode run` 已支持 `--model <provider/model>` 与 `--variant <reasoning effort>` 两个标志（opencode 1.18 实测 `opencode run --help`）。当前 tasking 无法通过 workflow 配置指定它们。

## Goals / Non-Goals

**Goals:**

- workflow 配置的 `opencode` 块可指定 `model` 与 `variant`，映射到 `opencode run --model` / `--variant`。
- 默认不配置（`null`），不追加标志——对现有配置零行为变化（向后兼容）。
- 两个选项彼此独立、均可选。

**Non-Goals:**

- 不校验 `model`/`variant` 的取值合法性（provider/model 格式、档位是否被 provider 支持等交由 opencode 自身处理）。
- 不新增 provider/model 发现、不写 `~/.config/opencode` 全局配置。
- 不动 session 续轮、token 记账、MCP 注入、调度器。

## Decisions

1. **字段放 `opencode` 块，命名 `model`/`variant`**。与 `command`/`agent` 同居一处、语义一致（都是 opencode 子进程的启动参数）；命名直接对齐 opencode CLI 标志，避免映射歧义。被否：放顶层独立块（无必要，散落）；命名 `model_name`/`variant_name`（与 CLI 不一致，徒增映射心智）。

2. **默认 `null` = 不追加标志**。`DEFAULTS.opencode.model = null`、`variant = null`；`resolver` 用 `asStringOrNull` 解析（空串/缺失/非字符串 → `null`）。`buildOpencodeCommand` 仅在非空时追加 `--model`/`--variant`。被否：默认空串然后条件判断（与 `asStringOrNull` 已有约定不符，且 `command`/`agent` 之外没有空串默认先例）。

3. **用长标志 `--model`/`--variant`**，不用短标志 `-m`（`--variant` 无短标志）。与代码中已用的 `--format`/`--agent`/`--dir` 长标志风格一致，可读性好。

4. **标志插入位置**：`--agent <agent>` 之后、prompt 之前，即 `<command> ... --agent <agent> [--model <model>] [--variant <variant>] "<prompt>"`。与既有顺序（`--dir` 在 `--agent` 前）不冲突，仅追加两段可选参数。

5. **两者独立、不互相校验**。可只配 `model` 不配 `variant`（用 opencode 默认档位）或反之。`variant` 是否要求 `model` 由 opencode 判定，tasking 不前置约束——保持薄封装。

## Risks / Trade-offs

- **[model/variant 非法值]** opencode 会因不存在的 model/variant 启动失败 → worker 将 attempt 分类为失败并 retry。→ 可接受，与 `agent` 名非法同类的既有行为；文档注明取值需与 opencode 环境匹配。
- **[variant 依赖 model 语义]** 若 provider 对 variant 有前置依赖，单独配 variant 可能无效或报错。→ 可接受，open code 报错即失败重试，文档建议按需组合配置。
- **[无回归风险]** 默认 `null` 且不追加标志，现有命令字符串完全不变，向后兼容。

## Migration Plan

无需迁移。部署：编辑 `WORKFLOW.md` 在 `opencode` 块加 `model`/`variant`（可选），重启 daemon（配置热加载也会生效）。回滚：删掉这两个字段即恢复默认。
