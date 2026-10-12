## Why

Everything that steers a direct session today lives in `WORKFLOW.md` (agent/model, `auto_approve`) or in the opencode model's own defaults, and changing any of it during a conversation means leaving Feishu to edit a file. The thread already has commands (`/stop`, `/done`, `/help`) and card buttons; the same surface should carry per-session posture and context control.

## What Changes

- **Session settings layer**: `direct_sessions` gains per-session overrides (`agent_override`, `model_override`, `auto_approve_override`), resolved as **session override > project entry > global config**. Nothing is ever written to `WORKFLOW.md` or the target directory's `.opencode`.
- **`/auto [on|off|once|reset]`**: switch the permission posture for this session (`on` = sticky until reset/end, persisted; `once` = the next turn only, in memory). Takes effect at the next turn boundary. The card header shows the posture, and the latest turn card gains a `🔐 权限` button whose confirm row offers `[✅ 本会话放开] [⚡ 仅下一轮] [✖ 取消]` (enabling is confirmed, disabling is immediate).
- **`/agent <name>` and `/model <name>`** (and `... reset`): switch the agent/model for subsequent turns, shown in the card header when overridden.
- **`/new`**: start a fresh opencode session inside the same thread (context cleared, thread/directory kept); the previous opencode session is left on disk, not deleted.
- **`/status`**: reply with a small dashboard card (directory, session id, agent/model, permission posture, turns/tokens, queue depth, idle time).
- **Heartbeat**: while a turn runs, the card is flushed every ~5 s so the elapsed time keeps ticking instead of looking stuck.

Not in scope: the coarse posture here stays binary (auto on/off); per-action approve/deny needs the `opencode serve` drawer (ADR 0023).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `direct-sessions`: session-level overrides and their precedence, the `/auto` `/agent` `/model` `/new` `/status` commands, the permission button/confirm row, and the running-card heartbeat.

## Impact

- `src/bridge/binding-store.ts`: three additive columns + a patch surface.
- `src/direct/manager.ts`: command handling, override resolution in the command/turn build, the permission confirm row, the dashboard, and the heartbeat timer.
- `src/direct/card.ts`: header posture/agent markers, the `🔐 权限` button and its confirm row.
- Docs: `docs/{zh,en}/{configuration,usage}.md`.
