# 测试策略：端到端关键子系统必跑 E2E，新增一键脚本为真源

TAS-23（测试流程优化）确认将仓库的测试策略固化为开发代理可见、可执行的引导（Q1=A、Q2=A）：修改飞书适配器、Jira 适配器、调度器或飞书↔Jira comment bridge 逻辑后，**必须**运行 mock 驱动的端到端测试（`tests/e2e.test.ts` + `tests/bridge-flow.test.ts`，硬门禁，CI 的 `npm test` 已强制）；当 live 测试环境可达时（本地开发含内网路由），还**必须**运行真实 API 集成测试（`INTEGRATION=1`，`tests/integration-real.test.ts`），环境不可达时须在 commit/MR 注明原因。其他子系统变更按需测试（对应单测 + 影响端到端行为时跑相关 E2E）。引导写入 `AGENTS.md` 与 `docs/{zh,en}/development.md`。

理由：单测/组件测试基于对 API 的理解构造 mock，理解错则全绿但生产挂（TAS-10 的 17 个手动 bug，见 `docs/known-issues.md`）；只有端到端链路能拦跨组件回归。真实集成直接打真实飞书/Jira 测试资源，CI（ubuntu-latest）无内网路由故不纳入 CI（ADR 0010 立场不变），因此"live 环境可达时必跑 + 不可达时注明原因"取代"无条件强制"，避免在无网络环境阻塞开发。

## 决策

- **`test:e2e` 与 `test:integration` 两个独立 npm 脚本是命令真源**：AGENTS.md 与 docs 只引用命令名，不复述命令体，防漂移。新增端到端测试文件须同步加入 `test:e2e` 列表。
- **mock E2E 是硬门禁**：它无外部依赖、确定性、已由 CI 覆盖；真实集成是有条件的补充门禁。
- **不实现 diff 感知的自动检测/钩子**：CI 已用 `npm test` 兜底 mock E2E，真实集成无法可靠自动判断环境可达性，引导靠文档约定。
