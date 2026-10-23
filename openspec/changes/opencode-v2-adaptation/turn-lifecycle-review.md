# 直连会话 Turn 生命周期 —— 全面走查与事故档案（2026-10-21）

> 本文是对 0.7.0 v2 驱动路径的逐行走查结论 + 三天实测事故的最终定性。
> 每个结论都标注了证据来源与置信度。诊断反复过的地方在"事故档案"里如实记录。

## 1. 完整流转（一条消息的一生）

```
飞书用户发消息（话题内）
  │ WS 事件（~即时）
  ▼
CommentBridge → DirectSessionManager.handleThreadMessage     [manager.ts]
  ├─ 游标去重（last_msg_id / seen_ids）
  ├─ 斜杠命令分流（/stop /new /auto /agent /model /collect …）
  └─ enqueueTurn(rootId, prompt)
       ├─ rt.turnInFlight? → 入队（后续合并为一轮）            [queue[]]
       └─ runTurnLoop
            ├─ startTurnCard：发轮次卡片（失败→文本降级）        [Feishu]
            ├─ acquireDir(path)：同目录串行（无超时，靠 turn 超时兜底）
            ├─ acquireSlot(max_concurrent)
            └─ executeTurn                                    [manager.ts]
                 ├─ 记日志 "direct turn starting"（含 tasking_version ★新）
                 ├─ resolveTurnAutoApprove（posture: on/once/off）
                 └─ turnDriver(request)                       [driver.ts]
                      ├─ 首轮：createSession（location+model+agent+ruleset）
                      ├─ 续轮：switchAgent/switchModel（按需，失败静默降级）
                      ├─ posture 翻译：session.update 注入/清空 ruleset
                      └─ runTurn                              [turn-driver.ts ★核心]
```

## 2. runTurn 核心循环（当前最终版逐行语义）

### 2.1 预备段（提交前）
| 步骤 | 语义 | 失败处理 |
|---|---|---|
| createSession（仅首轮） | location.directory + Model.Ref + agent + 全放 ruleset（autoApprove 时） | 整轮 error 返回 |
| baseline ×2 重试 | `staleOutcome`（提交前 outcome）+ `baselineIds`（已有消息 id 集） | 两次都失败 → 双双置 null，后续判定降级 |
| promptSession | 提交 prompt，返回**本次 user 消息 id**（`promptMessageID`，完成判定的锚点） | 整轮 error 返回 |

### 2.2 每次 poll（默认 2s）
1. **abort 检查** → 走中断梯子（interrupt → 宽限 → interrupted）
2. **session.get**（便宜）：outcome + `time.updated`
3. **permission.list**（便宜）：成功才叫 `pendingKnown`；**失败 ≠ 空列表**（不触发对账、不触发重拉）
4. **活动判定**：`updated` 变化 → 记活动 + 进度
5. **pending 状态机**：出现 → `onWaitingForApproval(true)`（挂起计时暂停）；超 `permission_timeout_ms` → 逐条自动 reject（记 `rejectedAt`）
6. **按需拉取 message.list**（贵，521KB@肥会话）：仅当 `updated` 变 / pending 数变 / 首次 / 15-poll 兜底
   - diff → 事件（text/reasoning/tool_use/step_usage）+ usage 累计（entry 级去重，token 每消息只计一次）
7. **完成判定**（见 2.3）
8. **计时器**：整体超时（挂起暂停）→ 中断梯子；无输出超时（挂起暂停 + **prompt 登记前不计时** ★）

### 2.3 完成判定状态机（v3 锚定版）
以 `promptMessageID` 在消息列表中的位置为界，**列表中位于它之上（更新）的**才算本轮：

```
registered = 列表里见到了我们的 user 消息（服务端已受理本轮）
produced   = 它之上有 ≥1 条 assistant（本轮真的有产出）
streaming  = 它之上有未 settle 的 assistant（还有消息在生成）
idleOutcome= 它之上最近的 idle 消息的 outcome（权威完成信号）
```

