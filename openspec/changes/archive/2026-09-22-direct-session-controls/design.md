## Context

Direct sessions already resolve their spawn command per turn (`buildDirectCommand` reads `opencode.agent/model/variant` and `resolveAutoApprove` reads the project entry then the global), and `handleThreadMessage` already owns the in-thread command surface. Card actions exist with a fast path and a 3-second deadline; the sealed/latest button states are established.

## Goals / Non-Goals

**Goals:** per-session control without touching files; every posture visible on the card; nothing destructive or surprising.

**Non-Goals:** per-action permission approval (needs `opencode serve`), a `/resume` of an abandoned session, cross-session settings, writing any config file.

## Decisions

1. **One settings layer, three overrides.** `agent_override` / `model_override` / `auto_approve_override` (the latter `"on"` or null) live on the `direct_sessions` row; `once` stays in memory (`rt.autoOnce`) because it is consumed by the next turn and losing it across a restart is the safe outcome. Resolution: session → project entry (`auto_approve` only) → global config.
2. **Turn-boundary effect.** Overrides are read when the turn's command is built, so a running turn is unaffected; every ACK says so.
3. **Visibility is the safety valve for sticky auto.** The card header carries the posture (`🔓 auto` / `⚡ 下轮放开`, and `🧠 <agent>` when the agent is overridden); `/auto` with no argument prints the posture *and its source*; `/done`'s card closure shows it too.
4. **Enabling is confirmed, disabling is immediate.** The `🔐 权限` button's confirm row offers `[✅ 本会话放开] [⚡ 仅下一轮] [✖ 取消]`; when the posture is already `on`/`once` the same button disables it at once (safe direction). The row is rendered through the callback response, so the header updates with no PATCH race. Buttons stay on the latest card only, matching retry/full.
5. **`/new` keeps the old opencode session.** The thread's `session_id` is replaced (and `last_prompt` cleared); the abandoned session stays on disk so nothing is destroyed implicitly, and the ACK says the context is fresh.
6. **`/status` replies with a card** built by the same markdown-card helper the turn result uses, so it renders like everything else.
7. **Heartbeat = 5 s, running only.** A timer owned by the running turn calls the existing flush; it is cleared at finalization. The card already computes `durationSec` from `turnStartedAt`, so this only makes it tick.

## Risks / Trade-offs

- Any group member can flip a session to `--auto`; mitigated by the confirm row, the header marker and `/auto` source reporting. The target project's `deny` rules still apply.
- A sticky override on a 30-day-idle session could linger; TTL expiry and `/done` close the session, and the card shows the posture throughout.
- `/new` orphans an opencode session on disk; accepted (no implicit deletion).
