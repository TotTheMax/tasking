## Why

The intake guard replies to a re-delivered `/chat` root with either "该直连会话已存在…" or "此直连会话已结束…". That branch is only reachable when the *same* root message is processed twice (the intake cursor lags behind the WS event path, so a Sweep re-lists an already-consumed root, and `discoverIntake` only feeds root messages). A fresh `/chat` always carries a new message id and creates a new session, so no user action can reach it.

The result seen in production: after ending a session, an apparently random "此直连会话已结束…" appears attached to an old topic, on one session but not another, depending purely on whether a re-delivery happened to land in the window.

## What Changes

- The guard keeps doing its job (no session re-created, no first turn re-run, no session_id overwrite) but stops replying: a re-delivered root is not a user action, so it gets no message. A debug log records the skip.
- The user-visible "session ended" notice remains the thread-level terminal hint, which fires when someone actually posts inside a finished topic.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `direct-sessions`: a re-delivered `/chat` root is skipped silently instead of replying with an exists/ended hint.

## Impact

- `src/direct/manager.ts`: `handleIntakeMessage`'s existing-session branch (both wording variants removed; debug log added).
