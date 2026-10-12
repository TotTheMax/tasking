[简体中文](./README.zh-CN.md) | English

# tasking

[![CI](https://github.com/TotTheMax/tasking/actions/workflows/ci.yml/badge.svg)](https://github.com/TotTheMax/tasking/actions/workflows/ci.yml)

A TypeScript CLI daemon that orchestrates [opencode](https://opencode.ai) coding-agent work from Jira and Feishu:

- **Structured (Jira):** deterministic poll/dispatch/reconcile/retry scheduler — no LLM in the hot loop.
- **Feishu:** direct opencode sessions (`/chat` in a group) plus a bidirectional comment bridge to Jira. The LLM `route agent` (inbox triage) is **not implemented**.

Both converge on a shared normalized `Task` model, a shared workspace manager, and a shared `opencode run` worker.

In terms of scheduling, the `tasking` module extends the coordination model adopted from [Symphony](https://github.com/openai/symphony).

## Install

```bash
npm install -g @tothemax/tasking
# or use without installing:
npx @tothemax/tasking --help
```

Requires Node 22+ and the [`opencode`](https://opencode.ai) CLI on your `PATH`.

## Quick start

```bash
# 1. Scaffold a WORKFLOW.md in the current directory
tasking init

# 2. Edit WORKFLOW.md with your Jira/Feishu credentials (or use $ENV vars)

# 3. Start the daemon
tasking start

# In another terminal:
tasking status     # show running tasks, retry queue, token totals
tasking logs       # tail recent structured logs
```

For guided quickstarts, see the [Chinese guide](./docs/zh/getting-started.md) or the [English guide](./docs/en/getting-started.md).

## Commands

| Command | Description |
|---------|-------------|
| `tasking init [workflow-path]` | Scaffold a starter `WORKFLOW.md` |
| `tasking start [path] [--port N]` | Start the daemon (loads `./WORKFLOW.md` by default) |
| `tasking status` | Print a runtime snapshot (running, retrying, totals) |
| `tasking logs` | Print recent structured logs |
| `tasking doctor [workflow-path]` | Read-only whole-chain health check (WORKFLOW.md, Feishu, Jira, opencode) |

## `WORKFLOW.md` contract

The repo-owned `WORKFLOW.md` (YAML front matter + prompt body) configures the tracker, polling, workspaces, hooks, the opencode worker, and the Feishu source. `tasking init` writes one of four starter templates — `feishu-direct` is the **default** (bare `tasking init`; Feishu-direct-only — [`assets/workflows/WORKFLOW.feishu-direct.md.example`](./assets/workflows/WORKFLOW.feishu-direct.md.example), `tracker.kind: none`, no Jira needed; the first question picks the task source and enter enters this path). The Jira variants are `minimal` (minimal — [`assets/workflows/WORKFLOW.minimal.md.example`](./assets/workflows/WORKFLOW.minimal.md.example)), `code-mr` (full VCS/MR flow — [`assets/workflows/WORKFLOW.code-mr.md.example`](./assets/workflows/WORKFLOW.code-mr.md.example)), and `grill-openspec` ([`assets/workflows/WORKFLOW.grill-openspec.md.example`](./assets/workflows/WORKFLOW.grill-openspec.md.example)) — via `--workflow <variant>` or the connect-Jira branch. Every variant also ships in English: pass `--lang en` to get the `.en.` editions ([`assets/workflows/WORKFLOW.minimal.en.md.example`](./assets/workflows/WORKFLOW.minimal.en.md.example), [`assets/workflows/WORKFLOW.code-mr.en.md.example`](./assets/workflows/WORKFLOW.code-mr.en.md.example), [`assets/workflows/WORKFLOW.grill-openspec.en.md.example`](./assets/workflows/WORKFLOW.grill-openspec.en.md.example)); interactive init prompts for the language when omitted. For a full config reference, see the `code-mr` or `grill-openspec` template.

Key config blocks:

- `tracker.*` — Jira endpoint, auth (`$JIRA_API_TOKEN`), project key, active/terminal states, required labels
- `polling.interval_ms` — poll cadence (default 30000)
- `workspace.root` — per-task workspace root (default `<tmp>/tasking_workspaces`)
- `hooks.*` — `after_create` / `before_run` / `after_run` / `before_remove` shell hooks
- `agent.*` — `max_concurrent_agents`, `max_turns`, `max_retry_backoff_ms`, per-state caps
- `opencode.*` — worker command (default `opencode run`), agent profile, turn/stall timeouts
- `router.*` — **not implemented**: parsed by the resolver but no runtime code consumes it (reserved for a future route-agent triage path)
- `feishu.*` — Feishu source app credentials and `enabled` flag; `feishu.direct` enables `/chat` direct opencode sessions in fixed directories (bypasses Jira; see `docs/configuration.md`)
- `server.port` — optional HTTP dashboard port

The prompt body is a strict Liquid-compatible template with `task` (or `issue`) and `attempt` variables. Unknown variables/filters fail rendering.

## Architecture

```
Jira (structured) ──► deterministic scheduler ──┐
                                                 ├──► workspace ──► opencode run
Feishu (direct sessions) ──► direct worker ─────┘
```

- **Structured path:** Symphony-style poll tick → state machine → reconcile → retry with exponential backoff. No LLM in the hot loop.
- **Feishu path:** direct opencode sessions (`/chat` in a group runs opencode in a configured directory; one topic per session), plus a comment bridge mirroring issue threads ↔ Jira comments. A planned LLM route-agent inbox triage is **not implemented**.
- **Worker:** `opencode run --dir <workspace> --agent <build> "<prompt>"` subprocess, OS-level isolation per task.
- **State:** orchestrator scheduling state is in-memory (restart = re-poll tracker); direct-session bindings are durable SQLite.

See [`openspec/changes/archive/2026-06-23-bootstrap-tasking-runtime/design.md`](./openspec/changes/archive/2026-06-23-bootstrap-tasking-runtime/design.md) for the full design decisions.

## Safety posture

`tasking` inherits Symphony's three non-negotiable filesystem safety invariants:

1. **Agent cwd == workspace path** — the worker's cwd is always the per-task workspace; mismatches abort the attempt.
2. **Workspace under root** — workspace paths are normalized to absolute and must have the workspace root as a prefix; path escapes are rejected.
3. **Sanitized workspace keys** — only `[A-Za-z0-9._-]` allowed in workspace directory names; all other characters become `_`.

### Trust boundary

`tasking` is designed for **trusted environments** with a high-trust configuration:

- The `opencode run` worker runs with the daemon's OS privileges. Use opencode's approval/sandbox settings to tighten execution where needed.
- **Hook scripts are fully trusted** — `WORKFLOW.md` hooks (`after_create`, `before_run`, etc.) run arbitrary shell in the workspace directory with `bash -lc`. Only version hooks from sources you control.
- Workspace hooks are bounded by `hooks.timeout_ms` (default 60s) to avoid hanging the daemon.
- The orchestrator performs **no tracker writes** — ticket mutations (state transitions, comments) happen inside the coding agent via its tools, not in orchestrator business logic.
- API tokens are never logged. `$VAR` indirection keeps secrets out of `WORKFLOW.md`.

### Approval & sandbox policy

Approval, sandbox, and user-input behavior is delegated to `opencode run`'s own policy. Configure it via the `opencode.*` block. A run that requires user input is treated as a hard failure (it does not stall indefinitely).

## Development

```bash
npm install
npm run lint        # biome check
npm run typecheck   # tsc --noEmit
npm test           # vitest run
npm run build       # tsc → dist/
npm run dev -- start  # run via tsx
```

## License

MIT — see [LICENSE](./LICENSE).

tasking's scheduling model and shipped agent skills draw on [openai/symphony](https://github.com/openai/symphony) (Apache-2.0). Its license notice applies to those portions.