| 完成通道 | 条件 | 说明 |
|---|---|---|
| ① idle 消息 | `registered && produced && !streaming && idleOutcome∈终态` | **权威**。实测 idle 与最终消息 settle 仅差 3ms |
| ② outcome 变化 | 同上 + `outcome !== staleOutcome`（且 baseline 成功 ★新） | 值变了才算；同值不可信（服务端保留上轮值） |
| ③ 拒绝后收尾 | 我们发出自动 reject 后，连续 15 个静默 poll | 僵尸 turn 的主动止血（实测 34s 收尾） |
| ④ 无输出超时 | prompt 登记后 10min 无任何活动 | 兜底 |
| ⑤ 整体超时 | 1h 墙钟（挂起期间暂停） | 最终兜底 |

**防误杀约束**：prompt 登记前不计时器（服务端处理慢也不杀）；流式中不完成；本轮零产出不完成；上一轮的迟到 idle 在锚点之下（不算本轮）。

## 3. 事故档案（最终定性）

| # | 现象 | ❌ 我的错误诊断 | ✅ 最终定性（证据） | 状态 |
|---|---|---|---|---|
| 1 | 审批卡点击后不更新 | — | 卡片发送与盖章的竞态 + 只回 toast；修：回调直接返回盖章卡 + 迟到补盖章 | 已修✅ |
| 2 | 轮次卡残留"等待审批" | — | `rt.waitingApproval` turn 结束不复位；修：finally + startTurnCard 复位 | 已修✅ |
| 3 | turn2 两秒"完成"无文本 | — | 上一轮 outcome 残留被当成本轮完成信号 | 已修✅(锚定) |
| 4 | 长答案丢失（150s/0文本） | — | outcome 在流式中途翻转 → 提前完成；修：流式守卫 + idle 权威 | 已修✅ |
| 5 | 2645s 无输出超时 | — | 审批 30min 无人点 → 自动拒绝后服务端成僵尸（无 outcome/idle）；修：拒绝后 15-poll 收尾 | 已修✅ |
| 6 | "☑️已自动处理"误判+迟滞 | — | permission.list 瞬时失败被当成空列表对账 + external 不复活；修：失败不对账 + external 复活 | 已修✅ |
| 7 | 612s"谢谢"超时（TUI 显示 8.6s 答完） | **"opencode 服务端排队 10 分钟"（错）** | opencode 日志：prompt CLI 08:52:06 才启动、8.6s 答完；**是当时 daemon 跑的旧版完成判定认不出已到达的答案**，干等 10min 后超时。用户 08:52:04 才发消息（WS 日志），无任何排队 | 已修✅(v3) 但 daemon 未重启 |
| 8 | turn5 卡 18min 被 interrupt | — | 模型触发 ask 权限；旧版 pendingKnown 缺陷可能吞了审批卡 + 30min 审批超时；用户手动中断 | 已修✅(pendingKnown) 同样未重启 |
| 9 | "29 分钟管理面延迟" | **我自己臆测的"疑似飞书 500"（错）** | WS 日志：08:23-08:53 无任何消息——用户就是 08:52 才发的 | 不存在 |
| 10 | 卡片 408.5k vs TUI 212k | — | 两个不同指标：累计计费 vs 实时上下文 | 非缺陷 |

**诊断反复的根因**：①每轮修复后 daemon 没重启，事故现场跑的是旧代码，而我把旧代码的现象当新代码的 bug 分析；②没有先取证（opencode 日志/WS 日志）就下结论。**对策**：`direct turn starting` 日志新增 `tasking_version` 字段（本次落地）——以后第一件事先核对版本。

## 4. 本次走查新发现并已修（3 处）

