## Context

The Jira path (scheduler → workspace → worker → MR) owns "tracked, disposable work". TAS-41 adds a second, deliberately minimal mode: Feishu threads drive opencode sessions directly in user-owned fixed directories. Prior analysis (old session, summarized in ADR 0022/0023) settled the big axes; the human confirmed the last two decisions in the grill: permission posture = A + user-specifiable `auto_approve` (grill Q1), path guardrail = any existing directory + optional `path_roots` whitelist (grill Q2). Verified facts carried into this design: `opencode run` non-interactive auto-rejects `ask` permissions (exit 0, structured tool_use error event); default (no permission config) allows everything without `--auto`; `--attach`/serve is a validated phase-2 drawer whose iron rule is "always pass `--dir`".

## Goals / Non-Goals

**Goals:**
- `/chat <project> <msg>` and `/chat /abs/path <msg>` in the intake group start a direct session with an immediate ACK; all follow-ups happen in the created thread.
- One Feishu thread ↔ one opencode session; queued follow-ups become continuation turns (`-s <session_id>`); per-directory serialization.
- Per-turn `opencode run` subprocess reusing `runDefaultSubprocess` (timeouts, JSON events, kill escalation) through the existing `spawnRunner` seam shape.
- One summary message per turn (answer + stats); `verbosity: quiet|summary|detailed` (quiet drops the stats line; detailed mirrors each tool call).
- Minimal config to enable: `feishu.direct.projects` (even empty — path mode still works), everything else defaulted.
- Restart recovery from durable state; idle TTL expiry; `/done` `/stop` lifecycle commands.
- Independent concurrency budget (`feishu.direct.max_concurrent`, default 5) — no interference with Jira dispatch slots.

**Non-Goals:**
- No streaming, no card-button permission approval, no serve/attach backend (drawers; ADR 0023).
- No dynamic workspaces, no workspace-manager/hooks/MCP-injection/Liquid-template engagement on this path.
- No multi-group support (intake group only), no per-user allowlist (group membership = trust boundary, documented).
- No changes to scheduler semantics, worker turn-loop, or Jira bridge mirroring behavior.

## Decisions

