## Why

In the TUI Log view (full-screen, key `L`) and Activity view (per-task, key `a`), pressing `Space`/`f` shows the `[paused]` tag but the viewport keeps scrolling — new log lines / activity events keep appearing and push the old ones off the top. Pausing must freeze the screen on what was visible when paused.

## What Changes

- Pausing (via `Space`/`f`) in the Log view or Activity view anchors the viewport to the entry at the top of the visible window; newly arriving entries no longer shift the screen.
- When paused, the header count, `[paused]` tag, and footer scroll indicators continue to update; the visible entries do not move.
- Resuming (pressing `Space`/`f` again while paused) clears the anchor and returns to live-follow at the newest entry.
- Manual scrolling while paused stays stable too: the anchor is tracked by entry identity, so it does not drift as the log buffer's sliding `recent(200)` window advances (the prior `cd6842e` absolute-index approach only held below 200 buffered lines).
- The overview footer no longer advertises `Space pause` (Space has no action in overview mode); the accurate `Space/f pause` hints on the Log/Activity pages stay.

## Capabilities

### New Capabilities
<!-- none — the behavior is entirely inside the TUI, whose spec is terminal-dashboard -->

### Modified Capabilities
- `terminal-dashboard`: Pausing a TUI scrolling view (Log view, Activity view) freezes the visible entries and resume returns to live-follow; the overview footer stops advertising the inert `Space pause`.

## Impact

- `src/observability/terminal-dashboard.ts` — pause/anchor logic in `processKey`, `scrollLogs`, `formatLogs`, `formatActivity`, and related fields.
- `tests/terminal-dashboard.test.ts` — new regression tests; existing follow/pause tests must stay green.
- Glossary (`CONTEXT.md`) and ADR 0019 already drafted in phase 1.
