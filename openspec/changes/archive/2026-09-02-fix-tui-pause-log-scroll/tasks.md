# Implement TUI pause-freeze for Log & Activity views

## 1. Log view: pause freezes the viewport (primary bug)

- [x] 1.1 Add failing regression tests in `tests/terminal-dashboard.test.ts`: in Logs mode (`L`) with a populated `LogRingBuffer`, pressing `f` and pressing ` ` each show `[paused]`, and after pushing new lines while paused the new lines do NOT appear on screen (red before any fix).
- [x] 1.2 Implement Log-view pause-freeze: route `Space`/`f` through one `toggleLogFollow()` helper that, on pause from a live tail, pins the entry currently at the window top and, on resume, clears the pin and returns to follow; make `formatLogs` derive `start` from the pinned entry (follow → newest window) instead of treating a null anchor as follow. Confirm the 1.1 tests and existing Logs tests pass.
- [x] 1.3 Add a failing test that a paused Logs view stays stable after the `recent(200)` window rolls: fill the ring past 200 lines, pause, push more lines, and assert the paused screen still shows the pre-pause tail lines and NOT the newest arrivals.
- [x] 1.4 Make the Logs anchor drift-proof: locate the pinned top entry by identity each render; when it has rolled out of the available window, re-pin to the oldest still-visible entry so the view stays still rather than jumping to the tail. Confirm 1.3 plus the scroll (`j/k`) and search/jump tests stay green.
- [x] 1.5 Add a resume regression test: after pausing and letting new lines arrive, pressing `f`/` ` again resumes follow and shows the newest entries.

## 2. Activity view: pause freezes the viewport

- [x] 2.1 Add failing tests in `tests/terminal-dashboard.test.ts`: in Activity mode (`Enter` then `a`) with an `ActivityStore` that grows, pressing `f` (and ` `) shows `[paused]`, and new events recorded after the pause do NOT appear (red before any fix).
- [x] 2.2 Implement Activity-view pause-freeze: route `Space`/`f` through one `toggleActivityFollow()` helper that anchors `activityAnchoredStart` to the tail-top on pause; ensure `formatActivity` stops re-centering the cursor/start to the newest row while paused (only the follow branch re-centers). Confirm 2.1 and existing Activity tests pass.

## 3. Overview footer help text

- [x] 3.1 Add a failing test that the overview footer no longer contains `Space pause`.
- [x] 3.2 Remove ` · Space pause` from the overview footer hint in `formatOverview`; confirm the Logs/Activity footers still advertise `Space/f pause`. Verify 3.1 passes.

## 4. Cleanup

- [x] 4.1 Remove the never-read `logScrollOffset` field and its write sites introduced by the anchor rework.
- [x] 4.2 Confirm no remaining null-anchor-as-follow convention: when `logFollow`/`activityFollow` is false an anchor is always present, in both key handlers and renderers.

## 5. Gates

- [x] 5.1 Run `npm run lint`, `npm run typecheck`, and the targeted `npx vitest run tests/terminal-dashboard.test.ts`; fix any failures.
- [x] 5.2 Run the full `npm test` and confirm green.
