## Context

TAS-14 introduced per-task agent selection. It added `opencode.agents` (an advisory catalog of known agent profiles) to the config schema (`src/config/config-types.ts`, default `[]`), the resolver (`src/config/resolver.ts`), the shared resolver (`src/shared/agent-resolver.ts`), and the Feishu `/agent` command (`src/bridge/comment-bridge.ts`). The docs (`docs/{zh,en}/configuration.md`, `usage.md`) already document the field.

However, none of the three workflow starter templates that `tasking init` writes (`WORKFLOW.md.example`, `WORKFLOW.code-mr.md.example`, `WORKFLOW.grill-openspec.md.example`) include `agents` in their `opencode:` block. The `src/cli/init.ts` `resolveExampleFile` maps each variant to one of these three files, and `generateWorkflowContent` renders them with sed substitutions. Because the field is missing, users configuring a fresh install never see how to declare available agents.

## Goals / Non-Goals

**Goals:**
- Add `agents: []` (with an explanatory comment) to the `opencode:` block of all three starter templates.
- Keep `opencode.agent: build` as the documented fallback default.
- Preserve the empty-catalog semantics: no validation, any `agent:<name>` passes through — consistent with `DEFAULTS.opencode.agents = []`.
- Extend template-content tests to assert the field is present.

**Non-Goals:**
- No runtime schema/code change (`src/` untouched).
- No change to agent-resolution behavior, `/agent` command, or the ADR-0011 contract.
- No change to the user-owned `WORKFLOW.md` in this repo (templates are the source `init` writes from; the active `WORKFLOW.md` here is a grill-openspec instance that already derives from the grill template).
- Not adding a non-empty default (would surprise users with validation they didn't opt into).

## Decisions

- **Add `agents: []` to all three templates.** Rationale: uniform, matches `DEFAULTS`, and gives every variant the same documented surface. Alternative considered — adding it only to `WORKFLOW.md.example` — rejected because all three variants share one config schema and the omission affects all of them equally.
- **Use `[]` as the literal default, not a concrete profile list.** Rationale: a non-empty default (e.g. `[build, review]`) would enable validation and warnings for users who never configured agents, changing behavior versus the shipped `DEFAULTS` empty array. Keep the catalog opt-in.
- **Place the field after `agent:` in the `opencode` block.** Rationale: reads naturally (default agent, then the catalog of alternatives) and mirrors the `docs/usage.md` example ordering.
- **Assert via existing template-content tests** (`tests/prompt.test.ts` / `tests/init.test.ts`) rather than new infrastructure. Rationale: the templates are already parsed and asserted there; a narrow additive assertion is the smallest seam.

## Risks / Trade-offs

- [Comment/text drift between the three templates] → assert the field is present in each template via a shared template-content test that iterates all three files, so any variant that omits it fails CI.
- [Users with an existing WORKFLOW.md won't get the new field] → `tasking init --update` reports new config fields via drift reporting; `init --force` regenerates from the template. This matches existing init behavior for schema additions (ADR-0011-style fields ship the same way).
