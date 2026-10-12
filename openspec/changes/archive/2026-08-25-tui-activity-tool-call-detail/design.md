## Context

The TUI activity view (TAS-17/20) captures opencode's stdout event stream into an in-memory `ActivityStore` ring buffer and renders it (ADR 0012). Today `parseOpencodeLine` keeps only `type`/`text`/`tool`/`tokens` from each event, so a `tool_use` event loses everything in `part.state` — the command/arguments, stdout, exit code, friendly summary, duration. The activity list therefore shows only the tool name, and the Enter-expand overlay has no text to show.

Verified against real `opencode 1.18.23 --format json`: each tool call emits a single `tool_use` event whose `part.state` carries `status`, `input` (arguments object, e.g. bash `command`), `output` (stdout), `metadata` (`exit`, `truncated`), `title` (a ready-made friendly summary), and `time` (`start`/`end`). Even failed commands report `status: "completed"` — `metadata.exit` (e.g. 127) is the reliable failure signal.

## Goals / Non-Goals

**Goals:**
- Capture the full tool execution detail into the shared `ActivityEvent` model, surfaced identically by the TUI and `GET /api/v1/<id>/activity`.
- Activity list shows a one-line friendly summary per tool call (`🔧 <tool> · <summary>`).
- Enter-expand shows a structured, scrollable detail block: status/exit (failures highlighted), tool, arguments, output, duration.
- Cap large outputs in the detail view with a truncation marker.

**Non-Goals:**
- Raw-JSON detail view (rejected in grill, option A chosen).
- Enhancing `step_start`/`step_finish` lines (grill Q5 — out of scope).
- Persisting activity beyond the in-memory ring buffer (ADR 0012 stands).
- True-live streaming or server-model migration (ADR 0012 Option B).

## Decisions

**D1 — Extend the flat event model with optional fields, no nested wrapper.**
`OpencodeEvent` and `ActivityEvent` gain optional `title?`, `input?`, `output?`, `exit?`, `status?`, `durationMs?`. The existing fields (`type`/`text`/`tool`/`tokens`) are untouched and every new field is optional, so old producers/consumers and the HTTP payload stay backward compatible — the API just gains optional keys. Chose flat fields over a nested `toolDetail` object because the event already is a flat shape and the renderers read individual fields; a wrapper adds nesting without buying anything.
_Considered:_ nested `state` passthrough (kept in the ADR as the "raw JSON" alternative — rejected for rendering, and re-emitting the whole raw part would leak opencode internals into the shared model).

**D2 — Capture in `parseOpencodeLine` from `part.state`, single place.**
The extraction of `title`/`input`/`output`/`exit`/`status`/`durationMs` happens once in `parseOpencodeLine` when `type === "tool_use"` and `part.state` is an object; `part.state.metadata` (when object) supplies `exit` and `truncated`; `part.state.time` (when object) supplies `start`/`end` → `durationMs`. Missing pieces degrade gracefully (no state → just the tool name, as today). No re-parsing anywhere else; the worker's `onOpencodeEvent` passthrough needs only to copy the new fields.

**D3 — List summary = opencode `title`, failure marker.**
`formatActivity` renders a tool call as `🔧 <tool> · <summary>`, where `<summary>` is `title` when present, else a shallow derive from `input` (bash `command`, write/read `filePath`), else the tool name; wrapped to the terminal width via existing `wrapToWidth`/`truncateToWidth` (CJK-safe). When `exit` is non-zero, the line is rendered `✗ <tool> · <summary>` in a warning color so failures are scannable without expanding.
_Considered:_ showing only the tool name (today) — rejected; the whole point is to show what ran.

**D4 — Detail overlay reuses the existing scrollable body.**
`getActivityDetailBody` gains a tool-call branch that builds a structured `string[]` block — header fields (Status/exit, Tool, Duration) then an arguments section (bash `command` verbatim; otherwise pretty-printed JSON) then an output section — and feeds the existing `activity-detail` overlay, which already supports `↑/↓` scrolling over `body` lines. Non-tool events keep the current text rendering.

**D5 — Output display cap = tail 100 lines + truncation markers.**
In the detail body, when the output exceeds 100 lines, render only the last 100 with a leading `… (N more lines)`. When opencode itself truncated (`metadata.truncated`), append `… (opencode truncated)`. The ring buffer keeps the output as opencode provided it (opencode already bounds it); only display is capped. This matches the grill Q3 recommendation (tail + marker).

## Risks / Trade-offs

- **Ring-buffer memory growth** from storing `output`/`input` text → bounded by the existing 500-event-per-task cap and opencode's own truncation; no unbounded field is added. If a future task shows this is too heavy, cap stored output length at record time (display already capped).
- **`input`/`output` shape variance across tools** (bash `command` vs write `filePath`+`content` vs opaque args) → rendering is defensive: `title` first, `command` second, `filePath` third, JSON pretty-print fallback; never throw on unknown shapes.
- **Wider events flow to HTTP API** → additive only; the observability test asserting the old minimal shape is updated to assert the enriched fields.
- **`truncated` flag absent for older opencode** → renderer treats missing flag as "not truncated"; no crash.

## Migration Plan

Single in-repo change; no data migration (in-memory only). Deploy by normal `main` merge; rollback is reverting the feature branch. `docs/{usage,architecture}.md` (zh/en) and the archived `openspec/specs/{task-activity,activity-text-expand}.md` sync after merge per repo convention.

## Open Questions

None — all five grill decisions answered ("按推荐的来").
