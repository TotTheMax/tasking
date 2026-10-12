## Why

`opencode run` 支持 `--model`（provider/model 格式选模型）与 `--variant`（provider 特定的推理档位，如 high/max/minimal），但 tasking 的 workflow 配置（`WORKFLOW.md` frontmatter 的 `opencode` 块）目前只能指定 `command` 与 `agent`，无法选模型/变体。需要用特定模型或推理档位跑任务时只能改全局 opencode 配置，无法按 workflow 覆盖。

## What Changes

- `opencode` 配置块新增两个可选字段：`model` 与 `variant`，分别映射到 `opencode run` 的 `--model` 与 `--variant` 标志。
- 默认不配置（`null`）：未配置时不追加对应标志，`opencode run` 走 opencode 自身的默认模型/变体——完全向后兼容。
- `buildOpencodeCommand` 在构建命令时，仅当 `model`/`variant` 非空时才追加 `--model <model>` / `--variant <variant>`。
- 两个选项彼此独立，可只配其一，也可都不配。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `opencode-worker`: worker 构建 `opencode run` 命令时 SHALL 支持可选 `--model` 与 `--variant` 标志（来自 `opencode.model` / `opencode.variant`，未配置时省略）。

## Impact

- 改：`src/config/config-types.ts`（`OpencodeConfig` 加 `model`/`variant` 字段 + `DEFAULTS.opencode` 默认 `null`）
- 改：`src/config/resolver.ts`（解析 `opencodeRaw.model` / `opencodeRaw.variant`）
- 改：`src/worker/runner.ts`（`buildOpencodeCommand` 追加 `--model` / `--variant`）
- 改：`tests/worker.test.ts`（新增 model/variant 命令构建测试）
- 改：`WORKFLOW.md` 与 `WORKFLOW.md.example`、`WORKFLOW.grill-openspec.md.example`（frontmatter 注释文档）
- 改：`docs/configuration.md`（`opencode` 块字段表）
- 不动：调度器、session 续轮、token 记账、MCP 注入等其余逻辑。
