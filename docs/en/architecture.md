# Architecture Overview

This document explains the overall architecture of `tasking`: the dual-source dual-scheduler model, shared Task model, worker subprocess isolation, state persistence and restart recovery, and safety invariants.

## Dual-Source Dual-Scheduler

`tasking` orchestrates coding-agent work from two distinct task sources, both converging on a shared worker path.

```
Jira (结构化) ──► 确定性调度器 ──┐
                                 ├──► 共享 Task 模型 ──► 工作区 ──► opencode v2 worker
飞书 (直连会话) ──► direct worker ─┘
```

### Structured Path (Jira): Deterministic Scheduling

The Jira path uses Symphony-style deterministic scheduling, **with no LLM in the hot loop**. The scheduler polls Jira at fixed intervals, performs eligibility checks and ordering on candidate tasks, and dispatches eligible tasks to the worker.

Scheduling loop (each tick):

1. **Reconcile**: first reconciles running tasks — detects stalls (no activity for over `stall_timeout_ms`), refreshes tracker state (terminal: stop and clean workspace; active: update snapshot; other: stop without cleaning).
2. **Pre-validation**: validates config (`tracker.kind`, credentials, `opencode.command`); on failure skips this tick's dispatch but keeps reconciliation.
3. **Fetch candidates**: uses JQL to fetch Jira issues in active states.
4. **Ordering**: sorts by `priority` ascending, `created_at` oldest first, then `identifier` lexicographically.
5. **Dispatch**: dispatches eligible tasks one by one while global and per-state concurrency slots are available.

Dispatch eligibility: the task has id/identifier/title/state, the state is active and non-terminal, contains all `required_labels`, not running, not claimed, and a concurrency slot is available; for the Todo state, all blockers must also be terminal.

### Unstructured Path (Feishu): route agent triage (**not implemented**)

> **Not implemented**: this section is a design sketch — the route-agent / inbox triage path has no runtime code today (no `src/router/`, no `tasking triage` handler). For the current Feishu capabilities see the direct sessions and comment bridge in the [usage guide](./usage.md).

The Feishu path uses an LLM **only for triage**: turns chat messages into a normalized `Task` + dispatch decision, then hands off to the same deterministic worker path.

Flow:

1. **Ingestion**: Feishu IM text messages, after @mentioning the bot, are idempotently ingested into a persistent inbox (SQLite).
2. **Triage**: a route agent (driven through the opencode api with the triage agent profile; **unimplemented**) runs in a bounded manner per tick, reading, deciding, and replying via the `inbox.pop_untriaged` / `inbox.mark_decision` / `feishu.reply` tools.
3. **Dispatch**: entries decided as "dispatchable" are normalized into `Task` and dispatched via the shared worker path (subject to the same concurrency budget); inbox entries are marked `dispatched`.

At most one route agent runs at a time (unless configured otherwise), and it **does not block** the structured scheduler.

### Shared Convergence Points

The two paths converge at three points:

- **Shared Task model**: Jira normalization produces the `Task` type (route agent output is planned, not implemented).
- **Shared workspace manager**: per-task workspace creation/reuse/hooks/safety invariants.
- **Shared worker**: drives opencode v2 sessions through `opencode api` (shared background service).

Global concurrency (`agent.max_concurrent_agents`) caps concurrent Jira worker turns. Feishu direct sessions run on a **separate** budget (`feishu.direct.max_concurrent`, default 5) so an interactive `/chat` turn is not queued behind a Jira backlog.

With `feishu.direct.verbosity: detailed` (the default), each turn posts one updatable **turn card**: a session-state header, collapsible per-tool panels (failures expanded by default) and a control row; when the turn ends the card is sealed (its button row becomes a stats line) and the next turn gets a fresh card. The card is the **process plane** and the per-turn completion text is the **result plane** (quotable, searchable). Two platform constraints drive that shape: a Feishu card is capped at 30KB and updates replace the whole card, so cards are per-turn and degrade within a turn by budget; card updates and thread-internal messages produce no push notification, so notification is left to Feishu's own conversation semantics.

