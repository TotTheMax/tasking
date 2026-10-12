---
status: accepted
---

# Worker 终止升级:SIGTERM → 宽限 → 进程组 SIGKILL

三层超时模型原设计里,墙钟/不活跃超时只对子进程发 SIGTERM、不做升级,依赖 2h stall 兜底(docs/zh/timeout-model.md 场景 4),孤儿孙进程记为接受。本次推翻该立场:超时 SIGTERM 后经 kill grace(固定 10s,不进配置)升级为**进程组** SIGKILL;abort 路径(stall 兜底/daemon 停机)直接进程组 SIGKILL。

理由:(a) stall 的"slot 占用有界"承诺存在漏洞——**持续输出型拒签子进程**(捕获 SIGTERM 且继续产出 token 事件)会不断刷新 `last_event_at`,stall 永不触发,slot 被无限占用;原场景 4 只分析了静默卡死。(b) 静默场景 2h 的槽位占用,10s 宽限即可解决。(c) `tasking stop` 对 daemon 自身早已是 SIGTERM→10s→SIGKILL(cli-runtime spec),worker 路径无理由更宽。

取舍与被否项:
- **TERM 阶段保持仅父进程**:不越过职责边界,给 opencode 优雅清理自己子进程的机会;组杀只发生在 KILL 档(此时已无优雅可言,留孤儿只有泄漏成本)。代价:组杀会波及 agent 故意留下的后台进程——但仅发生在 attempt 已判死的 KILL 阶段,可接受。
- **kill grace 不做配置项**:几乎不需要调的安全参数(太短剥夺优雅退出,太长无场景),为它增加配置面/校验/双语文档/init 漂移是纯开销;以 `runDefaultSubprocess` 参数(默认 10000)供测试注入。
- **hook 超时的组杀不在本次范围**:hook 的 bash -lc 超时被杀后孙进程同样会孤儿,但 hook 是受信短脚本且有 60s 硬顶,语义变化不应搭车异步化重构——留作 future work。
