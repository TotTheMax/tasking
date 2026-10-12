## Context

飞书适配层现状：`src/adapters/feishu/source.ts` 16 处、`probe.ts` 4 处硬编码 `https://open.feishu.cn`；`events.ts` 的 `WSClient`（`@larksuiteoapi/node-sdk`）未传 `domain`（SDK 默认 Feishu）。`FeishuSource` 构造时快照 `config.feishu`（cli/index.ts:297），daemon 热重载不重建该实例——现有 `feishu.*` 字段（app_id 等）改后即需重启生效，edition 继承同一语义。Lark 与国内版同一套 OpenAPI：路径、请求/响应结构、权限 scope 模型一致；差异仅在域名（`open.larksuite.com`）、开发者后台（应用/凭据互不相通）、限流配额可能不同。init 的 `collectFeishuDirectConfig` 在问卷中现场验证凭据（`fetchTenantTokenFor`，走硬编码 cn 域名）。

与用户对齐的共识（决策记录）：

| 决策点 | 结论 |
|---|---|
| 配置形态 | 枚举 `feishu.edition: "feishu" \| "lark"`，默认 `"feishu"`；拒绝完整 URL 形态 |
| init 问卷 | 两条 `collectFeishu*` 流程首问；默认项按模板语言预选；选后凭据验证立即用对应域名 |
| 跨区域提示 | helper 收敛文案；init 验证失败输出 + daemon token 失败 warn；宽触发（认证失败即提示） |
| 非法值 | validator 硬错误拒绝启动；不按 `feishu.enabled` 条件化 |
| 可观测性 | 启动 info 日志一行实际 API base；config view 自动透出（edition 非密钥） |
| env 覆盖 | 不做（非敏感信息，YAML 已有 `${VAR}` 插值兜底且无需求） |

## Goals / Non-Goals

**Goals:**

- Lark 部署仅通过设置 `feishu.edition: "lark"` 即可全功能接入（REST、WS 事件通道、init 引导、诊断深链）。
- 选错区域的用户能在启动或 init 时得到指向性提示，而非模糊的认证失败。
- 实际生效域名对用户可见（启动日志 + config view）。

**Non-Goals:**

- `feishu.baseUrl` 完整 URL 覆盖（代理/私有部署逃生舱，真有需求再加）。
- 运行时自动区域探测（双倍延迟、静默行为意外、认证失败≠区域错）；按 app_id 推断（app_id 不编码区域）。
- E2E 新场景/新 fixture（两版负载结构相同，无新平台交互）；卡片改动（无新按钮，不触发三场景模板与回路测试义务）。
- 热重载即时生效（继承 `feishu.*` 快照语义，改 edition 需重启——与现有字段一致）。

## Decisions

**D1 枚举而非完整 URL。**
合法值恰好两个且固定；URL 形态的尾斜杠/scheme/主机拼写错误只能在运行时网络错误暴露，枚举值错误在 validator 阶段拦截。对照：Jira 用完整 URL 是因为每家公司 host 不同（tracker.ts:385），Feishu 场景相反。"用户不知道实际 URL"的透明性问题由可观测性解决（启动日志 + config view），而非让用户填 URL。未来若需私有部署，可加 `baseUrl` 覆盖项（优先级高于枚举），两种形态不冲突。

**D2 派生收敛单一 helper。**
`probe.ts` 导出 `feishuApiBase(edition: FeishuEdition): string`（`lark → https://open.larksuite.com`，`feishu → https://open.feishu.cn`），所有 REST URL 模板与 probe 深链统一引用它——API 主机与开发者后台主机两版相同，故合并为一个 helper，不再单列 `feishuConsoleBase`。TS 类型 `FeishuEdition = "feishu" | "lark"` 定义于 `config-types.ts`。

实现修正（评审后）：helper 落点由 `source.ts` 改为 `probe.ts`——`source.ts` 已 import `probe.ts`，若 helper 定义在 `source.ts` 则 `probe.ts` 反向依赖将形成循环；`probe.ts` 同层拥有 `consoleLinks`/`diagnoseFeishuError`，是域名的自然归属。调用方一律从 `probe.js` 直接 import（不设再导出，避免 Middle Man）。

**D3 WS 通道走 SDK 原生 domain 参数。**
`WSClient` 构造增加 `domain: edition === "lark" ? Domain.Lark : Domain.Feishu`（SDK 类型已确认支持 `domain?: string | Domain`）。`FeishuEventListenerDeps` 增加 `edition` 字段，`startEventChannel` 从 `config.feishu` 透传；测试用 `clientFactory` 注入断言。

**D4 init 首问 + 语言预选，不做纯语言推断。**
语言 ≠ 区域（中文用户用 Lark 是真实存在的反例），故显式一问、默认项按模板语言预选（askSelect 首项即回车默认）。问题置于两条 `collectFeishu*` 流程之首——凭据验证（`fetchTenantTokenFor`）依赖其结果。不配飞书（Jira-only / bridge 流程跳过）则不问、不写 edition，后续手改配置时默认 `feishu`。标签 `国内版（飞书）（默认）/ 海外版（Lark）`，English 模板语言时 lark 在前。

**D5 宽触发跨区域提示。**
飞书错误码语义不稳，精确匹配（如 app 不存在才提示）漏报风险高于宽触发的误报成本（多打一行提示）。helper 输出固定文案（含当前 edition 与另一版的设置写法），落点：init 验证失败输出（用户当场可重选）、daemon `FeishuSource` token 获取失败的 warn 日志（手改配置场景，`tasking logs` 可见）。

**D6 无条件硬校验。**
`validateStartupConfig` 对 `feishu.edition` 做无条件的枚举校验（不依赖 `feishu.enabled`）。回退式容错会把错拼的 lark 凭据静默发往 cn 域名，恰好复现本变更要消除的困惑场景。

**D7 不立 ADR。**
enum-vs-URL 有真实权衡但可逆性高（未来可同时接受两种形态），不满足"难以逆转"标准；权衡记录于本文件即止。

## Risks / Trade-offs

- [Lark 侧功能差异导致个别端点行为不一致（限流头、新字段节奏）] → 派生层隔离，任何差异可集中在 helper/adapter 处理；不预设差异。
- [宽触发提示在单纯凭据错误时也会出现，可能误导] → 文案用条件句（"若应用创建于另一版…"），非断言；仅一行，不噪音。
- [用户已有 WORKFLOW.md 无 edition 字段] → 默认 `feishu`，零迁移；行为与现状完全一致。
- [`collectFeishuConfig`（bridge 流程）跳过飞书的用户事后手改启用 + 选错 edition] → daemon token 失败 warn 提示兜底（D5）。
- [SDK `Domain` 枚举值变动（跨大版本）] → 仅 `events.ts` 一处引用，测试覆盖。

## Migration Plan

纯增量：无既有字段改名/删除，旧配置（无 edition）默认 `feishu` 行为不变。回滚 = revert 提交，无状态迁移。

## Open Questions

（无——决策已在提案前的逐题拷问中全部收敛。）
