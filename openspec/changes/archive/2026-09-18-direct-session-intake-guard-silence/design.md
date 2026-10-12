## Context

`discoverIntake` iterates only root messages (`root_id === null`) from the durable intake cursor, while the WS event path consumes messages without advancing that cursor; a Sweep (start, reconnect, 12h) therefore re-lists roots the event path already handled. For a `/chat` root that already owns a session, the manager's guard hit its reply branch — with no user action behind it.

## Goals / Non-Goals

**Goals:** remove the timing-dependent noise without weakening the dedup guarantee.

**Non-Goals:** de-duplicating distinct `/chat` messages that point at the same directory (two sessions on one directory remain allowed, one thread each); changing the thread-level terminal hint.

## Decisions

1. **Silence, not a different message.** Any wording is noise here because the trigger is a re-delivery; the dedup behaviour (the reason the branch exists) is unchanged.
2. **Keep a debug log** so a re-delivery is still traceable when diagnosing cursor lag.
3. **Leave the thread-level terminal hint alone** — it is user-action-triggered, once per topic, and is the designed "this topic is finished" notice.

## Risks / Trade-offs

- If a `/chat` root is re-delivered while its session is still active, the user gets no "you already have a session" nudge → accepted: the session's own card is already in the thread, and a fresh `/chat` correctly starts a new session.
