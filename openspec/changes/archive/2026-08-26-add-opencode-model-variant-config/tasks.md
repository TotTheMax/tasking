## 1. Config 类型与解析

- [x] 1.1 `OpencodeConfig` 加 `model: string | null` 与 `variant: string | null` 字段；`DEFAULTS.opencode` 加 `model: null`/`variant: null`（红：写 resolver 测试断言缺省/空串解析为 null；绿：在 `resolver.ts` 用 `asStringOrNull` 解析 `opencodeRaw.model`/`opencodeRaw.variant` 并补类型默认）。

## 2. worker 命令构建

- [x] 2.1 `buildOpencodeCommand` 仅在 `opencode.model` 非空时追加 `--model <model>`、仅在 `opencode.variant` 非空时追加 `--variant <variant>`，位置在 `--agent` 之后、prompt 之前（红：在 `tests/worker.test.ts` 加四个场景测试——都不配/仅 model/仅 variant/都配，断言命令数组精确等于预期；绿：实现命令拼接）。

## 3. 文档同步

- [x] 3.1 `WORKFLOW.md`、`WORKFLOW.md.example`、`WORKFLOW.grill-openspec.md.example`：`opencode` 块注释补 `model`/`variant` 可选字段说明（默认不配置）。
- [x] 3.2 `docs/configuration.md`：`opencode` 块字段表补 `model`/`variant` 行（类型、默认 `null`、可选、映射 `--model`/`--variant`），并更新启动命令示例注释。

## 4. 验证

- [x] 4.1 `npm run lint` 全绿
- [x] 4.2 `npm run typecheck` 全绿
- [x] 4.3 `npm test` 全绿

> 注：delta specs 到主 specs 的同步由 `openspec archive` 在归档时完成，实施阶段不手动改 `openspec/specs/`。
