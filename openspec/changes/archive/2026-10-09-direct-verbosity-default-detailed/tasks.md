## 1. 配置面（T1）

- [x] 1.1 默认值翻转（先改测试再实现）：`tests/config.test.ts` 两处缺省断言 `summary` → `detailed`，随后 `src/config/config-types.ts` DEFAULTS 与 `src/config/resolver.ts` 回退同步改 `detailed`；`tests/en-templates.test.ts` 模板解析断言同步
- [x] 1.2 显式取值路径回归：`quiet`/`summary`/`detailed` 显式配置解析正确（既有用例），非法值仍被拒绝

## 2. 测试基线（T2）

- [x] 2.1 `tests/direct-sessions.test.ts` 的 `directConfig()` helper 显式钉住 `verbosity: "summary"`（保持既有用例的文本模式语义不随产品默认漂移），"summary mode stays card-free" 用例改名并显式 summary

## 3. 模板（T3）

- [x] 3.1 8 个 `assets/workflows/WORKFLOW.*.md.example` 的 `verbosity: summary` → `verbosity: detailed`，中英注释同步更新（detailed 描述改为「每 turn 一张过程卡片」并注明客户端 ≥ V7.9 版本要求）；跑 `tests/en-templates.test.ts`（含 DEFAULTS 键覆盖守卫）

## 4. 文档与 ADR（T4）

- [x] 4.1 `docs/{zh,en}/configuration.md` feishu.direct 表格默认值与说明、版本要求；`docs/{zh,en}/usage.md` /chat 段的 verbosity 描述与默认；`docs/{zh,en}/architecture.md` 注明 detailed 为默认
- [x] 4.2 新增 `docs/adr/0032-direct-verbosity-default-detailed.md`（取舍：否决版本探测/第四档 auto；接受老客户端占位符 + 一行回退）；ADR 0024 加指针
- [x] 4.3 `tests/docs-links.test.ts` 验证双语 parity 与链接

## 5. 门禁收尾

- [x] 5.1 `npm run lint && npm run typecheck && npm test` 全绿（48 文件 / 1354 用例）；触及直连/飞书面 → e2e 已含于 `npm test`
- [x] 5.2 `npm run test:integration`（内网可达，2026-10-09 实跑）：`integration-real` 6/6 全绿；`integration-direct` 4/5 绿——summary 钉住的两用例（真实 turn 镜像、/stop）中前者通过，后者（`real /stop kills a running turn`）在**未修改的工作树对照实跑中同样失败**（模型未撑满 90s turn 的既有 flake，与本变更无关，对照记录于 2026-10-09 会话）；path 模式与 recover 用例在新默认 detailed 下实跑通过，真机卡片创建/更新由既有卡片探针用例验证通过

