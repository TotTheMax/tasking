# Token Accounting Rules

> Adapts tasking's `opencode run --format json` event model.

## Basic Principles

tasking parses the event stream from `opencode run --format json` stdout and extracts token usage.

### Event Types and Token Sources

| Event type | Token field | Purpose |
|---|---|---|
| `step_finish` | `part.tokens.{input, output, total}` | Token usage for each step |

`step_finish` reports per-request usage where `total = input + output + reasoning + cache.read + cache.write`; each request re-reads the whole conversation context, so `total` grows monotonically. tasking intentionally sums these raw `total` values for cost accounting (cache reads are billable) — see ADR 0013.

### Live Accumulation via `step_usage`

The worker emits a `step_usage` worker event for every parsed `step_finish` that carries tokens. The scheduler accumulates each `step_usage` into the running entry immediately, so per-task tokens update **during** a turn (not only at turn boundaries). `turn_completed` no longer carries `usage`, so a turn's tokens are counted exactly once — the sum of its `step_usage` events equals the per-turn `extractSessionAndUsage` total.

### Session Persistence

Cumulative tokens are written to the workspace `.tasking-session.json` sidecar (next to `session_id`/`turn_count`) after each turn. On dispatch the scheduler restores them into the fresh running entry, so retries and daemon restarts keep the session-lifetime token count instead of resetting to zero. Old sidecars without token fields restore as zero.

### Aggregated Totals

- **Running entry**: `entry.input_tokens`/`output_tokens`/`total_tokens` — accumulated live from `step_usage`, restored from the sidecar on dispatch, for snapshot display
- **Global totals**: `state.totals.*` — accumulated from `AttemptResult.usage` when the worker exits

### Differences from Symphony

Symphony extracts multiple token payloads from the Codex app-server event stream (`thread/tokenUsage/updated`, `turn/completed` usage, `codex/event/token_count`), and distinguishes between absolute values (`total_token_usage`) and deltas (`last_token_usage`). tasking uses the one-shot stdout of `opencode run`, where only the `step_finish` event carries tokens, making the model simpler: every `step_finish` token report is treated as a delta and accumulated.