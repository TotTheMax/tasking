# Drive turns through the opencode v2 API (opencode api), v2-only

tasking 0.7 requires opencode >=2.0 <3 and drives every turn through the v2 API via the `opencode api` CLI (`session.create` / `session.prompt` / polling / `session.interrupt`), replacing the v1 `opencode run` subprocess + stdout NDJSON path. v1 is frozen on the `support/v1` branch (0.6.x).

**Context.** opencode v2 removed `run`'s `--dir`/`--variant` flags, rewrote the HTTP API, and made `run` attach to a shared background service by default; on a v2 machine the old spawn path fails immediately. A ten-round spike (branch `spike/opencode-v2-adaptation`) verified the v2 surface on 2.0.29 before this decision.

**Considered options.** (a) `run --standalone` per turn — restores v1 process semantics but keeps a cold server per turn and structurally cannot approve permissions mid-run (run-created prompts auto-reject `ask`); (b) the generated `@opencode/client` — typed but needs client↔server version pairing discipline; (c) the in-process `@opencode/sdk` — eliminates version pairing but couples the server runtime (Node experimental sqlite, non-official runtime) into the daemon and exposes no listener; (d) `opencode api` CLI — machine binary is always same-source with its service, zero npm runtime deps, works over the same experimental API surface as the client.

We chose (d) with a version gate: a major-version mismatch refuses to start; an unvalidated 2.x minor warns but runs (v2 ships fast; breaking a minor would break opencode's own clients first). `@opencode/sdk` + `@opencode/client` stay pinned in devDependencies as the contract harness that validates hardcoded API shapes when widening the validated range.

**Consequences.** Turn submission, progress and terminal state come from polling (`session.get` / `session.permission.list` / `session.message.list`) at `opencode.poll_interval_ms`; interrupt replaces process-tree kill; usage accounting drops v1's `total` field (see ADR 0037). tasking never manages the machine's shared service process.