1. **Separate `DirectSessionManager`, not synthesized Tasks in the scheduler.** Scheduler eligibility/retry/reconcile assume tracker state that does not exist for chat threads (ADR 0022). The manager runs on its own timer like `CommentBridge` and consumes the *same* ingest queue by delegation, preserving the single-consumer invariant (ADR 0018) and dedup/cursor/sweep machinery for free.
2. **Routing lives in `CommentBridge.processItem`, execution in `src/direct/manager.ts`.** The bridge checks `directStore.getByRootId(root_id)` before Jira binding lookup and recognizes `/chat`-prefixed root messages, delegating to an injected `DirectSessionPort`. Rationale: one queue, one cursor model, one dedup; alternative (second queue/cursor in the manager) duplicates ADR 0018 machinery and risks double-processing.
3. **Storage: `direct_sessions` table in the existing `bindings.db`** — `root_id TEXT PRIMARY KEY, chat_id, project TEXT NULL, path TEXT, session_id TEXT NULL, thread_id TEXT NULL, status TEXT ('running'|'idle'|'done'|'expired'), last_msg_id TEXT NULL, updated_at INTEGER`. The opencode session's display title is left to opencode's native content-based auto-titling (no tasking `--title` override). Rationale: session_id is not derivable from the directory; restart must rebuild running/idle sessions; better-sqlite3 is already a dependency. thread_id is captured from the creation ack's `replyInThread` result so the Sweep can re-pull direct threads (same loss-backstop guarantee as Jira bindings); dedup is per-session cursor (create_time seconds) plus a persisted, bounded seen-message-id set (`seen_ids` column, latest 50 per boundary second) so distinct same-second messages are each processed while redeliveries are skipped — including across daemon restarts.
4. **Turn execution borrows the runner primitives without `runAttempt`.** `runAttempt` is fused to workspace creation/MCP injection/hooks/Liquid — none apply. The manager calls `runDefaultSubprocess(cmd, path, timeout, inactivityTimeout, signal, env, onEvent)` directly with a command built by a new `buildDirectCommand(path, message, sessionId, opts)` (reuses `opencode.command` base, `--format json`, conditional `--auto`, inherited `opencode.agent`/`opencode.model`/`opencode.variant` (appended only when non-empty, Jira-path parity), **always** `--dir`). Rationale: maximal reuse of the battle-tested subprocess layer, zero entanglement; alternative (generalize `runAttempt`) would contaminate the Jira path with conditionals for no behavioral gain.
5. **Prompt = raw user message** (no template). No `--title`: opencode derives a content-based title for the session itself; continuation turns append nothing — opencode's `-s` session already carries context.
6. **Delivery: ACK → silence → one summary message.** ACK on enqueue (`✅ 已开始 …`); on turn completion send the last assistant `text` event, prefixed with a one-line stats footer (`⏱ 42s · 🔧 7 次工具调用 · ≈12.3k tokens`). `verbosity: detailed` additionally sends one message per completed tool call (`state.title`, trimmed to ~200 chars). Errors/timeouts/permission rejections surface in the summary text (permission rejections are already visible as tool_use error events). Feishu message length: hard-truncate final text to ~3500 chars with an ellipsis marker.
7. **Permissions: tasking passes `--auto` only when enabled** (`feishu.direct.auto_approve`, default false; per-project override in `projects` entries, which may be `{path, auto_approve}` objects or plain path strings). Otherwise the target project's own opencode permission config rules; `ask` auto-rejects safely and is reported.
8. **Path guardrail (grill Q2 = B+C):** project-map paths are used as configured; ad-hoc `/chat /path` requires the path to exist and be a directory; if `feishu.direct.path_roots` is non-empty, ad-hoc paths must fall under one of the prefixes (resolved to absolute). No git-repo requirement. All paths resolved via `realpath` before use.
9. **Concurrency:** at most `max_concurrent` direct turns daemon-wide AND at most one turn per directory AND one in-flight turn per session; follow-ups arriving during a turn are buffered in memory (session queue) and drain FIFO after completion — batched: if multiple follow-ups accumulated, they are joined with `\n---\n` into one next-turn prompt (fewer cold starts, natural conversation chunk). Direct-turn spawns count against the direct budget only.
10. **Lifecycle:** `/done` → status `done` (bot replies with cumulative session stats; thread then falls silent, further messages get a terminal hint once); `/stop` → SIGKILL-equivalent abort of the current turn via AbortSignal (`runDefaultSubprocess` contract), status back to `idle`, summary notes the interruption; idle TTL (default 30d, checked on the manager's slow timer) marks `expired` without touching the opencode session on disk.
11. **Restart recovery:** on `start()`, sessions in `running` status whose turn is gone (daemon died mid-turn) are marked `idle` and a note is posted to the thread ("上次运行被中断，请重发消息"); no orphan processes exist because children die with the daemon (detached kill tree applies to timeout only — daemon crash kills the process group).

## Risks / Trade-offs

- [Agent writes to a real repo with default-allow permissions] → Documented trust boundary (intake group = trusted); `path_roots` + per-project permission config + `auto_approve: false` default; every turn's tool calls auditable in `detailed` mode and via ActivityStore/TUI.
- [Two users /chat the same project simultaneously] → per-directory serialization queues the second session's turns; no git-index corruption; UX cost = wait, announced by ACK.
- [Feishu message loss mid-flow loses a turn result] → the opencode session persists; user can re-ask "重复一下刚才的结果" — same recovery property the Jira bridge relies on.
- [Runaway token spend with no tracker state as natural brake] → TTL + `/done` + per-turn timeout defaults inherited from `opencode.*` config; direct sessions reuse `turn_timeout_ms`/`inactivity_timeout_ms`.
- [Thread reply vs flat confusion] → direct-session traffic always uses `replyInThread(root_id)`; group-level output is only the original `/chat` ACK thread.
- [Config hot-reload changes projects map mid-session] → session keeps its stored absolute `path` (frozen at creation); a removed project's existing sessions still work until done/expired.

## Migration Plan

Additive only: new config section (defaults keep the feature off unless `feishu.direct` is present in WORKFLOW.md), new table (CREATE IF NOT EXISTS on existing DB open), no changes to existing scheduler/bridge behavior beyond routing hand-off. Rollback = remove the `feishu.direct` block. No data migration.

## Open Questions

None — the two grill questions were answered (Q1 = A + strengthened auto option; Q2 = B+C hybrid); everything else was resolved from code, probes, or the prior analysis session.
