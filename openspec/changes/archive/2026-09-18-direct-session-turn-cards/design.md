## Context

Direct sessions (`docs/adr/0022`, `docs/adr/0023`) run one `opencode run --format json` subprocess per turn and deliver results as text. Their `detailed` verbosity mirrors each `tool_use` event as its own text message built from `evt.title` alone (`src/direct/manager.ts:524-527`). Measured behaviour: ~11 messages for a 5-tool turn, no tool name, no command/output, `🔧 ` when the title is an empty string, and silent drops while the adapter is in 429 cooldown.

Everything needed for a better view already exists: `parseOpencodeLine` (`src/worker/runner.ts:280`) captures `tool`/`title`/`input`/`output`/`status`/`exit`/`durationMs`/`truncated`, the manager already writes them to `ActivityStore`, and the TUI renders them (`buildToolDetailBody`, `src/observability/terminal-dashboard.ts:1453`). A spike against the real test group validated an interactive card as the delivery medium and measured the platform facts below — they are constraints, not assumptions:

- A card is capped at **30 KB**, and updating one resends the whole card (`PATCH /im/v1/messages/:id`).
- Single-message update rate limit is **5 QPS**; group sends are **5 QPS** (shared across bots).
- A `PATCH`-updated card, a new card, and any new message **inside a thread** produce **no push notification**; a **new group-level message** does. (Spike caveat: measured with a bot-created root, whereas real sessions have a user-sent `/chat` root and the client opens a session window for the thread — real-world observation says existing direct/Jira replies do notify. No `@` is added; this is revisited only if long turns prove silent in practice.)
- Card-action callbacks (`card.action.trigger`) must be answered **within 3 seconds**, and over the long connection the SDK sends the handler's **return value** as that response (`WSClient.handleEventData`, SDK `lib/index.js:102539-102553`), so returning a card *is* the update.
- Callback response fields: `{ toast: { type, content }, card: { type: "raw", data } }`; card JSON version must not change across an update (2.0 → 2.0); a button `value` must be an **object**; callback interactions are valid 30 days and card updates 14 days.
- Collapsible panels render as a "please upgrade" placeholder below Feishu client **V7.9**.

## Goals / Non-Goals

**Goals:**

- One legible, low-noise Feishu surface per turn: one card that evolves in place, with full tool detail behind collapsible panels and the turn's final answer still delivered as text.
- Control from the message itself: interrupt / retry / full output / end, without typing slash commands, safe against mis-clicks and stale cards.
- No configuration change and no behaviour change for deployments that do not opt into `verbosity: detailed`.
- Every degraded path ends with the user seeing *something* explaining what happened.

**Non-Goals:**

- Interactive **permission approval** (needs the `opencode serve --attach` drawer from ADR 0023; `ask` keeps auto-rejecting and the card reports it).
- A per-session (single, long-lived) card — rejected, see Decisions.
- `@`-mention notifications.
- Any TUI change, any change to the Jira path or scheduler, any new config key, any change to `/chat` argument parsing or the commands' trust model.
- Streaming the assistant text token-by-token: `opencode run --format json` emits one complete `text` event per step (verified), so there is nothing incremental to render.

## Decisions

### 1. The unit is the turn, not the session

Each turn gets its own card. It is created at turn start (before slot/directory acquisition, so it always provides immediate feedback — it is also the ACK that replaces the "✅ 会话已创建" and "⏳ 已排队" texts), PATCHed while the turn runs, and **sealed** when the next turn starts. The session-state header (name, status, cumulative turns/tokens, queue depth) is repeated on each card, so the newest card always carries the current state.

*Rejected — one card per session:* (a) the 30 KB cap plus whole-card updates forces cross-turn trimming of history; (b) a thread is chronological, so a card posted at session start drifts to the top and gets buried under every later completion message, while a card-per-turn always sits next to the newest content. The cost accepted instead: a session with N turns has N cards in the thread, and each new turn costs one extra PATCH to seal its predecessor.

### 2. Card JSON: 2.0, one nesting level, per-tool panels

```jsonc
{
  "schema": "2.0",
  "config": { "update_multi": true },          // required for PATCH updates
  "header": { "template": "blue|green|orange|red",
              "title": { "tag": "plain_text", "content": "📁 <name> · <status> · <turns> turns · ≈<tokens> · 队列 <n>" } },
  "body": { "elements": [
    { "tag": "markdown", "content": "**Turn 5** · ✅ 完成 · 42s · 🔧 5 · ≈8.4k" },   // divider line, not a nested panel
    { "tag": "markdown", "content": "💬 <assistant text, truncated>" },
    { "tag": "collapsible_panel", "expanded": false, "header": { "title": <md "🔧 bash · find …"> },
      "elements": [ <md "Status/Tool/Command|Args/Output"> ] },
    { "tag": "button", … }                                                                  // control row
  ] }
}
```

