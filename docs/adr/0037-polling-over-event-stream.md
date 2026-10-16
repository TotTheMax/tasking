# Poll the v2 API instead of subscribing to the event stream

Progress, usage and terminal state are read by polling `session.get` / `session.permission.list` / `session.message.list`; tasking does not consume the v2 SSE event stream.

**Context.** v1 parsed `opencode run`'s stdout NDJSON. In v2 the equivalent live stream is `GET /api/event`, whose own contract is "volatile: a slow consumer overflows and fails the stream, and events during disconnection are missed" with no `since`/`seq` replay parameter; the `opencode api` CLI does not pump streaming responses. Polled messages carry terminal-state tool entries (`state.input`, `state.metadata.exit`, `state.time`) and per-message tokens — everything the turn cards, the TUI activity view and usage accounting need — as 2–3 second snapshots.

**Consequences.** Process visibility is batched (worst case ~1–1.5 s behind v1, whose UI surfaces already throttled at 1–1.5 s) and streaming text deltas are lost (cosmetic). In exchange every cycle is a full REST reconciliation: a dropped poll is corrected by the next one, and daemon restarts reconcile cleanly. Usage accounting changes: v2 reports `{input, output, reasoning, cache}` with no `total`; tasking sums `input + output + reasoning` (ADR supersedes the v1 `total`-based accounting).
