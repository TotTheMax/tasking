## Why

Today every dispatched task runs the single opencode agent profile from `opencode.agent` (`build`) — there is no way to pick a different agent per task or to switch mid-run. As the agent catalogue grows (review, triage, specialist profiles), operators need to route individual Jira tasks to specific agents and to switch an in-flight task's agent from Feishu, without editing config or restarting the daemon.

## What Changes

- Add an optional, advisory `opencode.agents` catalogue alongside the existing `opencode.agent` default (which remains the fallback). Empty/unset catalogue = no validation.
- Introduce the `agent:<name>` Jira label namespace as the **single source of truth** for a task's per-task agent. The worker reads it from the refreshed Task each turn and falls back to the default.
- Feishu `/agent` command: with no args, lists the configured default + the catalogue (and, inside a bound thread, the task's currently resolved agent); with `/agent <name>` inside a bound thread, switches that task's agent label (takes effect at the next turn boundary).
- Feishu `/issue --agent <name>`: sets the `agent:<name>` label on the issue at creation time (parallel to the existing `--type` override).
- New `JiraTracker` label-mutation operation (read-modify-write) so `/agent <name>` can swap the agent label without clobbering other labels.
- Unknown agent names (not in a non-empty catalogue) warn and fall back to the default — they do not block dispatch.
- `router.agent` (unstructured Feishu triage) is explicitly out of scope.

## Capabilities

### New Capabilities
- `agent-selection`: per-task opencode agent selection — config catalogue, `agent:<name>` label convention, resolution rules with default fallback, Feishu `/agent` (list + mid-run switch) and `/issue --agent` commands, next-turn-boundary switch semantics.

### Modified Capabilities
- `opencode-worker`: the worker resolves the `--agent` flag per turn from the task's `agent:<name>` label (read off the refreshed Task), falling back to `opencode.agent`; a mid-run switch applies at the next turn boundary, not mid-turn.
- `jira-tracker`: adds a label-mutation operation to update an issue's labels (read-modify-write), used by the `/agent` switch command to swap the `agent:` label while preserving all other labels.

## Impact

- **Config**: `src/config/config-types.ts` (`OpencodeConfig.agents`, `DEFAULTS.opencode.agents`), `src/config/resolver.ts` (parse `agents` as a string list). Auto-surfaced by the config view; `docs/configuration.md` opencode block gets a new row.
- **Worker**: `src/worker/runner.ts` turn loop calls a new pure resolver each turn and passes the resolved agent into `buildOpencodeCommand`. New `src/shared/agent-resolver.ts` (shared pure function — used by both worker and bridge).
- **Bridge**: `src/bridge/commands.ts` (`parseAgent`, help text, `/agent` wiring) and `src/bridge/comment-bridge.ts` (handlers for list + switch; `/issue --agent` label injection in `executeIssue`).
- **Jira adapter**: `src/adapters/jira/tracker.ts` gains an `updateIssue`/label-update method.
- **Docs**: `docs/configuration.md`, `docs/usage.md` (new `/agent` + `/issue --agent` usage), `CONTEXT.md` (already drafted), `docs/adr/0011` (already drafted).
- No new dependencies; no schema migration; no breaking changes (default behaviour is unchanged when no `agent:` label and no `agents` catalogue are present).
