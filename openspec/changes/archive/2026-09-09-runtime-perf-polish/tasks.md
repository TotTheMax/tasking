## 1. jira 字段枚举(TDD)

- [x] 1.1 `tests/jira-tracker-http.test.ts` 写失败测试:候选查询的 `/search` 请求体 `fields` 恰为枚举 9 字段、不含 `*all`;归一化 Task 字段(labels/assignee/blocked_by/priority/created/updated)与全字段响应下一致。确认红
- [x] 1.2 `src/adapters/jira/tracker.ts`:`searchIssues` 的 `fields` 改枚举列表。转绿;`tests/jira-tracker.test.ts` 保持绿

## 2. logger 字节计数(TDD)

- [x] 2.1 写失败测试(`tests/` 新增或就近):写入多字节(中文)日志行至接近 `maxBytes` 时按 `Buffer.byteLength` 触发轮转(字符计数下不会触发的用例)。确认红
- [x] 2.2 `src/observability/logger.ts`:阈值判断与 `bytesWritten` 累加改 `Buffer.byteLength(data)`。转绿

## 3. logs 路径与增量读(TDD)

- [x] 3.1 `tests/cli.test.ts` 写失败测试:daemon.json 含 `log_path` 且 cwd 不同 → `tasking logs` 读该路径;无字段回退 cwd。确认红
- [x] 3.2 实现:`DaemonInfo` 增 `log_path?`,`writeDaemonInfo` 写入,logs 解析按序回退。转绿
- [x] 3.3 `runLogs --follow` 改持 fd 增量读(重开检测 size < offset);既有 follow 用例保持绿(行为等价,仅读法变化)

## 4. 小修

- [x] 4.1 `runStart`:`portOverride` 局部量 + `configMgr.onReload` 重应用;写一条失败测试(热重载后 `server.port` 仍为覆盖值)再实现
- [x] 4.2 `src/observability/http-dashboard.ts`:grep 核实 4 个 scheduler 监听只置 `dirty` 后,连同 `dirty` 字段一并删除;`tests/observability.test.ts` 保持绿

## 5. 门禁

- [x] 5.1 `npm run lint && npm run typecheck && npm test -- tests/jira-tracker-http.test.ts tests/cli.test.ts tests/cli-commands.test.ts tests/observability.test.ts tests/config.test.ts`
- [x] 5.2 `npm run test:e2e`(jira 适配器变更硬门禁);内网可达时 `npm run test:integration`(真实 Jira 对字段枚举的最终守卫),不可达注明原因
