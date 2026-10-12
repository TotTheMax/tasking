## Why

一批互不相关但各自明确的小优化/小缺陷,均无 spec 冲突:候选查询用 `fields: ["*all"]` 拉全字段(含所有 custom fields/附件元数据),30s 一次的全板分页拉取在大 board 上过重,而 `normalizeIssue` 只消费 9 个字段;`tasking logs --follow` 每 500ms `readFileSync` 整个 10MB 日志文件;logger 轮转阈值用字符串 `length` 计数,中文日志(1 字 3 字节)使 `max_bytes=10MB` 实际可涨到 ~30MB 才轮转;`--port` 直接 mutate `configMgr.current`,热重载后覆盖丢失;`HttpDashboard.dirty` 标志写入后无人读(死代码)且只为它注册了 4 个 scheduler 监听;`logging.file.path` 配置字段在运行时被忽略——daemon 日志路径硬编码为 cwd `tasking.log`,`tasking logs` 也读不到配置的自定义日志路径(daemon.json 未记 log 路径)。

## What Changes

- **jira 候选查询字段枚举**:`searchIssues` 的 `fields` 从 `["*all"]` 改为 `normalizeIssue` 实际消费的 9 字段(summary/description/priority/status/labels/assignee/issuelinks/created/updated)。POST `/search` 端点不动,`/search/jql` 迁移明确 out-of-scope(Cloud-only,本仓主部署内网 Server)。
- **logs -f 增量读**:打开一次 fd,按 offset 增量 read;文件变短(轮转/截断)则重开。
- **logger 字节计数修复**:轮转阈值 `data.length`(字符数)→ `Buffer.byteLength(data)`。保持同步写(流式化否决:本 daemon 日志量下无可测量收益,不值得动"必须永不失败"的组件)。
- **--port 热重载保持**:`runStart` 保留 `portOverride` 局部量,注册 `configMgr.onReload` 回调重应用。
- **dirty 死代码清理**:删除 `HttpDashboard.dirty` 与只为它注册的 scheduler 事件监听(实现时核实监听确无他用)。
- **daemon 日志路径尊重 `logging.file.path`**:logger sink 与 daemon.json `log_path` 均解析自 `logging.file.path`(未配置时回退 cwd `tasking.log`,默认行为不变);`tasking logs` 解析顺序 daemon.json `log_path` → cwd 回退;旧格式无字段自然回退,无迁移。

## Capabilities

### New Capabilities

(无)

### Modified Capabilities

- `jira-tracker`:MODIFIED "JQL 候选查询与分页" requirement——候选查询 SHALL 请求枚举字段集(列出 9 字段)而非 `*all`。
- `cli-runtime`:MODIFIED "status 与 logs 子命令" requirement——logs 的日志文件解析顺序(daemon.json `log_path` 优先,cwd 回退)。

## Impact

- 代码:`src/adapters/jira/tracker.ts`(fields)、`src/cli/index.ts`(logs -f 增量读、portOverride、writeDaemonInfo/readDaemonInfo/log 路径解析)、`src/observability/logger.ts`(byteLength)、`src/observability/http-dashboard.ts`(dirty)。
- 测试:`tests/jira-tracker-http.test.ts`(fields 断言)、`tests/cli.test.ts`/`tests/cli-commands.test.ts`(logs 路径解析、daemon.json 字段)、`tests/observability.test.ts`(dirty 移除后保持绿)、`tests/log-buffer.test.ts` 不受影响。
- 无配置面变更;`docs/usage.md` 若提及 logs 路径假定则同步(实现时核对)。
