## Why

飞书适配层的 REST 域名（19 处）与 WS 事件通道域名全部硬编码 `open.feishu.cn`（国内版），海外版 Lark（`open.larksuite.com`，同一套 OpenAPI、不同域名与应用体系）完全无法接入。选错区域的症状是认证失败，用户无法自行定位原因。API 结构与权限 scope 两版一致，仅域名与开发者后台不同，支持成本低。

## What Changes

- 新增配置 `feishu.edition: "feishu" | "lark"`（默认 `"feishu"`），词汇表定名 **Feishu edition（飞书版本）**。
- API base 派生收敛到单一 helper：`feishu` → `https://open.feishu.cn`，`lark` → `https://open.larksuite.com`；`src/adapters/feishu/source.ts`（16 处）与 `probe.ts`（3 处 REST）改读派生值。
- WS 事件通道（`events.ts` `WSClient`）按 edition 传 SDK `domain` 参数（lark → `Domain.Lark`）。
- init 问卷两条飞书配置流程（`collectFeishuDirectConfig` / `collectFeishuConfig`）新增**首问**：`国内版（飞书）（默认）/ 海外版（Lark）`，默认项按模板语言预选（中文→feishu，English→lark）；不配置飞书则不问。回答后 init 的现场凭据验证立即走所选域名。
- 跨区域提示 helper（认证失败即提示"若应用创建于另一版，设置 feishu.edition"），落两处：init 凭据验证失败输出、daemon token 获取失败 warn 日志。宽触发，不匹配具体错误码。
- 非法 edition 值 → validator 硬错误拒绝启动（防止 lark 凭据被静默发往 cn 域名），无条件枚举校验（不按 `feishu.enabled` 条件化）。
- 可观测性：daemon 启动 info 日志打一行实际 API base；`feishu-setup-doctor` 深链（应用根/权限页/事件页/版本页）按 edition 派生。
- 文档：`docs/configuration.md`（双语）新增 `feishu.edition` 条目；`docs/feishu-quickstart.md` 增加"Lark 用户"注记（Lark 后台重建应用、域名与控制台不同）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `workflow-config`: 新增 `feishu.edition` 枚举字段需求——合法值 `feishu`/`lark`、默认 `feishu`、非法值启动即硬错误。
- `feishu-source`: REST 调用域名需求变更——API base SHALL 由 `feishu.edition` 派生而非硬编码 cn 域名。
- `interactive-init`: 飞书配置流程新增 edition 首问需求——默认项按模板语言预选、凭据验证走所选域名、不配飞书不问。
- `feishu-event-ingress`: WS 事件通道连接域名需求变更——SHALL 按 edition 连接对应区域端点。
- `feishu-setup-doctor`: 开发者后台深链需求变更——深链 SHALL 按 edition 派生域名；认证失败 SHALL 输出跨区域提示。

## Impact

- **代码**：`src/config/config-types.ts`（`FeishuConfig.edition` + `DEFAULTS`）、`src/config/validator.ts`（枚举校验）、`src/adapters/feishu/source.ts`（域名派生 + 16 处替换 + token 失败提示）、`src/adapters/feishu/probe.ts`（深链派生 + 3 处替换）、`src/adapters/feishu/events.ts`（`domain` 参数）、`src/cli/init.ts`（两条 collectFeishu* 首问 + 验证域名）、`src/cli/index.ts`（启动日志一行）。
- **测试**：`tests/config.test.ts`（默认值/枚举/非法值）、`tests/init.test.ts`（首问顺序/预选/写入 frontmatter/验证域名）、`tests/feishu-source.test.ts`（两 edition 的 URL 派生）、`tests/feishu-probe.test.ts`（深链派生）、`tests/feishu-events.test.ts`（`Domain.Lark` 传递）。
- **文档**：`docs/configuration.md` 双语、`docs/feishu-quickstart.md` Lark 注记、`CONTEXT.md`（Feishu edition 词条，已落）。
- **不受影响**：消息/卡片结构与解析（两版负载相同）、bridge 逻辑、scheduler、worker、workspace；无新平台交互 → 无新 fixture、无卡片三场景义务；不立 ADR（可逆性高，权衡记录于 design.md）。
- **非目标**：`feishu.baseUrl` 完整 URL 覆盖项（未来逃生舱）、运行时自动区域探测、按 app_id 推断区域（不可行）。
