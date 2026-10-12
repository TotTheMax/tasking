# C5 runtime-perf-polish 设计

## Context

六项互不相关的小优化,共同点:无 spec 冲突、无相互依赖、均为实现层。分别对应全量字段拉取、CLI follow 全量读、轮转字节计数 bug、热重载丢 port 覆盖、死代码、logs 路径假定。

## Goals / Non-Goals

**Goals:**
- 候选查询请求负载显著下降(枚举字段 vs *all);行为等价(`normalizeIssue` 输出不变)。
- `logs -f` 不再每 500ms 读整个文件;logger 轮转按真实字节触发。
- `--port` 覆盖在热重载后保持;`logging.file.path` 配置真正生效,`logs` 能读到配置的日志路径(daemon.json 记录了它)。

**Non-Goals:**
- 不迁移 `/search/jql`(Cloud-only;内网 Server 部署无收益)。
- 不把 logger 改异步/流式(评估结论:无可测量收益,风险>收益)。
- 不做 dashboard 鉴权/绑定地址变更(属于"可信环境"文档化姿态,另行决策)。

## Decisions

**D1 字段枚举**:`["summary","description","priority","status","labels","assignee","issuelinks","created","updated"]`——`normalizeIssue` 消费集的完备列表(id/key 恒返)。风险:若未来 normalizeIssue 需要新字段,必须同步此列表——以 http 测试断言字段集为守卫(缺字段会在 mock 断言/真实集成测试暴露)。

**D2 logs -f 增量读**:一次性 `fs.open` 持有 fd,每 tick `read(buffer, position)` 至 EOF;`stat.size < offset`(轮转/截断)→ 关旧 fd 重开、offset 归零。保持 500ms 轮询节奏与 `--level` 过滤不变。

**D3 字节计数**:`RotatingFileSink.write` 的阈值判断与 `bytesWritten` 累加均改 `Buffer.byteLength(data)`;`writeFileSync` 保留。

**D4 portOverride 重应用**:局部量 + `configMgr.onReload(cb)` 回调里 `result.config.server.port = portOverride`。不引入 ConfigManager overrides 概念(单调用点,不值得泛化)。

**D5 daemon 日志路径单一来源**:logger sink 与 `daemon.json.log_path` 共用同一次解析——`logging.file.path` 配置则 `resolve(该路径)`(相对进程 cwd,与现状一致),未配置则 `resolve(cwd, "tasking.log")`(默认行为逐字节不变)。`tasking logs` 解析:当前目录 daemon.json 有 `log_path` → 用之,否则 cwd 回退。daemon.json 与所有子命令一样是 cwd 作用域,本特性解决"配置了自定义日志路径后 logs 仍读默认文件",而非跨目录发现。旧格式(无字段)自然回退,无迁移。

**D6 dirty 清理**:删 `dirty` 字段与 4 个 scheduler 事件监听注册;实现前 grep 确认监听回调无副作用(它们只置标志)。

## Risks / Trade-offs

- [字段枚举漏字段导致运行时 undefined] → `normalizeIssue` 对每字段本就有 typeof 守卫(缺字段降级为 null,不炸);http 测试 + 真实集成测试双守卫。
- [fd 持有期间日志轮转] → size < offset 检测覆盖;轮转是 rename,旧 fd 继续指向旧 inode,重开后指向新文件,尾部不丢。