Card buttons (interrupt / retry / full output / end) arrive as `card.action.trigger` callbacks over the event channel on an **independent fast path** — never behind the message ingest queue — and the handler only makes fast state changes and returns `toast + new card` (over the long connection the handler's return value *is* the callback response, i.e. the card update); slow work (deleting the opencode session, sending result text, uploading a file) runs after it returns. When cards are unavailable (callback failure, port without card support) delivery degrades to coalesced text.

Data-plane boundary: the card is the **in-Feishu view of a turn** (one per turn, trimmed to the 30KB budget) while the TUI activity view (`direct:<root_id>`) is the **local full event stream** (an in-memory ring buffer); the two are independent. `📄 Full output` reads the turn's in-memory accumulator and delivers it as a file attachment.

## Shared Task Model

Regardless of source, all tasks are normalized into a unified `Task` entity:

| Field | Type | Description |
|------|------|------|
| `id` | string | stable internal ID within the tracker |
| `identifier` | string | human-readable identifier (e.g. `ENG-42`) |
| `title` | string | title |
| `description` | string\|null | description |
| `priority` | number\|null | priority (lower number = higher priority; non-integers become null) |
| `state` | string | current state name |
| `branch_name` | string\|null | branch metadata |
| `url` | string\|null | link |
| `labels` | string[] | labels (lowercased) |
| `blocked_by` | BlockerRef[] | blocker relationships (includes id/identifier/state) |
| `created_at` | number\|null | creation time (ms) |
| `updated_at` | number\|null | update time (ms) |
| `source` | `"jira"`\|`"feishu"` | task source |

Jira normalization: `labels` trimmed and lowercased; `priority` integers only; `blocked_by` derived from issue links; timestamps parsed from ISO-8601. (The route-agent-produced `Task` is a planned path, not implemented.)

## Worker opencode v2 driver

Each task attempt drives an opencode v2 session through `opencode api` (tasking 0.7 requires `opencode >=2.0 <3`, see ADR 0035):

```bash
opencode api session.create --data '{"location":{"directory":"<workspace>"},"model":{...}}'
opencode api session.prompt --param sessionID=<ses_...> --data '{"text":"<rendered prompt>"}'
opencode api session.get / session.permission.list / session.message.list   # polling
opencode api session.interrupt --param sessionID=<ses_...>                  # timeout/abort
```

- **Shared background service**: auto-discovers the machine's user-level opencode service (the same one the user's TUI uses); tasking never manages that process. `opencode.server_url` overrides it explicitly.
- **Progress and terminal state come from polling** (ADR 0037): `session.get`'s `outcome` (succeeded/failed/interrupted) is the terminal state; `session.message.list` settled-assistant diffs provide tool entries (`state.input`/`state.metadata.exit`/`state.time`) and text; `session.permission.list` provides pending approvals.
- **Permission posture** (ADR 0036): `auto_approve: true` creates the session with an allow-all ruleset; `false` follows the workspace's `.opencode` rules, so `ask` pauses and posts an approval card (see usage). Posture changes apply immediately via `session.update`.
- **Bounded session continuation loop (aligned with Symphony)**: turn 1 creates the opencode session with the full prompt; turn 2+ continues `session.prompt` on the same session (the agent keeps full conversation context). After the worker exits, continuation retry creates a **fresh session**. After each success it rechecks the tracker state; if still active and under `max_turns`, the next turn starts; the agent is re-resolved each turn and switched at turn boundaries.
- **Session lifecycle management**: turn 1 creates a session and writes a workspace sidecar file (`.tasking-session.json`); turn 2+ reuses it; when a task enters terminal state triggering workspace cleanup, it reads the last session ID from the sidecar and deletes the session.
- **Attempt lifecycle**: goes through `preparing_workspace` → `building_prompt` → `launching_agent` → `finishing`, with terminal states `succeeded` / `failed` / `timed_out` / `stalled` / `canceled_by_reconciliation`.
- **Failure classification**: wall-clock timeout (`turn_timeout_ms`) → `timed_out` (`turn_timeout`); inactivity timeout (`inactivity_timeout_ms`) → `timed_out` (`inactivity_timeout`); a session `failed` outcome → `failed`; stall (scheduler-detected) → `stalled`.
- **Timer matrix**: inactivity (10min, no new messages across poll cycles) → wall-clock (1h, execution budget) → stall (2h, scheduler layer). **Inactivity and wall-clock pause while waiting for approval**, when the approval budget (30min) takes over and auto-rejects on expiry. Timeouts/aborts use the interrupt ladder (`session.interrupt` → short grace → clean up residual api processes); process-group kills are gone.
- **Token extraction**: accumulates polled message/session tokens (total = input+output+reasoning, cache reported separately); falls back to timing when unavailable.
- **Daemon restart sweep**: at startup, persisted sessions are filtered through `session.active` and still-running ones get an `interrupt`; the task then fails into normal retry.
- **Workspace retention**: after a successful attempt the workspace is not deleted, for reuse by subsequent turns.

