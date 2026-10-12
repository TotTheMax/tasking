## Why

`WORKFLOW.md` contains a commented-out example line `# model: alibaba-token-plan-cn/glm-5.2` in the opencode configuration block. This line is stale/undesired and the request is to remove it.

## What Changes

- Remove the commented-out line `# model: alibaba-token-plan-cn/glm-5.2` from the `opencode:` block of `WORKFLOW.md`.

## Capabilities

### New Capabilities
<!-- None -->

### Modified Capabilities
<!-- None — no spec-level requirement changes. This is a documentation/config-file edit only. -->

## Impact

- `WORKFLOW.md` (config template, not runtime code). No code, API, or dependency changes.
