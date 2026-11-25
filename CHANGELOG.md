# Changelog

## 0.8.0

Direct-session turn cards and auto-continue.

### Added

- **Auto-continue for direct sessions**: `/loop on [N]` arms the current or next
  task, `/loop start [N]` starts one immediately, `/loop off` disables it, and
  `/loop prompt [text|reset]` manages the continuation prompt. The budget counts
  only auto turns (default 5, 1–20); user turns do not consume it. Two
  consecutive low-output or repeated turns, or a turn that ends in a question,
  soft-pause; budget exhaustion, failure, permission timeout, and `/stop` hard-stop.
  `turn_timeout`/`inactivity_timeout` retry as ordinary auto turns under the same
  budget. Process-card headers show `🔄 自动 n/N`; auto turns never overwrite the
  card's retry prompt. Configured by `feishu.direct.auto_continue`
  (`budget`, `no_progress_streak`, `prompt`); direct-only, Jira-bound topics get a
  hint and never bridge.
- Turn cards now render one ordered event stream (assistant text and tool calls
  interleaved in source order) and spill into sealed Segment cards when a card
  would exceed the payload/element budget; only the active segment keeps the
  control buttons.
- Turn-card density: the oldest tool panels degrade (15 lines → 3 lines → output
  removed, inputs kept) before a new segment card is opened; one dense card is
  preferred over short history segments, and shared input truncation counts
  toward the one-card fit check. Multi-segment turns show `🔧 本段 X · 本轮 Y`.

### Changed

- The auto-continue prompt is displayed exactly as configured — the UI no longer
  translates it — and the English WORKFLOW templates ship an English default
  prompt. The built-in Chinese fallback remains and only applies when the field
  is absent.

### Fixed

- Direct turns now settle from the session idle record plus an output guard
  instead of the paged prompt anchor: tool-heavy turns that evict their own
  prompt message no longer stay "running" indefinitely (one incident ran 12+
  hours), and `inactivity_timeout_ms` starts at prompt submission.
- Pending permissions no longer count as progress; a cumulative approval wait of
  twice `permission_timeout_ms` settles the turn as `permission_timeout` and
  interrupts the server-side turn.
- Messages queued right after `/stop` now run once the aborted turn finishes
  instead of being silently dropped.
- Auto-continue stop text reports the real used count instead of `0/N`.
- WORKFLOW.md hot reload now survives editors that save atomically (write a
  temp file, then rename): the watcher follows the path instead of a replaced
  inode, so every save reloads instead of only the first one.

## 0.7.1

### Added

- Direct sessions can opt into same-directory concurrency via
  `feishu.direct.max_concurrent_turns_per_dir` (integer >=1, default `1`).
  `1` keeps the existing serialized behavior; `2+` lets several turns occupy
  one directory at once, and the operator owns the shared-worktree race risk.
  The global `max_concurrent` cap still wins, approval waits keep their slot,
  and startup/hot-reload raise a WARN when the limit is above one.
- `/api/v1/state` now exposes `direct_dirs` (`path`, `active`, `limit`,
  `waiters`) so directory occupancy is observable; idle directories are pruned.
- Resolved model observability: `session.create`/`session.get` results carry the
  server-resolved model into turn logs, scheduler events, the TUI, and the
  session sidecar; adjacent turns that drift raise a WARN. `tasking doctor`
  gains a model-resolution check (configured validation / unconfigured warning
  with the actual value / unreachable info degrade).
- Interactive `tasking init` model picker (subsequence search, top-20 by
  release, free tags, manual fallback, 15s probe degrade) plus a `--model`
  pre-answer flag; `--update` never touches an existing `opencode.model`.
- The eight shipped WORKFLOW templates now document `auto_approve`,
  `poll_interval_ms`, and `server_url` in the `opencode` block.

### Fixed

- The doctor model probe falls back to `process.cwd()` when the configured
  workspace root does not exist yet, avoiding spawn `ENOENT` on a fresh setup.