A turn is a markdown divider line plus that turn's panels — **one** collapsible level only, because Feishu advises against nested panels (they compress badly). The button row is the last element so sealing is a single-element swap.

### 3. Panel content and the within-turn budget

Per panel: `Status: ✅ completed (exit 0) · 214ms` / `Tool: bash` / `Command:` (or `Args:` as pretty JSON) / `Output:` — **last 15 lines** with `… (N more lines)` — and `… (opencode truncated)` when opencode itself truncated. Failures (`exit !== 0` or an `error`) default to expanded with a red border; successes default to collapsed; the newest panel is **not** auto-expanded (a card that keeps growing and shifting is worse than one click).

The card working budget is **24 KB** (6 KB headroom for style-tag inflation). Approaching it degrades oldest-first in three steps: (1) oldest panels' output shortened to 3 lines, (2) oldest panels' output dropped, title line kept, (3) oldest panels replaced by one line — `… 还有 N 个工具调用未展示（完整明细见 TUI 活动视图）`. Cross-turn trimming does not exist. Every update re-renders the whole card from the accumulated turn state, so degradation is deterministic and idempotent rather than incremental.

### 4. Update policy

Events accumulate into the turn state; a flush renders and PATCHes. Flushes are coalesced to **at most one per 1.5 s** (far below the 5 QPS single-message limit; the limit is not the constraint, visual stability is), and flush **immediately** on a terminal state (completed/failed/timed-out/interrupted), on `/stop`/`/done`, and on any failure event. A failed PATCH is retried once with backoff; a second failure only logs a WARN — the next flush self-heals.

### 5. Card actions ride the existing long connection on a fast path

