## Context

`handleCardAction` must return `{ toast, card }` within Feishu's 3-second callback deadline (ADR 0024), so it cannot do network I/O on the critical path. The operator label is only used by the **deferred** work (the interrupt/end text messages), which runs after the response.

Verified facts: the production bot already has the group-member scope (a live call returned `姜晓宇` for the very open_id in the production transcript); reading `name` from that endpoint needs no field scope; the endpoint is paginated (max 100/page) and excludes bots.

## Goals / Non-Goals

**Goals:** show a human name where we currently show an open_id; add no console configuration; never delay or break the card callback.

**Non-Goals:** the contact directory API; resolving names for non-members (impossible — only group members can click); storing names durably.

## Decisions

1. **Group-member list, not the contact API.** No new scope (already granted in production), no contact-data scope for the clicker, and the data surface is exactly the group the bot is already in.
2. **Cache per chat with a 1h TTL, warmed at session creation and refreshed lazily on a miss.** A group's membership changes rarely; a stale entry only matters for a renamed/added member, which the next miss fixes. Pagination walks the list until the open_id is found (bounded), caching everything it saw.
3. **Resolve inside the deferred work.** `handleCardAction` passes the raw action down; the deferred closures await `operatorLabel(action)` (cache hit = synchronous in effect, cache miss = one HTTP call off the deadline). The callback response never awaits a fetch.
4. **Fallback chain:** `operator.name` from the payload → cached member name → fresh fetch → the open_id. A failed fetch logs a debug and returns the open_id, so the existing behaviour is the floor.

## Risks / Trade-offs

- A very large group costs paginated fetches on a cache miss → bounded by the number of pages needed to find the clicker, and the cache makes the next click free.
- The name is the member's group display name, which can be an alias → accepted; it is what Feishu shows beside the message anyway.
- The member list is stale for up to 1h → a rename or a member who joined after the last fetch falls back to the open_id until the TTL.
