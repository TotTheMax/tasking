## Why

TAS-14 introduced the optional `opencode.agents` catalog (the advisory list of known agent profiles that `/agent` surfaces and validates against), but none of the three workflow starter templates (`WORKFLOW.md.example`, `WORKFLOW.code-mr.md.example`, `WORKFLOW.grill-openspec.md.example`) document it. Users who run `tasking init` never see the available-agent config, so per-task agent selection is effectively invisible and under-configured.

## What Changes

- Add the `agents` field to the `opencode:` block of all three workflow starter templates, defaulting to `[]` (empty = no validation), with a comment explaining it is the advisory agent catalog surfaced by `/agent`.
- Keep `opencode.agent: build` as the documented fallback default, unchanged.
- No runtime code change: `DEFAULTS.opencode.agents` is already `[]` and the resolver already handles the empty catalog.

## Capabilities

### New Capabilities

- `workflow-template-agent-catalog`: the workflow starter templates expose the `agents` catalog field with a sensible default and explanatory comment, so the available-agent configuration is visible after `tasking init`.

### Modified Capabilities

- `agent-selection`: add a requirement that the workflow starter templates document the `opencode.agents` catalog (default empty, advisory, non-blocking), consistent with the existing agent-resolution behavior.

## Impact

- `WORKFLOW.md.example`, `WORKFLOW.code-mr.md.example`, `WORKFLOW.grill-openspec.md.example` — each gains `agents: []` in its `opencode:` block with a comment.
- `tests/prompt.test.ts` / `tests/init.test.ts` — template-content assertions extended to cover the new field.
- No `src/` runtime change; no schema change.