`card.action.trigger` is registered on the same `EventDispatcher`/`WSClient` used for `im.message.receive_v1` (one more key, plus a normalizer in the thin adapter — ADR 0018's posture). The **SDK `Channel` module is rejected**: it bundles dedup, locking, queueing and card handling that would overlap `CommentBridge`/`DirectSessionManager` and move the architecture boundary.

Card actions **do not enter the message ingest queue** (a serial, single-consumer FIFO whose backlog can exceed the 3-second deadline). They are forwarded directly to `DirectSessionManager`, whose handler performs only fast in-memory state changes and returns `{ toast, card }`; slow work — deleting the opencode session, sending the completion text, uploading a file — is scheduled after the return.

Re-delivery is deduped with an in-memory LRU keyed `card:<message_id>:<open_id>:<action>`, TTL 10 minutes.

### 6. Buttons: control only, latest turn only, sealed away

Button `value` is an object: `{ action, root_id, turn }`.

| Button | Card it appears on | Behaviour |
|---|---|---|
| `⏹ 中断` | running turn only | abort; respond with the interrupted card (no PATCH race); if that turn is no longer running → toast only |
| `🔁 重试` | latest turn | re-runs the turn's prompt (`direct_sessions.last_prompt`), as a new turn whose header notes `🔁 重试自 Turn N` |
| `📄 完整输出` | latest turn | uploads the turn's full detail as a `.md` file attachment (see 7); history-only data is not retained, so it is not offered on older cards |
| `🛑 结束` | running + latest turn | two-step: the same card is returned with the button row replaced by `⚠️ 结束将删除该 opencode 会话（不可恢复）` + `[确认结束] [取消]`; confirming ends the session, returns the terminal card and (asynchronously) sends the text naming the operator |

Sealing (at the next turn start) removes the interactive row so old cards cannot mislead; the callback handler still guards on `value.turn` vs the session's current turn as a backstop (e.g. after a restart, when the predecessor was never sealed) and answers with a toast. `/stop` is immediate; `/done` is confirmed, because it is irreversible.

### 7. `📄 完整输出`: accumulator → file → text → pointer

The turn accumulator keeps each tool's **full** output (rendering uses only the tail), capped at **1 MB per turn**, dropping oldest tools' detail first and noting the omission. On click: build a `.md`, upload via `POST /im/v1/files`, send it as a file message in the thread. If upload fails (missing `im:resource`, oversize, network) the same content is sent as a long text message (truncated to ~140 KB of the 150 KB text limit) with a note; if even that will not fit, only a pointer to the TUI activity view is sent. Failures log a WARN.

### 8. Card failure falls back to the same accumulator

If the card cannot be created, or repeated PATCHes fail mid-turn, the turn switches to a **fallback mode in which the same flush emits coalesced text messages** instead of card updates — one message per flush, never back to one-per-tool. A WARN is logged and the turn continues; the completion text is unaffected.

### 9. State and recovery

`direct_sessions` gains two additive columns:

- `card_message_id` — the latest turn's card. Used to (a) seal it when the next turn starts, (b) finalize it on restart/expiry.
- `last_prompt` — the latest turn's prompt, for `🔁 重试`.

Finalization paths: daemon restart → `recover()` marks the session idle and PATCHes the card to `⚠️ 已中断（daemon 重启）` with only `[🔁 重试] [🛑 结束]`; typed `/stop` / `/done` (no callback response to piggyback on) PATCH the card explicitly; TTL expiry marks it `ℹ️ 已过期` and clears the buttons. A PATCH failure (recalled message, past 14 days) logs a WARN only.

The restart card is re-rendered from the persisted session row, **not** from the accumulated turn: a Feishu card update replaces the whole card, and the per-tool panels live only in the in-memory accumulator, so preserving them across a restart would require a shadow copy of the card state in the DB. That cost was rejected for a low-frequency event — the interruption is visible and retryable, and the panels remain available in the TUI activity view. (If pre-crash context ever becomes important, the alternatives are persisting the turn state, or moving card updates to the card-entity/streaming API which supports element-level updates.)

### 10. Config is untouched

`quiet` / `summary` (default) / `detailed` keep their names, and `summary` keeps its text-only behaviour, so a default deployment is unaffected. `detailed` becomes "card + completion text". The card is deliberately opt-in because the V7.9 collapsible-panel floor cannot be detected server-side. Coalescing interval (1.5 s), card budget (24 KB), output tail (15 lines) and per-turn full-detail cap (1 MB) are constants, not config keys — an unused knob costs validation, bilingual docs and drift reporting.

### 11. Test seams (agreed before writing tests)

Tests exercise public behaviour at these seams only; no private methods, no internal call-count assertions:

1. **`buildTurnCard(state)`** — pure renderer: structure, panel content, 15-line tail, failure expansion, budget degradation, button row per state (running / completed / sealed / confirm), object-shaped `value`.
2. **`DirectSessionManager`** public methods with injected `DirectFeishuPort` (recording fake) and injected `spawn` (scripted event stream): turn lifecycle → card create/update/seal, coalescing, fallback on card failure, `recover()` finalization, and card-action routing/guards/dedup (including that the handler returns before slow work).
3. **`FeishuSource`** against the mock HTTP server: request shapes for card reply/update, multipart upload, file message.
4. **`FeishuEventListener`** with an injected `clientFactory`: `card.action.trigger` is registered and the normalized callback reaches the forwarded handler.
5. **Mock-driven E2E**: the Feishu mock records card sends/updates and can replay a button click through the real wiring.

## Risks / Trade-offs

- **Feishu clients below V7.9 render panels as a placeholder** → unavoidable and undetectable server-side; mitigated by keeping the card opt-in (`detailed`) and documenting the floor.
- **Two one-time console steps** (`im:resource` scope, `card.action.trigger` callback subscription) block the real-API paths → both features degrade gracefully (text fallback / pointer) and every failure WARNs; the steps are batched into one version publish per app and recorded in the docs and ADR.
- **30 KB / 5 QPS / 14-day update window / 3-second callback deadline** → budgeted degradation, coalescing, and "finalize failure is a WARN, not an error"; no path depends on updating a card after 14 days.
- **Restart between turns leaves the predecessor card unsealed** (its buttons remain) → the `value.turn` guard answers with a toast and the card is re-sealed on the next turn.
- **A very large turn still needs degradation** (per-turn cards do not remove the 30 KB cap, only cross-turn accumulation) → the three-step oldest-first degrade plus the "N tools not shown" pointer.
- **Silent long turns**: if the completion text in a thread indeed never notifies in real use, a long turn will finish silently → accepted for now (real-usage observation says notifications arrive); `notify_mention` is a one-line follow-up.
- **Button behaviour cannot be automated** → mock-driven coverage of every action plus a documented human acceptance step; explicitly recorded in `test-guidance` so "untested buttons" is not mistaken for a CI gap.
- **Memory**: the accumulator holds one turn's full detail (≤ 1 MB) released at seal time; `ActivityStore` keeps its own bounded ring and is unchanged.

## Migration Plan

1. Ship the additive `direct_sessions` columns (`ALTER TABLE`, existing soft-migration pattern) — old rows read as `NULL` and simply have no card to seal/finalize.
2. Existing `verbosity: detailed` deployments switch to cards on upgrade; `summary`/`quiet` deployments and every other component are unaffected. Rollback is reverting the release (no destructive migration; the two columns are inert to old code).
3. Operators do the two console steps when they want `📄` and the buttons; until then the card renders and the features degrade with a visible explanation and a WARN.

## Open Questions

None outstanding — the granularity, notification, authorization, confirmation, fallback, budget, config and test seams were all decided during the design interview and are captured above and in ADR 0024.
