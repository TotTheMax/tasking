# AGENTS.md

Guidance for coding agents working in this repo.

## What this is

`tasking` is a TypeScript CLI daemon that orchestrates [opencode](https://opencode.ai) coding-agent work from two task sources that converge on a shared normalized `Task` model, a shared per-task workspace manager, and a shared `opencode run` worker:

- **Structured (Jira):** a deterministic poll → dispatch → reconcile → retry scheduler. No LLM in the hot loop.
- **Unstructured (Feishu v1 IM):** a polling comment bridge that turns Feishu threads/messages into Jira issues and mirrors comments bidirectionally.

The user-facing surface is a single binary, `tasking <subcommand>`, driven by a `WORKFLOW.md` (YAML config frontmatter + Liquid prompt body). Read `CONTEXT.md` for the project's ubiquitous-language glossary before naming new terms.

## Commands (the gate)

Run in this order and make all three pass before considering work done. CI (`.github/workflows/ci.yml`) runs the same gates on every PR and push to `main`; pushing a `v*` tag triggers `.github/workflows/release.yml`, which publishes to npm via OIDC trusted publishing (no token).

- **Lint:** `npm run lint` (auto-fix: `npm run lint:fix`; format: `npm run format`)
- **Typecheck:** `npm run typecheck`
- **Tests:** `npm test` (watch: `npm run test:watch`; one file: `npm test -- tests/scheduler.test.ts`; one name: `npx vitest run -t "name"`)
- **Build:** `npm run build` (`tsc` → `dist/`)
- **Dev run:** `npm run dev -- start` (CLI via `tsx`)

Requires Node 22+. When touching a subsystem, also run that subsystem's test file (see the routing map below) — the full suite is ~21k lines of tests and a targeted run catches regressions faster.

## E2E integration tests (mandatory gates)

The repo has two end-to-end suites that exercise cross-component flows mocks and unit tests cannot cover. Run them per the policy below before considering work done:

| Suite | Command | When to run |
|---|---|---|
| Mock-driven E2E (hard gate) | `npm run test:e2e` (`tests/e2e.test.ts` scheduler flow + `tests/bridge-flow.test.ts` Feishu↔Jira bridge + `tests/trackerless.test.ts`) | **Must run** after any change to Feishu adapter, Jira adapter, scheduler, or the Feishu↔Jira comment bridge. Already enforced by `npm test`. |
| Real API integration | `npm run test:integration` (`INTEGRATION=1`, `tests/integration-real.test.ts`, real Feishu test bot/group + real Jira TEST project) | **Must run** for the same subsystem changes **whenever the live test environment is reachable** (local dev with intranet route). Credentials resolve from real env vars or the repo-root `.env` file (`cp .env.example .env`; no committed defaults — `INTEGRATION=1` fails fast listing missing keys). Skipped when the intranet route is unavailable; if unreachable, state the reason in the commit/PR. |
| Real event flow (semi-automated) | `npm run test:event-flow` (`INTEGRATION=1`, `tests/integration-event-flow.test.ts`) — verifies the WS event channel end-to-end; **you** send two messages in the intake group when prompted, all assertions are automated. Run after changing the Feishu adapter, event channel, or bridge ingress — and after machine switches/reinstalls as the acceptance check. Not an automated gate (requires a human + intranet). |

- If you add a new end-to-end test file, add it to the `test:e2e` script list in `package.json`.
- Other (non end-to-end-critical) subsystem changes: test as needed — run the routing-map unit tests below, plus the relevant E2E suite if the change affects end-to-end behavior.

## Card interaction rules (卡片交互规约)

Applies to any change touching Feishu cards/buttons (direct sessions or bridge).

- **回路测试**: card interactions are guarded by `tests/card-roundtrip.test.ts` (render → extract button value from the card JSON → dispatch via the real event-channel router → assert the user-visible outcome; see ADR 0025). Direct-call unit tests cover handler logic; a new button MUST also land in the round-trip suite.
- **三场景模板**: a spec requirement introducing a card with buttons MUST include scenarios for ①再点一次（去重窗口内重复点击）②换卡后再点（重新渲染/重走流程）③payload 缺字段（如 `operator.name` 为空）.
- **Fixture 先行**: a new platform interaction captures a real payload under `tests/fixtures/feishu/` (provenance: captured | documented) before mocks are written; unverified `documented` fixtures upgrade on first live contact.
- **真机冒烟（opt-in，非门禁）**: at change kickoff ask the user to pick a smoke cadence (per-slice / batched / final-only); default final-only; never a blocking gate.
- **回访路径**: every new interaction surface states its revisit path in design.md (常驻/召回/命令兜底) — glossary: CONTEXT.md.

## Routing map — where to go for a given intent

This is the primary navigation aid. Each row lists the file(s) to **read first**, the file(s) you'll most likely **edit**, and the **tests/docs that must stay green**.

| Intent | Start here (read) | Likely edit | Keep green |
|---|---|---|---|
| Add/rename/remove a CLI subcommand or flag | `src/cli/index.ts`, `src/cli/help.ts` | both; `README.md`, `docs/usage.md` | `tests/cli.test.ts`, `tests/cli-commands.test.ts` |
| Change polling/dispatch/eligibility/retry/backoff/reconcile (Jira path) | `src/scheduler/scheduler.ts` | same | `tests/scheduler.test.ts`, `tests/e2e.test.ts` |
| Change the opencode worker: spawn flags, turn loop, sessions, token accounting | `src/worker/runner.ts` | same; `src/shared/agent-resolver.ts` for per-task agent | `tests/worker.test.ts`, `tests/agent-resolver.test.ts` |
| Add a prompt template variable/filter or renderer behavior | `src/worker/prompt.ts` (strict Liquid — see Conventions) | same; `assets/workflows/WORKFLOW*.md.example` if templates change | `tests/prompt.test.ts` |
| Change workspace create/remove/hooks/session-sidecar/FS safety | `src/workspace/manager.ts` | same | `tests/workspace.test.ts` |
| Change Jira REST calls or state helpers | `src/adapters/jira/tracker.ts` (`isActiveState`/`isTerminalState`/`isApiV3` live here) | same | `tests/jira-tracker.test.ts`, `tests/jira-tracker-http.test.ts`, `tests/jira-tracker-comments.test.ts`, `tests/bridge-flow.test.ts`, `tests/e2e.test.ts` |
| Change Feishu REST calls | `src/adapters/feishu/source.ts` | same | `tests/feishu-source.test.ts` (mock in `tests/helpers/feishu-mock.ts`), `tests/bridge-flow.test.ts` |
| Change Feishu↔Jira comment bridging or slash commands (`/issue`, `/state`, `/agent`) | `src/bridge/comment-bridge.ts`, `src/bridge/commands.ts` | same; `src/bridge/binding-store.ts` for cursor/state | `tests/comment-bridge.test.ts`, `tests/commands.test.ts`, `tests/bridge-flow.test.ts`, `tests/binding-store.test.ts` |
| Change config schema, defaults, env resolution, validation | `src/config/config-types.ts` (`DEFAULTS` lives here), `src/config/resolver.ts`, `src/config/validator.ts` | same; `docs/configuration.md` | `tests/config.test.ts`, `tests/daemon-config.test.ts` |
| Change the Jira MCP server or its injection into workspaces | `src/mcp/jira-server.ts`, `src/mcp/inject.ts` | same | `tests/mcp.test.ts` |
| Change dashboards / HTTP API / TUI / logging | `src/observability/*` (`http-dashboard.ts` serves `/api/v1/*`, `terminal-dashboard.ts` is the TUI) | same | `tests/observability.test.ts`, `tests/terminal-dashboard.test.ts`, `tests/activity-store.test.ts`, `tests/config-view.test.ts`, `tests/log-buffer.test.ts` |
| Change `init` / `--update` / `--restore`, shipped skills, or starter templates | `src/cli/init.ts`, `src/cli/prompts.ts`, `assets/skills/` (canonical), `assets/workflows/WORKFLOW*.md.example` | same | `tests/init.test.ts`, `tests/skills.test.ts` |
| Change daemon wiring/composition (scheduler + bridge + dashboard + TUI) | `src/cli/index.ts` `runStart()` | same; `src/cli/daemon.ts` for tick loop | `tests/cli.test.ts`, `tests/regression.test.ts` |

Notes that prevent wrong turns:

- The real subcommands are `init | start | status | logs | stop | tui | doctor` (plus `help`). There is **no `triage` subcommand** — the LLM route-agent/inbox triage path is unimplemented (README/docs now label it as such); the Feishu intake path is `CommentBridge.discoverIntake` / `executeIssue` in `src/bridge/comment-bridge.ts`.
- `router.*` config exists (`src/config/resolver.ts`) but there is **no `src/router/` code** — the route-agent concept is not implemented as a runtime component (docs/templates mark it not-implemented/reserved).
- HTTP dashboard endpoints live in `src/observability/http-dashboard.ts` (`/api/v1/state`, `/api/v1/config`, `/api/v1/logs`, `/api/v1/<task>/activity`); `tasking status`/`tui` are HTTP clients of them, not direct readers of scheduler state.

## Runtime flow (how a task actually runs)

**Jira path:** `tasking start` → `Daemon` tick loop (`src/cli/daemon.ts`) → `Scheduler.tick` (`src/scheduler/scheduler.ts`): reconcile running issues → fetch candidates → `sortForDispatch` → `isDispatchEligible` + slot checks → `dispatch` → `runAttempt` (`src/worker/runner.ts`) → `createWorkspace` (`src/workspace/manager.ts`) → `injectMcpConfig` → `runHook(before_run)` → loop turns: `renderPrompt`/`buildContinuationGuidance` (`src/worker/prompt.ts`) → spawn `opencode run --dir <workspace> --agent <a> --format json` → parse events/session/usage → exit → retry with exponential backoff or continuation.

**Feishu path:** `CommentBridge` (`src/bridge/comment-bridge.ts`, own timer) per tick: `syncBinding` (Jira comments → Feishu thread, Feishu thread → Jira comments, with sentinel dedup) and `discoverIntake` (root messages in the intake group → `/issue` creation via `JiraTracker.createIssue`). Bindings/cursors are durable in `bindings.db` (`src/bridge/binding-store.ts`).

## Source layout (mirrors capabilities)

```
src/
  cli/           subcommand dispatch + wiring, Daemon tick loop, init, TUI/status clients, help (single source)
  config/        schema + DEFAULTS (config-types.ts), YAML load, resolve, validate, hot-reload manager
  adapters/
    jira/        tracker.ts: Jira REST client + state helpers; source of Task model
    feishu/      source.ts: Feishu REST client (polled v1)
  bridge/        comment-bridge.ts (bidirectional mirror + intake), commands.ts (slash-command parsing/strings), binding-store.ts (SQLite cursors)
  scheduler/     scheduler.ts: in-memory orchestration (dispatch/retry/reconcile)
  worker/        runner.ts: opencode subprocess + turn loop; prompt.ts: strict Liquid renderer
  workspace/     manager.ts: create/remove/hooks/sidecar + FS-safety invariants
  mcp/           jira-server.ts (JSON-RPC stdio server) + inject.ts (per-workspace .opencode/opencode.json)
  observability/ logger, log ring buffer, ActivityStore, terminal + HTTP dashboards, config view, snapshots
  shared/        types.ts (Task/state model), errors.ts (TaskingError categories), agent-resolver.ts
```

## Conventions (non-negotiable)

- **ESM + NodeNext:** relative imports MUST use the `.js` extension (e.g. `import { Daemon } from "./daemon.js"`), even though sources are `.ts`. Forgetting this is the most common typecheck failure.
- **Strict TypeScript**, plus `noUncheckedIndexedAccess` (indexed access returns `T | undefined` and must be narrowed) and `noImplicitOverride`. `noPropertyAccessFromIndexSignature` and `exactOptionalPropertyTypes` are off.
- Biome enforces style: double quotes, semicolons, trailing commas, 100-col.
- Tests via vitest under `tests/` or co-located `src/**/*.test.ts`; HTTP tests use `tests/helpers/mock-http-server.ts`. Test timeout is 15s.
- **opencode v2 字段纪律（Fixture 先行）**: any test mock that feeds opencode v2 JSON MUST build its response through `tests/helpers/opencode-fixtures.ts`, which clones the captured payloads under `tests/fixtures/opencode-v2/rest/` (provenance: captured) and patches only values. NEVER hand-roll a v2 payload shape — hand-written shapes drift to v1 field names (`tool`/`state.output`/`state.time`/array `session.active`) and hide field-read bugs, because the code and the mock then share the same wrong assumption. When adding or changing any v2 field read, first capture the real payload (see `tests/fixtures/opencode-v2/provenance.md` for the recipe), add it to `rest/`, then write a fixture-derived test.
- The `WORKFLOW.md` prompt body is strict Liquid-compatible: unknown variables/filters fail rendering. Keep `tests/prompt.test.ts` green when touching templating.
- No code comments unless explicitly requested.

## State, safety, and trust invariants

- **Scheduler state is in-memory.** Restarting the daemon re-polls the tracker; do not assume scheduling/attempt state survives a restart. The Feishu bindings are durable SQLite (`bindings.db` via `better-sqlite3`, a native module that rebuilds on `npm install`).
- **Three filesystem safety invariants** — preserve in any workspace/scheduler change: (1) agent cwd == workspace path; (2) workspace path under root; (3) sanitized workspace keys (`[A-Za-z0-9._-]`). See the Safety posture section of `README.md`.
- **Trust boundary:** hooks run arbitrary `bash -lc`; the orchestrator performs no tracker writes; API tokens are never logged. Keep the MCP injection intact when editing worker/workspace setup — `buildMcpConfig`/`injectMcpConfig` seed the per-task `.opencode/opencode.json` that the agent's Jira access depends on.

## Runtime artifacts (gitignored, never commit / hand-edit)

`tasking.log`, `tasking_workspaces/`, `.tasking/`, `bindings.db`, `*.sqlite[-journal]`, `.tasking-session.json`, `.opencode/opencode.json`.

## Docs, specs, and decisions

- **Docs are bilingual** — every page under `docs/zh/` must have a matching slug under `docs/en/` (and vice versa). `tests/docs-links.test.ts` enforces parity + link integrity. When modifying the config schema, commands, or architecture, keep `docs/{configuration,usage,architecture}.md` (both locales) in sync; verify doc defaults against `DEFAULTS` in `src/config/config-types.ts` and command examples against `package.json`.
- **Architectural decisions** go in `docs/adr/` (numbered, e.g. `0001-phase-routing-in-prompt.md`). Record tradeoffs, not just outcomes.
- **Changes go through OpenSpec:** proposals/designs live under `openspec/changes/` (`openspec/changes/<change>/proposal.md|design.md|tasks.md|specs/`); archived ones under `openspec/changes/archive/`. The repo's own `.opencode/skills/opsx-*` and `.opencode/commands/opsx-*.md` drive this workflow; `assets/skills/` is the canonical shipped-skill source that `tasking init` copies from.