Before starting the worker, three safety invariants are enforced (see below).

## State Persistence and Restart Recovery

`tasking` deliberately distinguishes the persistence of two kinds of state:

### Scheduling state: in-memory, not across restarts

The orchestrator's `OrchestratorRuntimeState` (`running`, `claimed`, `retry_attempts`, `completed`, aggregate totals) exists only in-memory in-process. **Not recovered after restart**:
- No retry timer survives a restart.
- No running session is assumed recoverable across a restart.

Restart recovery strategy (a model proven by Symphony):
1. At startup, queries the tracker for terminal-state tasks and deletes the corresponding workspaces (terminal cleanup).
2. Re-polls active tasks and redispatches them as new attempts.
3. Reuses the retained per-task workspace directories.

### inbox: SQLite, across restarts

> **Not implemented**: the unstructured-triage inbox (the SQLite queue described below) is a design sketch with no runtime code.

This is the only persistence delta versus Symphony — Symphony has no inbox because it is single-source (Linear).

## Retry and Backoff

- **Normal exit → continuation retry**: after the worker exits normally, the scheduler schedules a short continuation retry (attempt 1, fixed 1000ms delay) to re-check whether the task still needs processing.
- **Abnormal exit → exponential backoff retry**: delay is `min(10000 * 2^(attempt-1), agent.max_retry_backoff_ms)`, capped by `max_retry_backoff_ms` (default 300000ms / 5 minutes).
- **retry handling**: when the retry timer fires, it re-fetches active candidates; if the task is missing or no longer active, it releases the claim; if there are no slots, it re-enqueues with attempt incremented (reason `no available orchestrator slots`); if eligible, it dispatches.

## Safety Invariants

Three non-negotiable filesystem safety invariants, enforced before starting the worker:

1. **agent cwd == workspace path**: the worker subprocess's cwd must equal the current task's per-task workspace path. On mismatch the attempt is aborted.
2. **workspace path is within root**: both the workspace path and the workspace root are normalized to absolute paths, requiring the workspace path to be prefixed by the root directory. Path escape (e.g. via `..` traversal) is rejected.
3. **workspace key is sanitized**: the workspace directory name only allows `[A-Za-z0-9._-]`; other characters are replaced with `_`.

