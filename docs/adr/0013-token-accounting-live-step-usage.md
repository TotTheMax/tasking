---
status: accepted
---

# Token accounting: keep raw totals, live step-level updates, sidecar persistence

Per-task token displays in the TUI (overview row, detail page, activity header) read `RunningEntry.input/output/total_tokens`, which the scheduler only updated on the worker's `turn_completed` event — i.e. after a turn's `opencode run` subprocess exits. Mid-turn (turns routinely run for many minutes) the entry stayed at 0, and every retry or daemon restart recreated the entry with tokens reset to 0 (the session sidecar restored `session_id`/`turn_count` but not tokens), so a task showing "Turn: 2" could legitimately display 0 tokens while its activity stream showed +80k steps.

Investigation found opencode's per-request `step_finish` usage reports `total = input + output + reasoning + cache.read`, and because each request re-reads the whole conversation context, summing `total` across requests double-counts cache traffic (daemon header showed `total 499,049` against `in 63,495 | out 5,325`). A switch to consumption-only (`input + output`, excluding cache) was considered and rejected on human decision: the daemon-wide `total` is intentionally a raw-cost figure (cache reads are billable), and that accounting semantics was analyzed before — keep it.

We decided three things: (1) **keep summing opencode's raw `total`** everywhere (per-task entries, daemon totals) — no semantic change; (2) the worker emits step-level usage events live, so per-task tokens update during a turn instead of only at turn boundaries — the scheduler accumulates them into the running entry, and `turn_completed` stops carrying usage (removed) to avoid double counting; (3) cumulative tokens are persisted in the session sidecar next to `session_id`/`turn_count` and restored on dispatch, so retries and daemon restarts resume the task's lifetime token count rather than resetting it.

TUI activity-view display is fixed separately: long event text is wrapped to the terminal width with correct CJK double-width handling (bounded at 3 lines per event), and the `Enter` key opens a full-text overlay for the selected event (scrollable, `Esc` closes). Logs view truncation is out of scope (separate change).

## Consequences

- Activity step lines still render `total` per step (unchanged meaning); per-task and daemon totals keep the same (inflated-by-cache) semantics as before, so displayed magnitudes don't shift.
- The session sidecar schema gains optional token fields; older sidecars without them restore as 0.
- `turn_completed` events no longer carry `usage`; callers that relied on it (the scheduler entry accumulation, and the scheduler test) switch to step-level `step_usage` events.

## Considered options

- Consumption-only totals (`input + output`): rejected by human decision — daemon-wide `total` must reflect raw cost including cache reads.
- Attempt-scoped tokens without persistence: rejected — retry/restart resets are exactly what the reporter saw ("Turn: 2 but 0 tokens"); session-scoped matches user intuition of "how much has this task's agent consumed".
