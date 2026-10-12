## Context

The TUI Log view (`logs` mode, key `L`) and Activity view (`activity` mode, key `a`) are "live tail" lists: while `*Follow` is true the viewport shows the newest `VIEWPORT` entries and re-centers as new entries arrive. Pressing `Space`/`f` is meant to pause that follow. Today it only flips `logFollow`/`activityFollow` to false and clears the numeric anchor (`logAnchoredStart`/`activityAnchoredStart`) to `null`. Both renderers treat a `null` anchor as "still follow", so the header shows `[paused]` while the viewport keeps tracking the tail — the reported bug.

Two independent defects:

1. **Pause never anchors.** Pausing from a live tail sets the anchor to `null`; `formatLogs`/`formatActivity` fall back to the newest window, so new entries keep scrolling onto the screen.
2. **Numeric anchors drift.** Anchors are indexes into the renderer's *current* entry list. The Log view draws from `logBuffer.recent(200)` (a 5000-capacity ring sliced to the last 200), so once the daemon has logged >200 lines the oldest entry drops off the front on every push and a fixed index silently points at newer content. The prior `cd6842e` fix moved from offset-from-end to an absolute index but only holds while the buffer holds ≤200 lines; a busy daemon exceeds that quickly, so even a "correctly" paused view resumes scrolling one line per new log.

## Goals / Non-Goals

**Goals:**
- `Space`/`f` pause freezes the visible entries in both Log and Activity views; new entries do not shift the screen until the user scrolls or resumes.
- Resume (`Space`/`f` while paused) clears the pause and returns to live-follow at the newest entry.
- The freeze is stable under buffer window roll-over (no drift for long sessions), at least where entries have stable object identity.
- Manual scrolling while paused keeps working; `[paused]`/`[follow]` tag, header counts, and scroll indicators still update.
- Overview footer stops advertising the inert `Space pause`.

**Non-Goals:**
- Not changing ring buffer capacities, dedup, or the log/activity fetch cadence.
- Not adding a "N new entries since pause" badge or other new UI affordances.
- Not changing search, level-filter, or jump-to-match semantics beyond keeping them consistent with the new anchor model.
- Not touching overview/list/detail scrolling.

## Decisions

### D1 — Follow is the source of truth; a paused view always has a real anchor

Replace the "`null` anchor means follow" convention. `logFollow === true` ⟺ live tail (render newest window, ignore the anchor). `logFollow === false` ⟺ paused/manual, in which case a concrete anchor is always set at the moment of pausing or scrolling. Pausing from a live tail anchors the viewport to the entry at the current window top (the tail-top `total - VIEWPORT`); subsequent renders keep that entry at the top row, so the screen is frozen while the count/`[paused]` indicators refresh.

Rationale over "pause = remember a boolean and keep showing whatever index": the renderers must never be left in a state where `follow=false` yet no anchor exists — that state is exactly the bug.

### D2 — Log view anchors by entry identity, not by index

Log entries are objects stored in the ring; `recent()`, level filtering, and search filtering all preserve object references, in both the in-process daemon TUI and the attached `tasking tui` (which maintains its own deduped ring, `cli/index.ts:621-650`). So the Log view stores a **pinned top `LogEntry`**. Each render locates the pinned entry by `indexOf` and derives `start` from its current index; if it has fallen out of the `recent(200)` window (200+ new lines while paused), it re-pins to the oldest still-visible entry (`entries[0]`) and keeps the view still rather than jumping to the tail. This eliminates the index-drift defect.

### D3 — Activity view pauses the numeric anchor (no recenter)

Activity entries come from `activityStore.recent(id, 500)` in-process (stable refs) or `fetchActivity` over HTTP in the attached TUI (fresh JSON objects every 1 Hz poll — no cross-render identity). Identity pinning is therefore not reliable in the attached-TUI case. Instead the Activity view:
- fixes defect 1 by setting a real numeric `activityAnchoredStart` on pause (tail-top), and
- stops re-centering the cursor/start to the newest row while `activityFollow` is false (only the follow branch re-centers today).

A numeric anchor for activity only drifts once a single task has produced >500 events server-side during one pause (front splice), an accepted trade-off. Manual `j/k` movement keeps today's semantics: move the cursor, then `ensureActivityCursorVisible` re-anchors around it.

Rationale over forcing identity pinning here: fetching would need a stable per-event id (currently none exists) or value-key matching (ambiguous for repeated text/tool lines), for the marginal remote-only >500-event case.

### D4 — Single toggle path for `Space`/`f`

`Space` and `f` currently toggle follow with subtly different anchor handling (`f` clears the anchor in both branches; ` ` only when resuming). Both keys route to one helper per view (`toggleLogFollow`, `toggleActivityFollow`) so pause and resume behave identically for both keys.

### D5 — Dead `logScrollOffset` field removed

`logScrollOffset` is written in several places but never read (`formatLogs` computes `start` from the anchor). Remove it along with the anchor rework to avoid a misleading second "scroll position" field.

### D6 — Overview help text corrected

Remove ` · Space pause` from the overview footer (`formatOverview`), which today implies Space acts in overview where it has no binding. Log/Activity footers keep `Space/f pause`.

## Risks / Trade-offs

- [Identity pin depends on stable object refs] → True for Log view in both process modes (single deduped ring). For Activity in the attached TUI, refs are fresh each poll, so D3 keeps numeric anchoring there; the >500-events-during-pause drift is the only residual imperfection and is an existing pre-condition (task would have had to produce 500+ events while the user paused).
- [Pinned entry rolls out of `recent(200)` while paused a long time] → Re-pin to oldest still-visible (`entries[0]`), keeping the screen still rather than snapping to newest; matches spec scenario.
- [Level filter / search-filter changed while paused moves the pinned entry out of the list] → Falls back to oldest still-visible of the newly filtered list (indexOf misses); low-risk, consistent with re-pin fallback.
- [Direction semantics of `scrollLogs` preserved] → Keep the existing `currentStart - dir` formula; the rework only changes *how* `start` is derived (pinned entry), never the key mapping or direction.

## Migration Plan

Single-file behavioral change inside `src/observability/terminal-dashboard.ts` with regression tests in `tests/terminal-dashboard.test.ts`. No config, data, or API changes; the opened `CONTEXT.md`/ADR drafts and this change's specs archive normally.

## Open Questions

None — the three grill questions (scope = Logs + Activity, freeze-on-pause semantics, overview help-text cleanup) were answered "按推荐的" (adopt recommendations) on TAS-37.
