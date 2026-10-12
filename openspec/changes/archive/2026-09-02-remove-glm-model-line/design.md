## Context

`WORKFLOW.md` is the workflow configuration file (YAML frontmatter + Liquid prompt body) that the `tasking` daemon consumes. Its `opencode:` block documents optional `model` configuration with two commented-out example lines plus one active `model: opencode-go/deepseek-v4-flash` line. The commented-out `alibaba-token-plan-cn/glm-5.2` example is to be removed.

## Goals / Non-Goals

**Goals:**
- Remove the single commented-out line `# model: alibaba-token-plan-cn/glm-5.2` from `WORKFLOW.md`.
- Leave the rest of the config block (including the active `model` line and the other commented example) unchanged.

**Non-Goals:**
- No change to any runtime code, schema, defaults, or other workflow template files.

## Decisions

- **Delete the line, keep the surrounding block intact.** The line is a pure comment in YAML frontmatter; removing it has no runtime effect. No behavioral decision required.
- **Only touch `WORKFLOW.md`** (not the `.example` templates), matching the task's literal scope.

## Risks / Trade-offs

No risks: the removed line is commented out and carries no runtime meaning. The remaining active `model` configuration is unaffected.
