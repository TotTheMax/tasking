## Why

Direct-session lifecycle messages name the operator with a raw open_id (`操作人：ou_7ae9…`) because a Feishu card callback carries only the clicker's `open_id`, and the direct manager has nothing to resolve it to a human name. Verified: a raw id is what production shows today.

## What Changes

- The adapter gains `listChatMembers(chatId)`: the group-member list (`GET /im/v1/chats/:chat_id/members`, paginated), which returns each member's `name` without any field-scope requirement and with no contact-directory data scope.
- The direct manager caches an `open_id → name` map per chat (TTL 1h), warms it when a session starts, and resolves the operator label in the **deferred** work only — the card callback itself still answers immediately with the cached value (or the open_id) so the 3-second deadline is untouched.
- Resolution failure (not a member, fetch error, missing scope) falls back to the open_id exactly as today; nothing new can break the message.

Explicit non-goal: the contact directory API (`/contact/v3/users/:open_id`). It needs an interface scope **and** the clicker to fall inside the app's contact-data scope (often an admin-side configuration), and it exposes directory data — while the group-member list needs only that the bot is in the group, which is already true, and returns the names of exactly the people who can click.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `direct-sessions`: lifecycle messages (`/stop`, `/done`, interrupt announcement) resolve the operator's display name from the intake group's member list, falling back to the open_id.

## Impact

- `src/adapters/feishu/source.ts`: `listChatMembers` (+ pagination, `TaskingError` on failure).
- `src/direct/manager.ts`: optional `listChatMembers` on `DirectFeishuPort`, a per-chat name cache with TTL, and operator-label resolution moved into the deferred paths.
- Docs: `docs/{zh,en}/usage.md` (operator shown by name when resolvable).
