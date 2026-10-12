---
status: accepted
---

# Tool call execution detail capture and friendly rendering

For TAS-24's complaint that the activity page shows only tool names (`bash`/`write`) and expanding shows nothing, we capture opencode's full `tool_use` execution detail into the `ActivityEvent` and render it friendly — a one-line summary in the list and structured detail on expand — rather than dumping raw JSON.

Verified against the real `opencode 1.18.23 --format json` stream: each tool call emits a single `tool_use` event whose `part.state` holds `status`, `input` (the arguments object, e.g. bash `command`, write `filePath`/`content`), `output` (stdout), `metadata` (with `exit` and `truncated`), `title` (a ready-made friendly summary, e.g. the bash command or file path), and `time` (`start`/`end`). Pre-TAS-24 the worker kept only the tool name and dropped the rest, so the expand overlay had no text to show. Note that even a failed command reports `status: "completed"` — the exit code (`metadata.exit`, e.g. 127) is the reliable failure signal, not the status string.

Alternatives rejected: rendering the raw event JSON (not user-friendly), and the TUI re-parsing opencode session data at render time (couples to opencode internals — see ADR 0012). The shared enriched `ActivityEvent` keeps the TUI activity view and the `/api/v1/<id>/activity` HTTP API consistent.

## Consequences

- The in-memory `ActivityEvent` gains optional tool-execution fields (`input`, `output`, `exit`, `title`, `status`, `duration`); the per-task ring buffer cap still bounds retained output text.
- Activity renderers (TUI list + detail overlay, HTTP API payload) share the same enriched event objects, so both surfaces show the same detail.