Additionally:
- **hook scripts are fully trusted**: hooks in `WORKFLOW.md` run arbitrary shell via `bash -lc` in the workspace directory, bounded by `hooks.timeout_ms` (default 60s). A hook timeout produces a `hook_timeout` error category. Only version-control hooks from trusted sources.
- **symlink safety**: `isWithinRoot` uses `realpathSync` to resolve symlinks before prefix matching, rejecting symlink escapes. workspace == root is rejected.
- **orchestrator does not write to the tracker**: ticket changes (state transitions, comments) are done by the coding agent through its tools; the orchestrator is read-only.
- **API tokens never enter logs**: `$VAR` indirection keeps secrets out of `WORKFLOW.md`; logs do not record token values.

## Observability

### Structured Logging

JSON line format output to stderr and an optional file sink (10MB×5 rotation). Required context fields: `task_id`, `task_identifier`, `session_id`. See `docs/logging.md`.

### HTTP Dashboard

Enabled via `--port` or `server.port`. Endpoints:
- `GET /` — HTML dashboard
- `GET /api/v1/state` — global state JSON (includes `codex_totals`, ISO 8601 timestamps)
- `GET /api/v1/config` — current effective config + runtime properties (secrets masked as `****`)
- `GET /api/v1/<identifier>` — single issue details
- `GET /api/v1/<identifier>/activity?limit=N` — the running task's opencode activity event stream (assistant text / tool calls / step tokens, near-live, 1 Hz poll; `tool_use` events carry the execution detail fields)
- `POST /api/v1/refresh` — triggers an immediate poll + reconcile (returns `{queued, coalesced, operations}`)

Unsupported methods return `405 Method Not Allowed`. The bind address is configured via `server.host` (default `0.0.0.0`).

### Terminal TUI State Panel

Enabled via `--tui`. ANSI-colored terminal rendering, redrawn on a timer (1s) pulling a snapshot. Includes:
- summary bar (agents/tps/runtime/tokens)
- running tasks table (ID/STATE/AGE/TURN/TOKENS/SESSION/EVENT)
- backoff queue (identifier/attempt/countdown/error)
- sparkline throughput chart (10-minute window, 24 columns)
- recent logs (in-memory ring buffer, last 6 entries, colored by level)
- config view (press `c` to enter): effective config + runtime properties, secrets masked, scroll with `j` / `k`
- activity view (press `a` from the task detail page): renders the running task's opencode interaction stream (assistant text, one-line tool-call summaries `🔧 <tool> · <command>/<file>`, red `✗` for failures, step token deltas) and the current `model`/`agent`/`variant`, near-live; `Enter` expands a `tool_use` event into structured execution detail (status/exit code, command/arguments, output, duration; very long output is capped to the tail), `j`/`k` scroll, `Space`/`f` pause follow, `Esc`/`q` back to detail
- throttled dedup (no redraw when content is unchanged)

Config view data comes from the daemon-side effective config (`ConfigManager.current` / `GET /api/v1/config`), not the local raw WORKFLOW.md — ensuring what you see is what runs, after hot-reload and defaults/environment-variable expansion (ADR 0005). The in-process TUI (`start --tui`) reads the in-memory config directly; the attached TUI (`tasking tui`) pulls the same masked data via `/api/v1/config`. The `.tasking/daemon.json` metadata contains `pid`, `port` (the actual bound port; an ephemeral port when `--port 0`), `host`, `started_at`, and `workflow_path`, used by `status` / `tui` / `stop` to locate the daemon in the current directory.

When the TUI is enabled, logs are written only to the file sink (not stderr), to avoid fighting over the terminal.

### Pub/Sub Notifications

The scheduler extends `EventEmitter`, emitting events on dispatch/workerExit/retry/reconcile. The HTTP dashboard and TUI can subscribe to trigger refreshes.

## Design Origin

This architecture is ported from the [Symphony](https://github.com/openai/symphony) SPEC, with three substitutions (Linear→Jira, Codex app-server→opencode v2 API, Elixir→TypeScript) and one planned delta (route agent + inbox, **not implemented**). Full design decisions are in `openspec/changes/bootstrap-tasking-runtime/design.md`.
