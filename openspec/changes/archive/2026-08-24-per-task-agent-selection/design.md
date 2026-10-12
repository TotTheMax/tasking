## Context

`tasking` dispatches every Jira task to the same opencode agent profile (`opencode.agent`, default `build`). `Task.labels` is already normalized (lowercased, trimmed) and carried on every Task; `buildOpencodeCommand` reads `config.opencode.agent` once and the worker's turn loop already refreshes the Task each turn via `trackerStateChecker`. Feishu commands (`/issue`, `/state`, `/help`) are parsed in `bridge/commands.ts` and handled in `comment-bridge.ts`; `/issue` already supports a `--type` override and sets `labels: required_labels` at creation. The JiraTracker has no label-mutation method today. See `docs/adr/0011-agent-selection-via-jira-label.md` for the architectural decision record.

## Goals / Non-Goals

**Goals:**
- An optional `opencode.agents` catalogue coexists with the `opencode.agent` default (default stays the fallback).
- A per-task agent, specified by a Jira `agent:<name>` label, is honoured at dispatch and re-resolved each turn so a mid-run switch is automatic.
- Feishu `/agent` lists the default + catalogue (and the task's current agent in a bound thread); `/agent <name>` switches a running task's agent.
- Feishu `/issue --agent <name>` tags a new issue with the agent label at creation.
- Unknown agents degrade gracefully (warn + fallback), never blocking dispatch.
- User-friendly command surface and a simple, single-mechanism architecture.

**Non-Goals:**
- Touching `router.agent` (unstructured Feishu triage) — out of scope.
- A new CLI `issue` subcommand — issue creation stays Feishu-only.
- Aborting the in-flight `opencode run` turn on a mid-run switch — switch applies at the next turn boundary.
- A Jira custom field or schema change — labels are the mechanism.

## Decisions

### D1 — Jira label `agent:<name>` is the single source of truth
The per-task agent lives on the Jira issue as a label in the reserved `agent:` namespace (confirmed by the operator: this Jira accepts colons in labels). Creation (`/issue --agent`), poll-time selection, and mid-run switch (`/agent <name>`) all mutate or read this same label, so there is exactly one source of truth. Rejected: a Jira custom field (typed but needs admin setup + a newly-fetched field — against the REST-polling/no-schema-change ethos); a workspace sidecar override for mid-run switch (immediate but a second source of truth that can disagree with the label and does not survive a workspace reset).

### D2 — Per-turn resolution in the worker, not the scheduler
The scheduler passes `config.opencode` into `runAttempt` unchanged; resolution happens inside the turn loop, where `currentTask` is already refreshed each turn by `trackerStateChecker`. This makes a mid-run switch take effect at the next turn boundary with no scheduler change, and keeps the scheduler (stateless dispatch) unaware of agents. A new pure function `resolveAgent(task, config)` in `src/shared/agent-resolver.ts` is shared by the worker (per-turn) and the bridge (`/agent` list shows the task's current agent), so both call sites agree.

### D3 — Next-turn-boundary switch semantics
`/agent <name>` updates the issue's agent label; the running worker picks it up when the current `opencode run` turn ends and the loop re-resolves from the refreshed Task. Aborting mid-turn would require SIGKILL-ing the subprocess and discarding partial work — complex and destructive. Next-turn-boundary is simple, non-destructive, and consistent with the single-source-of-truth model.

### D4 — Advisory catalogue, empty = no validation
`opencode.agents` is an optional string list. When non-empty it powers the `/agent` listing and produces a friendly warning for unknown names (still falling back to the default, never blocking dispatch). When empty/unset, validation is skipped entirely and any `agent:<name>` value passes through. `opencode.agent` is always the fallback. Rejected: a hard allow-list (would make a typo break dispatch — too brittle for an advisory field).

### D5 — Case handling via catalogue lookup
`normalizeLabels` lowercases all labels, so an `agent:Review` label arrives as `agent:review`. When the catalogue is non-empty, the resolver matches the label value case-insensitively against catalogue entries and uses the **catalogue's original casing** for the `--agent` flag (so a `Review` profile is invoked correctly). When the catalogue is empty, the lowercased label value is passed as-is (best-effort; documented as lowercase-only in that mode).

### D6 — Label mutation is read-modify-write
Jira `PUT /issue/<key>` with `{fields:{labels}}` replaces the **entire** labels array. To swap an agent label without clobbering operational/required labels, the bridge reads the issue's current labels (via the existing `fetchIssueStatesByIds`, which returns full Tasks with `labels`), removes any existing `agent:*` label, adds the new `agent:<name>`, and writes the full array back through a new `JiraTracker.updateIssue(key, fields)` method.

## Risks / Trade-offs

- **[Mid-run switch latency]** A switch is not instant: it applies at the next turn boundary, plus the bridge poll interval (`feishu.poll_interval_ms`, default 5s) and the Jira label round-trip. → Mitigation: documented in `/agent` reply text and `docs/usage.md`; acceptable for an interactive switch (turns are the dominant latency either way).
- **[Case sensitivity in catalogue-empty mode]** Without a catalogue, agent names from labels are effectively lowercase-only. → Mitigation: document; recommend populating the catalogue when using mixed-case profile names.
- **[`agent:` namespace collision]** A pre-existing operational label starting with `agent:` would be misread. → Mitigation: the `agent:` prefix is reserved and documented; the risk is theoretical for this project.
- **[Two agent labels on one issue]** If a human edits Jira and adds two `agent:*` labels, the resolver picks deterministically (the first match). → Mitigation: the `/agent <name>` command always removes existing `agent:*` before adding the new one; manual edits are an edge case documented as "last write wins is undefined, use the command".

## Migration Plan

No migration, no breaking change. When no `agent:` label is present and `opencode.agents` is unset, behaviour is identical to today (every task runs `opencode.agent`). The feature is opt-in per task via labels and per deployment via the optional catalogue. Rollback = remove the label / unset `opencode.agents`.

## Open Questions

None — all four grill decisions were resolved by the operator (see Jira TAS-14 comments 11735/11738/11739): `agent:<name>` syntax; next-turn-boundary switch; warn+fallback for unknown agents; advisory catalogue.
