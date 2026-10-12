# Per-task agent selection via Jira label

The per-task opencode agent is selected from a Jira label namespace (`agent:<name>`) on the Task, resolved by the worker each turn from the refreshed Task, falling back to `opencode.agent`. Feishu's `/agent` command and `/issue --agent` mutate or set that same label, so there is exactly one source of truth for per-task agent selection across creation (req 4), poll-time selection (req 2), and mid-run switch (req 5).

Rejected alternatives: a Jira custom field (typed/validated, but requires Jira admin setup + a new fetched field — heavier onboarding, against the REST-polling/no-schema-change ethos); a workspace sidecar file for mid-run switch (immediate, but introduces a second source of truth that can disagree with the label and does not survive a workspace reset). The label reuses the already-normalized `Task.labels` and the existing per-turn Task refresh, needs no Jira schema change, and is consistent with `required_labels` and the feishu `/issue` label-setting path.

Consequences: a mid-run switch is not instant — it applies at the next turn boundary, not mid-turn (the in-flight `opencode run` finishes first). The agent label namespace must not collide with operational labels; `agent:` prefix reserves it. Unknown agent names (not in `opencode.agents`) fall back to the default with a warning rather than failing dispatch.
