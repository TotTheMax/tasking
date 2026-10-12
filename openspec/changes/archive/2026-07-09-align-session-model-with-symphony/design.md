## Context

`add-session-based-multiturn` 实现了 session 续轮,但 continuation retry 续接同一 session ID。讨论发现这使 continuation retry 与更大 `max_turns` 功能等价——同一 session、同一上下文,continuation retry 机制无独立价值。

Symphony 的原始设计(§7.1, §10.2-10.3)是混合模式:
- worker 内:app-server 持久子进程,同一 thread 跨 turn 复用
- worker 退出后:app-server 被杀,thread 消失;continuation retry 开新 app-server + 新 thread + 全量 prompt

opencode session 是磁盘持久化的,跨进程不死。但"不死"不等于"应该续接"。Symphony 的"定期清零"模式有实际优势:agent 从 `git log`/文件系统重新评估,避免对话历史膨胀和错误沿袭。

## Goals / Non-Goals

**Goals:**

- continuation retry 创建全新 session(对齐 Symphony)
- worker 内 turn 2+ 仍续接同一 session(不变)
- session 清理通过 workspace sidecar 文件驱动(不依赖 RetryEntry 传播)
- 续轮指引恢复文件系统检查指引(新 session agent 需重新定位)

**Non-Goals:**

- 修改 worker 内 turn 2+ 的 session 续接行为(保持不变)
- 修改 `--format json` 或 token 解析逻辑(保持不变)
- 修改 stall detector 的 `last_event_at` 更新逻辑(已在前序变更中修复)

## Decisions

### D1: continuation retry 不传 session ID,创建全新 session

**决策**: `onWorkerExit` 的 continuation 路径 SHALL 传 null session ID 给 `scheduleRetry`/`dispatch`/`runAttempt`。

```
Symphony 模式 (本变更采用):
  worker 1:
    turn 1: 全量 prompt → ses_aaa (创建)
    turn 2: 续轮指引   → -s ses_aaa
    turn 3: 续轮指引   → -s ses_aaa
  → max_turns,worker 退出

  continuation retry (1s):
    turn 1: 全量 prompt → ses_bbb (全新!) agent 从 git log 重新评估
    turn 2: 续轮指引   → -s ses_bbb
    turn 3: 续轮指引   → -s ses_bbb
  → max_turns,worker 退出
```

**理由**: 每 continuation 轮强制 agent 从文件系统 ground truth 重新定位,避免对话历史膨胀和错误沿袭。对齐 Symphony §7.1。

### D2: session 清理通过 workspace sidecar 文件

**决策**: `runAttempt` 在提取 session ID 后 SHALL 写入 `<workspace>/.tasking-session.json`;`removeWorkspace` SHALL 从该文件读取 session ID 执行 `opencode session delete`。

```
~/tasking_workspaces/LJWOS-7/
  ├── .git/
  ├── .opencode/
  ├── .tasking-session.json  ← { "session_id": "ses_bbb", "updated_at": ... }
  ├── README.md
  └── src/...
```

**流程**:
```
turn 1 完成 → 提取 ses_aaa → 写 sidecar { session_id: "ses_aaa" }
turn 2 完成 → 提取 ses_aaa → 更新 sidecar (same)
turn 3 完成 → max_turns → worker 退出

continuation retry:
turn 1 完成 → 提取 ses_bbb → 更新 sidecar { session_id: "ses_bbb" }
turn 2 完成 → 提取 ses_bbb → 更新 sidecar (same)
...

任务 terminal → removeWorkspace:
  → 读 sidecar → session_id = "ses_bbb" (last session)
  → opencode session delete ses_bbb
  → 删除工作区目录(含 sidecar)
```

**理由**: continuation retry 不传播 session ID,`RetryEntry` 不再可靠地携带 last session ID。sidecar 文件随 workspace 存在,自然记录 last session,workspace 删除时自然清理。

**替代方案**: `RetryEntry.session_id` 保留 last session ID 仅用于清理。否决:continuation retry 不传 session ID,`RetryEntry` 只有当前轮的 null;无法知道上一轮的 session ID。sidecar 是唯一可靠来源。

### D3: turn 1 prompt 逻辑恢复为全量

**决策**: `turn === 1` 时 SHALL 使用 `renderPrompt`(全量任务 prompt),无论是否有 `opts.sessionId`。

**理由**: continuation retry 现在创建全新 session,agent 无上下文,需要全量 prompt。worker 内 turn 1 也是全新 session(首次 dispatch),同样需要全量 prompt。所以 `turn === 1` 恒为全量。

### D4: 续轮指引恢复文件系统检查

**决策**: `buildContinuationGuidance` SHALL 包含 `git log` / `git status` 检查指引。

**理由**: worker 内 turn 2+ 续接同一 session,agent 有上下文,指引可以简短。但为了保险( agent 可能遗漏前序操作),指引 SHALL 提示检查 `git log` 确认进度。

### D5: onRetry 入口释放 claim

**决策**: `onRetry` 入口 SHALL 立即 `claimed.delete(taskId)`,然后检查 eligibility。

**理由**: 前序变更发现的 bug——`onWorkerExit` 从 `running` 移除但不清 `claimed`,导致 continuation retry 的 `isDispatchEligible` 失败,retry 不 dispatch,poll tick 全新 dispatch。此修复已在前序变更中实施,本变继续保持。

## Risks / Trade-offs

**[Trade-off] continuation retry 新 session 的 agent 需要重新读文件** → 多花几个 `read`/`git log` 调用的 token,远小于全量 prompt + 长对话累积的 context。且 agent 从 ground truth 重新评估更可靠。

**[Risk] sidecar 文件损坏或丢失** → `removeWorkspace` 读 sidecar 失败时跳过 session 清理,记录警告。session 残留在磁盘上,不影响功能。

**[Risk] sidecar 文件记录的 session 已被手动删除** → `opencode session delete` 失败,`deleteSession` 已有 try-catch,记录警告不阻塞。

**[Trade-off] 多轮 continuation 后残留多个旧 session** → 只有 last session(sidecar 记录的)被清理。前几轮的旧 session 残留在磁盘上。可后续添加全局 session GC 作为增量改进。
