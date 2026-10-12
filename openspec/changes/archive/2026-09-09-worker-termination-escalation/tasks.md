## 1. 终止升级(TDD)

- [x] 1.1 `tests/worker.test.ts` 写失败测试:真子进程(node 脚本 `process.on("SIGTERM",()=>{})` + 心跳)配 `runDefaultSubprocess(cmd, cwd, 小超时, 0, undefined, undefined, undefined, undefined, 小 killGrace)` → 以 `timedOut` resolve 且耗时 ≈ 超时+宽限(而非挂死)。确认红
- [x] 1.2 写失败测试:拒签子进程派生一个孙进程 → 组杀后孙进程一并终止(记录孙进程 pid,断言其后不存在)。确认红
- [x] 1.3 写失败测试:SIGTERM 后宽限内自行退出的子进程 → 不触发 SIGKILL、正常 close、超时分类不变。确认红
- [x] 1.4 写失败测试:AbortSignal 触发 → 进程组(含孙进程)立即 SIGKILL,无宽限。确认红
- [x] 1.5 实现:`runDefaultSubprocess` 改 `detached: true`;TERM 首选父进程;`killGraceMs = 10000` 可选参数与幂等宽限定时器;`process.kill(-pid,"SIGKILL")`(try/catch,win32 退化 `child.kill("SIGKILL")`);abort 组杀;close 清理宽限定时器。1.1–1.4 转绿

## 2. stdout 单遍累计(TDD)

- [x] 2.1 写失败测试:多事件 stdout(两个 `step_finish` 带 token + `sessionID`)→ `SubprocessResult.sessionAndUsage` 与 `extractSessionAndUsage(同输入)` 一致;`stdout` 仅保留尾部 ≤64KB。确认红
- [x] 2.2 实现:逐行解析循环增量累计;`stdout` 尾部 64KB 截断保留;`SubprocessResult` 增 `sessionAndUsage?`;`runAttempt` 改 `result.sessionAndUsage ?? extractSessionAndUsage(result.stdout)`。确认绿;现有仅返回 stdout 的假 runner 用例全部保持绿(回退路径)

## 3. 文档与 ADR

- [x] 3.1 新增 `docs/adr/0020-worker-termination-escalation.md`:记录推翻"不升级"立场的原因(活跃输出型拒签使 stall 有界承诺失效、2h vs 10s、与 `tasking stop` 不对称)与被否项(TERM 阶段组杀、可配置 grace);hook 超时组杀记为 future work
- [x] 3.2 重写 `docs/zh/timeout-model.md` 与 `docs/en/timeout-model.md`:第 1/2 层内嵌"TERM→宽限→组杀"升级段;场景 4 重写(覆盖活跃输出型拒签 + 有界性论证)、场景 5 孤儿表述更新;时序图同步
- [x] 3.3 `docs/zh/architecture.md` 与 `docs/en/architecture.md` 三层超时摘要句同步升级语义
- [x] 3.4 核对 6 个 `WORKFLOW*.md.example` 的 stall/inactivity 注释,按升级语义更新(仅注释,无配置变化)

## 4. 门禁

- [x] 4.1 `npm run lint && npm run typecheck && npm test -- tests/worker.test.ts tests/agent-resolver.test.ts`
- [x] 4.2 `npm run test:e2e`(worker/scheduler 链路硬门禁)+ `npx vitest run tests/docs-links.test.ts`(文档双语/链接);内网可达时 `npm run test:integration`,不可达注明原因
