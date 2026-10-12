## Why

The TUI shows 0 tokens for a running task on the overview row, detail page, and activity header even while the daemon-wide header counts them, because per-task tokens are only updated at `turn_completed` (subprocess exit) and reset to 0 on every retry/daemon restart (the session sidecar persists `session_id`/`turn_count` but not tokens). Separately, the activity view hard-truncates long event text at 80 characters without respecting CJK double-width rendering, so Chinese messages are clipped mid-line with no way to read the full text.

## What Changes

- Worker emits a live `step_usage` event for each parsed `step_finish` token report, so the scheduler accumulates per-task tokens during a turn instead of only at turn boundaries; `turn_completed` stops carrying `usage` (removed) to avoid double counting. Accounting semantics unchanged: still sums opencode's raw `total` (cache reads included), per human decision.
- Session sidecar gains optional token fields; the scheduler restores them on dispatch so per-task tokens reflect the session lifetime across retries and daemon restarts.
- Activity view: long event text is wrapped to the terminal width with correct CJK double-width handling, bounded to at most 3 lines per event with an ellipsis marker; an event is selectable via ↑↓ and `Enter` opens a full-text overlay (scrollable, `Esc` returns to the list).
- Logs-view truncation is out of scope (separate change).

## Capabilities

### New Capabilities

- `activity-text-expand`: full-text overlay and width-aware wrapping for long activity events in the TUI.

### Modified Capabilities

- `task-activity`: token events are now also routed to per-task token accounting (live `step_usage`) and the activity header shows the session-lifetime token count restored across restarts.
- `terminal-dashboard`: activity view renders wrapped multi-line events with an expandable full-text overlay and updated key hints.

## Impact

- `src/worker/runner.ts` — emit `step_usage` events, drop `usage` from `turn_completed`, write cumulative tokens into the session sidecar.
- `src/workspace/manager.ts` — `SessionSidecar` token fields + `writeSessionSidecar`/`readSessionSidecar` signatures.
- `src/scheduler/scheduler.ts` — restore sidecar tokens on dispatch; accumulate `step_usage` into the running entry.
- `src/observability/terminal-dashboard.ts` — activity rendering, cursor selection, full-text overlay mode, CJK-aware width helper.
- Tests: `tests/worker.test.ts`, `tests/scheduler.test.ts`, `tests/terminal-dashboard.test.ts`, `tests/workspace.test.ts`.
- Docs: `docs/en|zh/usage.md` TUI key hints.