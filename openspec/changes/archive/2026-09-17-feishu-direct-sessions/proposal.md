## Why

tasking today drives opencode only through the Jira path (issue → scheduler → disposable workspace → MR flow). Users increasingly want to talk to a coding agent directly from a Feishu group about a real repo they already have on disk — "看下这个报错", "跑下测试", "把这个 typo 修了" — where a cloned workspace, a tracker state machine, and an MR pipeline are pure overhead. TAS-41 adds a minimal-config "direct" mode: a Feishu thread becomes an opencode session running in a fixed, user-owned directory.

## What Changes

- New `/chat` command in the Feishu intake group that starts a direct session by configured project name (`feishu.direct.projects` map) or by absolute path; follow-up messages inside the created thread become continuation turns on the same opencode session (one thread ↔ one session).
- New `DirectSessionManager` component (sibling of `CommentBridge`): owns direct-session lifecycle — intake, turn queueing (never concurrent in one directory), subprocess execution, expiry — while reusing the worker's `runDefaultSubprocess`/event-parsing primitives; the Jira/scheduler path is untouched.
- Per-turn execution: each turn is one `opencode run --dir <fixed-dir> -s <session_id> --format json` subprocess; no workspace, no hooks, no MCP injection, no Liquid template (the user's message is the prompt; the target project's own `.opencode/` config governs the agent).
- Result delivery: immediate ACK on receipt, then one summary message per turn (final answer + one-line stats); `feishu.direct.verbosity: summary|detailed` optionally mirrors each tool call.
- Permission posture: governed by the target project's own opencode permission config (`ask` auto-rejects safely); tasking adds `feishu.direct.auto_approve` (default `false`), optionally overridden per project, which passes `--auto`.
- Lifecycle commands in-thread: `/done` (end session), `/stop` (interrupt current turn); idle TTL marks sessions expired (default 30d); state persists in a new `direct_sessions` table in `bindings.db`; the opencode session title is left to opencode's native content-based auto-titling.
- New `feishu.direct` config section (`projects`, `path_roots` whitelist, `auto_approve`, `verbosity`, `max_concurrent`, `idle_ttl_ms`, timeouts) resolved/validated with the existing config machinery; direct sessions and Jira dispatch have independent concurrency budgets.
- Docs: bilingual docs pages + config reference updates (docs parity test must stay green).

Not in scope (recorded as drawers, ADR 0023): `opencode serve`/`--attach` warm backend, interactive permission card buttons, streaming output.

## Capabilities

### New Capabilities
- `direct-sessions`: the direct-session lifecycle — `/chat` intake (project & path modes with `path_roots` guardrail), one-thread-one-session mapping, turn queueing and serialization per directory, per-turn subprocess execution, summary/verbosity delivery, `/done` `/stop` lifecycle, restart recovery, TTL expiry, independent concurrency budget.

### Modified Capabilities
- `comment-bridge`: root messages starting with `/chat` and thread messages under direct-session roots are handed off to `DirectSessionManager` instead of being treated as unknown commands / unbeknownst threads; the single-consumer ingest queue and intake cursor semantics are preserved.
- `workflow-config`: new `feishu.direct` config section (resolution, defaults, validation) added to the schema; `EffectiveConfig` grows `feishu.direct`.

## Impact

- **New code:** `src/direct/manager.ts` (DirectSessionManager), `src/direct/prompt.ts`-level summary rendering (or folded into manager), direct-session storage added to `src/bridge/binding-store.ts`.
- **Modified:** `src/config/config-types.ts` (+`DirectConfig`, DEFAULTS), `src/config/resolver.ts`, `src/config/validator.ts`, `src/bridge/comment-bridge.ts` (routing hooks only), `src/bridge/commands.ts` (`/chat` parsing + help text), `src/cli/index.ts` `runStart()` wiring, `src/observability/config-view.ts` (show direct config).
- **Reuse unchanged:** `FeishuSource`, `runDefaultSubprocess`/`parseOpencodeLine`, `ActivityStore` (keyed `direct:<root_id>`), `BindingStore` SQLite.
- **Tests:** new `tests/direct-sessions.test.ts` (+ binding-store/config coverage), extensions to `tests/bridge-flow.test.ts` (mock E2E with fake spawnRunner), new real-API integration test gated `INTEGRATION=1` running a real `opencode run` in a temp git repo; `npm run test:e2e` stays the hard gate.
- **Docs:** `docs/{zh,en}/configuration.md`, `docs/{zh,en}/usage.md` (+ architecture touch-ups); bilingual parity enforced by `tests/docs-links.test.ts`.
