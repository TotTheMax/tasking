## 1. 配置层：feishu.edition 字段

- [x] 1.1 在 `tests/config.test.ts` 写失败测试：`feishu:` 块无 `edition` 键时解析结果为 `"feishu"`；显式 `edition: lark` 解析为 `"lark"`。红后于 `src/config/config-types.ts` 定义 `FeishuEdition` 类型、`FeishuConfig.edition` 字段与 `DEFAULTS` 默认值，`src/config/resolver.ts` 填充默认，转绿
- [x] 1.2 在 `tests/config.test.ts` 写失败测试：`edition: cn`（非法值）触发启动校验错误且报错文案列全 `feishu`/`lark` 合法值（无条件校验，不随 `feishu.enabled` 变化）。红后在 `src/config/resolver.ts` 的 `resolveFeishuEdition` 增加无条件枚举校验（配置解析阶段抛错），转绿

## 2. 适配层：域名派生与提示

- [x] 2.1 在 `tests/feishu-source.test.ts` 写失败测试：`edition: lark` 下发消息/拉话题/token 获取的请求 URL 主机为 `open.larksuite.com`，默认 edition 仍为 `open.feishu.cn`。红后在 `src/adapters/feishu/probe.ts` 导出 `feishuApiBase(edition)` helper 并将 16 处硬编码 URL 改为派生值，转绿
- [x] 2.2 在 `tests/feishu-source.test.ts` 写失败测试：token 获取认证失败时 warn 日志含指向另一版 `feishu.edition` 的条件句提示。红后在 `source.ts` 增加提示 helper 并挂到 token 失败路径，转绿
- [x] 2.3 在 `src/cli/index.ts` `runStart` 增加启动 info 日志一行实际 API base（用现有 observability 测试模式或 config-view.test.ts 断言透出；若无既有 seam 则以 2.1 的派生函数单测 + 日志调用点编译期保证）
- [x] 2.4 在 `tests/feishu-probe.test.ts` 写失败测试：`edition: lark` 时控制台深链（应用根/权限页/事件页/版本页）主机为 `open.larksuite.com` 且内嵌 app_id。红后将 `src/adapters/feishu/probe.ts` 深链改为 `feishuApiBase(edition)` 派生、3 处 REST URL 改用 `feishuApiBase`，转绿
- [x] 2.5 在 `tests/feishu-events.test.ts` 写失败测试：`edition: lark` 时 `WSClient` 构造参数含 `Domain.Lark`（经 clientFactory/DI seam 断言）。红后在 `src/adapters/feishu/events.ts` 的 `FeishuEventListenerDeps` 增加 `edition` 并在 `buildClient` 传 `domain`，`src/cli/event-channel.ts` 从 `config.feishu` 透传，转绿

## 3. init 问卷：edition 首问

- [x] 3.1 在 `tests/init.test.ts` 写失败测试：feishu-direct 分支中 app_id 问答之前出现版本选择，中文模板语言首项（回车默认）为 `国内版（飞书）`，English 首项为 `海外版（Lark）`。红后在 `collectFeishuDirectConfig` 增加首问，转绿
- [x] 3.2 在 `tests/init.test.ts` 写失败测试：选择海外版后凭据验证请求发往 `open.larksuite.com`、验证失败输出含跨区域提示、生成的 WORKFLOW.md `feishu:` 块含 `edition: lark`；不启用飞书桥时无此问且不写 edition 键。红后在 `collectFeishuConfig` 增加首问、`fetchTenantTokenFor` 接受 edition 参数、`generateWorkflowContent` 写入 edition，转绿

## 4. 文档与词汇

- [x] 4.1 `docs/configuration.md`（zh/en 两份）新增 `feishu.edition` 条目：合法值、默认 `feishu`、两版域名对照、非法值硬错误行为（对照 `DEFAULTS` 核对默认值）
- [x] 4.2 `docs/feishu-quickstart.md` 增加"Lark 用户"注记：需在 Lark 开发者后台重建应用、域名与控制台链接为 `open.larksuite.com`
- [x] 4.3 确认 `CONTEXT.md` Feishu edition 词条已随本变更落盘（已在前置拷问中写入，校对 avoid 列表）

## 5. 门禁

- [x] 5.1 运行 `npm run lint`、`npm run typecheck`、`npm test -- tests/config.test.ts tests/init.test.ts tests/feishu-source.test.ts tests/feishu-probe.test.ts tests/feishu-events.test.ts` 全绿
- [x] 5.2 运行 `npm run test:e2e`（飞书适配层变更的硬门禁）确认回归；真机集成测试（`npm run test:integration` / `test:event-flow`）在可达时补跑，不可达则在提交说明中注明原因