- Same-directory concurrency keeps queued turns when the limit is lowered
  (the counted semaphore hands slots off without dropping waiters).

## 0.7.0

opencode v2 baseline. tasking 0.7 drives every turn through the `opencode api`
command (session create/prompt/poll/interrupt) instead of spawning
`opencode run`, and **drops opencode v1 support** — v1 is frozen on the
`support/v1` branch (0.6.x).

### Breaking changes

- **opencode v2 required**: `opencode >=2.0 <3`. The daemon refuses to start on
  v1 or v3+ (`opencode upgrade --major` to upgrade); an unvalidated 2.x minor
  warns but runs.
- **`opencode.command` default changed** from `opencode run` to `opencode`.
  Existing `WORKFLOW.md` files that still say `opencode run` must drop the
  `run` argument.
- **`auto_approve: false` semantics changed**: a workspace `ask` permission now
  pends for a Feishu approval card (allow once / always allow / reject, 30-minute
  budget, auto-reject on timeout) instead of being auto-rejected. The
  `--auto`/`--dir`/`--variant` flags no longer exist.
- **Progress is polled** (`opencode.poll_interval_ms`, default 2000ms) rather
  than streamed; token totals are `input + output + reasoning` (v2 has no
  `total` field).

### Added

- Synchronous permission approval: `permission_timeout_ms` (default 1800000),
  approval cards for both direct sessions and Jira-bound threads.
- New `opencode` config keys: `poll_interval_ms`, `permission_timeout_ms`,
  `server_url`.
- Launch-time version gate and `tasking doctor` opencode service/auth probes.
- Daemon restart sweep: orphan sessions from a previous run are interrupted.
- MCP injection uses the v2 `mcp.servers` shape (with `codemode: true`, so the
  Jira tools land in the session's Code Mode tool catalog).

### Fixed

- MCP server script resolution falls back to `dist/mcp/jira-server.js` when the
  daemon runs from source (tsx), so Jira tools actually load; a missing script
  is now visible (worker error log + a new `tasking doctor` item) instead of
  failing silently while agents fall back to curl with the raw token.
- Failed/timed-out attempts delete their now-orphaned opencode session before
  retrying fresh (`orphan session deleted`), and the sidecar is written the
  moment a session is created — a crash mid-first-turn is sweepable on restart.
- SIGINT/SIGTERM drains in-flight attempts (≤15s): the server-side turn is
  interrupted and orphan cleanup runs before exit, closing the zombie-turn
  window where a killed daemon leaves a turn burning tokens server-side.
- A low-cadence terminal sweep (every 10 idle ticks) cleans workspaces for
  tasks that reached a terminal state after leaving the running loop (e.g.
  review → done), instead of waiting for the next daemon restart.
- Direct-session recovery after a restart now interrupts the still-running
  server-side turn instead of just marking the session idle.
- Approval cards and fallback texts redact credentials (`Bearer ***`, long
  token runs) so Jira tokens never render into Feishu chat history.
- Task descriptions over 40k chars are truncated before prompt rendering and
  `session.prompt` hard-rejects prompts over 120k chars (`prompt_too_large`),
  avoiding argv-size (E2BIG) failures on oversized tickets.
- Jira-task launch logs now carry the concrete command
  (`command: opencode api … session.prompt`) plus model; direct-turn logs match.
- TUI: long log lines wrap (8-line cap per entry) instead of truncating; the
  direct list/detail gets a `d` delete key (two-step confirm) backed by
  `POST /api/v1/direct/:rootId/delete`.
- Direct `/agent` and `/model` overrides now take effect on an existing session
  (applied via `session.switchAgent` / `session.switchModel`).
- Concurrent pending approvals keep earlier requests actionable.
- Session cleanup uses `opencode api session.remove`.
- Polled messages are de-duplicated across turns and processed oldest-first, so
  tool panels and token totals no longer accumulate prior turns.
- English translations for the v2 gate/service/auth and approval surfaces.
