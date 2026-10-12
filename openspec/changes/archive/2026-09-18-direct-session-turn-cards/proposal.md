## Why

`feishu.direct.verbosity: detailed` currently mirrors **every** `tool_use` event as its own text message containing only `🔧 ${title}`. A normal turn therefore produces ~11 messages in the thread, shows neither the tool name nor the command/args/output, emits empty `🔧 ` lines when the title is an empty string, and can silently drop messages while the adapter is in its 429 cooldown. The data needed for a good view already exists (the opencode event stream carries `tool`/`input`/`output`/`status`/`exit`/`durationMs`, and the TUI already renders it), so this is a delivery problem, not a capture problem.

A spike in the real test group confirmed the target shape: one interactive card that is updated in place is legible on a phone, keeps full detail behind collapsible panels, and adds no messages. It also measured the platform constraints this design has to respect: 30 KB per card (every PATCH resends the whole card), 5 QPS per single-message update, a 3-second deadline on card-action callbacks whose response *is* the card update, and thread-internal messages/cards/updates producing no push notification.

## What Changes

- **One updatable interactive card per turn** replaces the per-event text mirror under `verbosity: detailed`. Created at turn start (it is also the ACK, replacing the "✅ 会话已创建" text), PATCHed live while the turn runs, and **sealed** at the next turn start (button row → one-line stats footer; panels/text/expand state preserved). One card + the existing turn completion text per turn.
- **Card content**: session-state header, per-tool collapsible panels (`status · tool · command|args · output tail · truncation · duration`; failures default-expanded with a red border, successes collapsed), the turn's assistant text, and a control-button row. A single nested level only (Feishu advises against nested collapsible panels).
- **Card actions (buttons)**: `⏹ 中断`, `🔁 重试` (latest turn; prompt persisted), `📄 完整输出` (latest turn; uploaded as a file attachment, degrading to long text then to a TUI pointer), `🛑 结束` (two-step confirm). Buttons coexist with the existing slash commands and are open to group members, matching the commands' trust model. Interactive **permission approval is out of scope** (it needs the `opencode serve --attach` drawer, see ADR 0023).
- **Card callbacks** (`card.action.trigger`) are received over the existing long-connection event channel and handled on an **independent fast path** — never behind the serial message ingest queue — answering within the 3-second deadline with `toast` + a new card; slow work (session deletion, result text) runs after the response. Re-delivered clicks are deduped.
- **Update policy**: coalesced to at most one PATCH per 1.5 s, with immediate flush on terminal/error/`/stop`/`/done`; one retry then self-heal on the next event.
- **Degradation**: card creation or repeated PATCH failure switches that turn to the same accumulator emitting coalesced text messages (never back to one-per-tool); `📄` upload failure degrades to a long text message, then to a pointer at the TUI activity view.
- **State**: `direct_sessions` gains `card_message_id` (seal at next turn start; finalize on restart/expiry) and `last_prompt` (retry), both additive migrations. Restarting the daemon finalizes a `running` turn's card as `⚠️ 已中断（daemon 重启）`, keeping its accumulated panels.
- **Config unchanged**: `verbosity` keeps its three values and defaults (`summary` stays the default; `detailed` = card + completion text), so the default deployment's behavior is unchanged. Coalescing interval, card budget and output tail are hardcoded.
- **Prerequisites (one-time console work, batched into a single version publish)**: the `im:resource` scope for file upload, and subscribing the `card.action.trigger` callback over the long connection — for both the production and the E2E test app. Features degrade gracefully until these exist.

Not breaking: no config key is added, renamed or removed; commands, defaults and the Jira path are untouched. The observable change is confined to `verbosity: detailed` deployments, whose delivery becomes the card.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `direct-sessions`: the `detailed` delivery becomes a per-turn card (creation/sealing/content/update policy/degradation), plus card-action buttons, `📄` full-output retrieval, the restart/expiry card finalization, and the two new `direct_sessions` columns.
- `feishu-source`: the send surface gains interactive cards (send + update) and file upload + file messages, alongside the existing text sends.
- `feishu-event-ingress`: a second inbound kind (`card.action.trigger`) on the same long-connection channel, handled on an independent fast path with its own normalization and dedup, outside the message ingest queue.
- `test-guidance`: card-action clicks cannot be synthesized, so button behavior is covered by mock-driven tests plus a documented human acceptance step.

## Impact

- `src/direct/manager.ts` — turn lifecycle, accumulation, coalescing, sealing, finalization; new card renderer module (e.g. `src/direct/card.ts`); `DirectFeishuPort` gains card/update/file methods.
- `src/adapters/feishu/source.ts` — `replyCardInThread` / `updateCard` (PATCH) / `uploadFile` (multipart) / file message send.
- `src/adapters/feishu/events.ts` — register `card.action.trigger`, normalize the callback, forward on a fast path.
- `src/cli/index.ts` — wiring the card-action handler into `DirectSessionManager` (bypassing the ingest queue).
- `src/bridge/binding-store.ts` — `card_message_id` / `last_prompt` columns + additive migration.
- Docs: `docs/{en,zh}/{configuration,architecture,usage}.md`; `CONTEXT.md` (Turn card / Sealing / Card action / Turn completion message); `docs/adr/0024-direct-session-turn-cards-and-card-actions.md`.
- Tests: card renderer and update-policy unit tests, card-action routing/guard/dedup tests, feishu adapter request-shape tests, event normalization tests, mock-driven E2E extension (mock records card updates and replays button clicks), real-API integration for send/PATCH/upload; `npm run test:e2e` and `npm run test:event-flow` gates.
- External prerequisites: `im:resource` scope and the `card.action.trigger` callback subscription (one-time console step per app).