| # | 缺陷 | 位置 | 修复 |
|---|---|---|---|
| A | `latestMessages` 每 poll 重置：跳过拉取的 poll 上锚定信号看到空列表 → "prompt 未登记"假象 → 无输出超时最多被推迟 15-poll，且 fetch 失败时状态丢失 | turn-driver 循环变量提升到循环外 | ✅ |
| B | permission.list **失败**时其空 pending 数仍参与拉取门控比较 | 失败时沿用上次计数 | ✅ |
| C | baseline 两次失败后 `staleOutcome=null` → 同值 outcome 通道可能提前完成（低概率窗口） | outcome 变化通道要求 baseline 成功 | ✅ |

## 5. 已知接受的限制（非缺陷，记录在案）
- **同目录串行**（acquireDir）无超时：一个卡死的 turn 会阻塞同目录后续消息直到它超时——由 turn 级超时间接兜底。
- **switchAgent/switchModel 失败静默降级**（driver 内 catch 空）：不 fail turn，但也没有日志——将来加 onWarn。
- **中断梯子宽限循环**用 outcome 判停，续轮会话上 outcome 恒非空 → 宽限立即结束。不影响结果正确性（timed_out/interrupted 状态是本地决定的）。
- **每 2s 的三个 API 调用**（get/permission/list）仍是固定节奏；只有 message.list 做了按需。
- **worker（Jira）路径**共用 runTurn，上述语义同享；Jira 侧 auto_approve=true 默认不走审批通道。

## 5b. 真机联测追加事故（2026-10-22，HEIH-72~76）

| 单 | 现象 | 定性 | 处置 |
|---|---|---|---|
| HEIH-72 | agent 弃用 MCP，用 curl 裸调 Jira（token 从注入的 opencode.json 读出） | 注入脚本路径 bug：tsx 运行时 `getMcpServerScriptPath()` 解析到不存在的 `src/mcp/jira-server.js`，MCP 启动静默失败 | 路径回退（src → dist）+ worker error 日志 + doctor 检查项 |
| HEIH-73 | server connected tools=2 但 agent 看不到工具，用 mcp-cli CLI 兜底 | 注入配置 `codemode: false` 把工具挡在 Code Mode 目录外（fixture 铁证：catalog 事件里本应出现 tools.jira.*） | `codemode: true`；MCP 工具不走 shell 权限，转状态不再出审批卡 |
| HEIH-75 | daemon 重启后双会话并跑：A(daemon#1) 变幽灵继续服务端执行 4 分钟并最终转终态；B(daemon#2) 正常 | ① shutdown 不等待在飞 attempt（无 interrupt、无孤儿清理）②任务离场后转终态无运行时清扫 | shutdown drain(≤15s) + 周期终态清扫(每 10 空闲 tick) + sidecar 会话创建即写 |
| HEIH-76 | 任务完成但工作区/会话保留 | 非缺陷：agent 转入 review 态（设计保留现场）；终态后 30s 内已清 | 无（补真机验证：review→合并中→完成链路即清） |
| 审批卡 | curl 命令里 Jira bearer token 明文进飞书卡片 | 卡片渲染未脱敏 | `redactSecrets`：凭据对 + ≥32 字符裸串 → `***` |

## 5c. 复查加固（同日第二轮）

- direct `recover()` 重启时补发 `interruptSession`（此前只标 idle，服务端 turn 成幽灵）。
- `promptSession` 120k 字符硬限（`prompt_too_large`）+ 任务描述 40k 截断——prompt 走 argv `--data`，防 E2BIG。
- 无飞书绑定的 Jira 任务审批由静默丢弃改为 warn 日志（超时自动拒绝仍会失败循环，运营上建议此类任务 `auto_approve: true`）。

## 6. 运维口径
1. **改完必重启**：`tasking stop && tasking start`；起手看日志 `daemon started` 的 `tasking_version`。
2. **排障三对照**：tasking.log（turn starting / 版本）× opencode 日志（cli starting 时间戳）× 消息时间戳（message.list）。
3. **会话变肥**（回复明显变慢）→ `/new`；TUI 的 Context 数比卡片累计 tokens 更准。
4. 审批 30 分钟无人点会自动拒绝并收尾；嫌长调 `opencode.permission_timeout_ms`。
