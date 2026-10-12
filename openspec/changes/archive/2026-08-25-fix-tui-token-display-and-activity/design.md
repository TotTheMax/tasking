## Context

Per-task token displays read `RunningEntry.input/output/total_tokens`. The worker (`runner.ts`) only reported usage on the `turn_completed` event, computed by `extractSessionAndUsage` re-parsing the turn's full stdout after the `opencode run` subprocess exits. Mid-turn the entry stays at 0; on retry/daemon restart `dispatch()` recreates the entry from the session sidecar, which persists `session_id`/`turn_count` but not tokens, so the displayed count resets.

Meanwhile `onOpencodeEvent` already parses each `step_finish` live (routing token usage to the activity view via `onActivity`), but that live stream is not connected to the running entry. Verified against opencode's DB that `step_finish` `part.tokens` reports per-request `{input, output, reasoning, cache.read, cache.write}` with `total` folding in cache reads; summing `total` is the established daemon-wide cost figure and is kept by human decision (Q1).

The activity view (`formatActivity`) truncates text with a raw `.slice(0, 80)`, ignoring that CJK chars occupy two terminal columns, so Chinese messages overflow the terminal width and appear cut off. There is no way to view the full text.

## Goals / Non-Goals

**Goals:**
- Per-task tokens update live during a turn (from `step_finish` events) and survive retries/restarts via sidecar persistence.
- Activity view renders CJK-correct wrapped text (≤3 lines per event) with a `Enter`-open full-text overlay.
- Keep token accounting semantics unchanged (raw `total` including cache), per human decision.

**Non-Goals:**
- Changing daemon-wide totals semantics or the throughput/sparkline math.
- Fixing the equivalent truncation in the Logs view (separate change, Q4).
- Backfilling historical tokens for already-completed sessions.

## Decisions

### D1. Live step-level usage via a new `step_usage` worker event
The worker's `onOpencodeEvent` callback, which already receives each parsed `step_finish`, also emits `{event: "step_usage", usage: {input_tokens, output_tokens, total_tokens}}` to `opts.events.onEvent`. The scheduler's existing `if (event.usage)` accumulation branch picks it up with no scheduler-side change. `turn_completed` stops carrying `usage` so a turn's tokens are counted exactly once (the sum of its step events equals `extractSessionAndUsage`'s per-turn total, since both derive from the same `step_finish` lines).
- *Alternative considered:* keep `turn_completed` usage and dedupe in scheduler — rejected (double-count risk, and step events are the natural single source).

### D2. Sidecar token persistence
`SessionSidecar` gains optional `inputTokens`/`outputTokens`/`totalTokens`. `writeSessionSidecar` accepts an optional tokens arg; the runner passes `baseTokens + attempt-usage` (cumulative session lifetime) after each turn. `dispatch()` restores them into the fresh `RunningEntry`. Older sidecars missing the fields restore as 0.
- *Alternative considered:* persist only on worker exit — rejected (crash/long-turn loses progress).

### D3. Activity view: width-aware wrap + expand overlay
- Add a small CJK display-width helper (`displayWidth`, `wrapToWidth`, `truncateToWidth`) — zero new dependencies (repo has only `better-sqlite3` + the opencode plugin).
- `formatActivity` renders each event's text as wrapped lines (split on `\n` first), at most 3 lines, with `…` for hidden overflow; the event window follows a selectable cursor.
- ↑↓ moves the event cursor (disabling follow); `Enter` opens an `activity-detail` overlay showing the full text (scrollable via ↑↓); `Esc`/`q` returns to the list. Key hints in the footer are updated.
- *Alternatives considered:* wrap-only without overlay (rejected: noisy for very long text), overlay-only with single-line truncation (rejected: CJK overflow persists in the list).

## Risks / Trade-offs

- [Wrapped multi-line events change the vertical rhythm of the activity list] → cap at 3 lines; the cursor/window math stays event-based (viewer height is bounded by the terminal, acceptable for a status TUI).
- [`step_usage` events add traffic to the event stream] → negligible: one event per `step_finish`, same rate as activity capture already does.
- [Sidecar writes on every turn touch the workspace FS] → same cadence as today's `writeSessionSidecar` calls; no new failure path (best-effort JSON write).

## Migration Plan

No config migration. Old sidecars lack token fields and read as 0 (matches today's behavior). Deploy is the feature branch MR to `main`.