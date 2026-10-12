# 回旧机器用 `start --fresh` 复用冷启动探测并做绑定对账

新机器跑完任务后切回旧机器，旧机器的 `bindings.db` 仍落后于新机器期间的消费进度：intake 游标只在 Sweep（启动/WS 重连/12h）时推进，事件模式下可落后很远；重启即 Sweep 会把「游标之后」的新机器已消费 `/issue` 当新消息重放 → 本地无 binding → 重复建单 → 已完成任务被重复拉取。决定：`tasking start` 新增一次性 option `--fresh`——(1) 删除本地 `bridge_meta.intake_cursor`，让下轮 Sweep 走 ADR 0016 既有冷启动探测（游标锚定到飞书时钟，不回放停机窗口）；(2) 本地 active bindings 与 Jira 现状对账：issue 已终态/缺失的标 terminal 停止镜像，仍 active/review 的保留；对账查询失败时保守保留全部 binding。仅 `feishu.enabled` 时生效，否则打印提示继续（no-op）。

理由：Jira 调度器本身在新/旧机器上无行为差异（只拉 active 态，已完成终态不成为候选），重放差异只来自机器本地的飞书桥游标，故修在桥启动路径而不碰调度器与事件通道。**Grill（TAS-38）逐项定案**：GQ1=机制成立（intake 重放→重复建单→重新派发）；GQ2=方案 b（清游标 + 对账，否决只清游标的 a 与整库删除的 c）；GQ3=`--fresh` 命名与「仅飞书启用时生效、未启用给提示」语义。取舍同 ADR 0016 换机：停机窗口内两台机器都未消费的消息仍被跳过（120s 窗口外不消费），`--fresh` 接受同一语义。被否：① 自动检测机器切换（不引入启发式）；② 全量删 `bindings.db`（旧机器仍活的线程镜像应保留）；③ 过滤调度器对存量 active 态 issue 的接管（正常接管行为）。回滚即 git revert；无 db/配置迁移。
