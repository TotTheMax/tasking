# Configuration Reference

This document describes, block by block, all configuration fields of `WORKFLOW.md`, their default values, resolution rules, and dynamic reload semantics. Field names are kept in their original English.

## `WORKFLOW.md` Format

`WORKFLOW.md` is a Markdown file consisting of **YAML front matter** (configuration) + **prompt body** (prompt template).

```markdown
---
<paste YAML front matter here>
---

<prompt body, e.g. {{ task.identifier }}>
```

### Parsing Rules

- When the file starts with `---`, the content between it and the next `---` is the YAML front matter; the rest is the prompt body.
- When there is no front matter, the entire file is treated as the prompt body, and the configuration is an empty object.
- The front matter must parse to a YAML object (map); a non-map is an error (`workflow_front_matter_not_a_map`).
- The prompt body is trimmed of leading and trailing whitespace before use.
- When the front matter is absent, the configuration is an empty map and all default values are used.

### Empty Body Fallback

When the prompt body is empty (or only whitespace), the runtime falls back to the default prompt: `You are working on an issue from the tracker.`.

**Important**: File read/parse errors (`missing_workflow_file`, `workflow_parse_error`) **never** fall back; instead, they block startup.

### Template Variants

`tasking init` selects a starter template via `--workflow`. All three share **the same config schema** (identical front matter field sets); only the prompt body differs:

| `--workflow` value | Template file | prompt body | Installed skills |
|-----------------|----------|-------------|------------|
| `feishu-direct` (**default**; bare `tasking init`) | `assets/workflows/WORKFLOW.feishu-direct.md.example` | **The only config-distinguished variant**: `tracker.kind: none` + Feishu enabled — direct-only deployments; the prompt body is only a sentinel plus a two-line user-facing note (direct sessions take the user's message as prompt; re-run init to connect Jira) | None |
| `minimal` | `assets/workflows/WORKFLOW.minimal.md.example` | Minimal: transition to "In Progress" → complete the task in the working directory → upload results to Jira (comment + attachment) → transition to a terminal state. No git branch/MR/glab, no review pause | None |
| `code-mr` | `assets/workflows/WORKFLOW.code-mr.md.example` | Full-MR: transition to "In Progress" → write code → create MR → review → merge. Includes incremental fix / full reset / merge three-way paths | `land` + `install-glab` |
| `grill-openspec` | `assets/workflows/WORKFLOW.grill-openspec.md.example` | Four phases: grill (interrogate + post comments → review, no MR created) → implement (propose + implement + create MR) → merge (land + archive), includes a runtime upgrade channel | `land` + `install-glab` + 4 opsx |

Each non-`minimal` variant's template prompt body carries a sentinel marker for `--update` to detect: `grill-openspec` contains `## 🔍 拷问 / Grill Questions`, `code-mr` contains `<!-- tasking-workflow: code-mr -->`, `feishu-direct` contains `<!-- tasking-workflow: feishu-direct -->` (probed first), and `minimal` has no marker (fallback). `detectWorkflow` probes four ways by priority, with no legacy heuristics — a markerless body always resolves to `minimal`.

### Template Languages

Every variant also ships in an English edition, selected via `--lang <zh|en>` (default `zh`; the zh files listed above are the canonical originals). The two languages of a variant share the same config schema, protocol sentinels, and installed skills — only the comments/guidance text differs:

| `--lang` value | Template files (per variant: feishu-direct / minimal / code-mr / grill-openspec) | Sentinel |
|------|------|------|
| `zh` (default) | `assets/workflows/WORKFLOW.feishu-direct.md.example` / `assets/workflows/WORKFLOW.minimal.md.example` / `assets/workflows/WORKFLOW.code-mr.md.example` / `assets/workflows/WORKFLOW.grill-openspec.md.example` | none (fallback; feishu-direct carries its own variant sentinel) |
| `en` | `assets/workflows/WORKFLOW.feishu-direct.en.md.example` / `assets/workflows/WORKFLOW.minimal.en.md.example` / `assets/workflows/WORKFLOW.code-mr.en.md.example` / `assets/workflows/WORKFLOW.grill-openspec.en.md.example` | `<!-- tasking-workflow-lang: en -->` at the top of the prompt body |

State-name placeholder values (e.g. under `active_states`) are user-edited configuration, so the English templates keep them unchanged with an English note to adjust them to your Jira instance. `init --update` detects the language from the same sentinel so drift reports compare against the matching language; `--lang` overrides it. See ADR 0013.

`--lang` also seeds the interface language: choosing `en` writes `interface_language: en` into the generated WORKFLOW.md, while `zh` (default) omits the field (the default value, per the write-only-non-defaults trimming rule).

The phase/re-dispatch routing of `grill-openspec` and `code-mr` is entirely self-determined by the agent within the prompt body (artifacts as primary + state semantics + Jira comments/glab as fallback), without hardcoding state names or changing runtime code. See `docs/usage.md` and `docs/adr/0001-phase-routing-in-prompt.md`, `docs/adr/0011-three-variant-split-and-marker-detection.md`.

## `tracker` Block

Jira tracker configuration. Structured source.

| Field | Type | Default | Required | Description |
|------|------|--------|------|------|
| `kind` | string | — | yes (dispatch) | Tracker type; `jira` (structured source) or `none` (no Jira source — direct-only deployments; other fields ignored with a warning) |
| `endpoint` | string | `https://your-domain.atlassian.net/rest/api/3` | no | Jira Cloud REST base URL |
| `api_key` | string\|`$VAR` | — | yes (dispatch) | API token; supports `$VAR` indirection; canonical env var `JIRA_API_TOKEN` |
| `api_user` | string | — | yes (dispatch) | Basic auth username (email) |
| `auth_mode` | `"basic"` \| `"bearer"` | `"basic"` | no | Auth mode. `basic` = email + token; `bearer` = token only (self-hosted PAT) |
| `review_state` | string | — | no | Review handoff state name (e.g. "代码评审中"). This state is not placed in `active_states` or `terminal_states`; it automatically becomes an implicit intermediate state. Injected into the prompt template for agent use |
| `project_key` | string | — | yes (dispatch) | Jira project key (e.g. `ENG`); at least one of this or `project_slug` |
| `project_slug` | string | — | no | Project slug (alternative) |
| `required_labels` | string[] | `[]` | no | Task must contain all of these labels to be dispatched; matching is case-insensitive and ignores leading/trailing whitespace |
| `active_states` | string[] | `["To Do", "In Progress"]` | no | Active states; tasks in these states are eligible for dispatch. Recommend including initial, in-progress, merge, and rework states. States not in this list and not in `terminal_states` automatically become implicit review states (worker stops but workspace is retained). See [State Flow](./state-flow.md) |
| `terminal_states` | string[] | `["Done", "Closed", "Cancelled", "Canceled", "Duplicate"]` | no | Terminal states; tasks entering these states stop and clean up the workspace |

`api_key` and `api_user` form Basic auth (`base64(api_user:api_key)`). When `$VAR` resolves to an empty string, it is treated as missing.

## `polling` Block

Polling cadence.

| Field | Type | Default | Required | Description |
|------|------|--------|------|------|
| `interval_ms` | integer | `30000` | no | Polling interval (ms); changes are re-applied at runtime, affecting subsequent tick scheduling, without restart |

## `workspace` Block

Per-task workspace.

| Field | Type | Default | Required | Description |
|------|------|--------|------|------|
| `root` | path\|`$VAR` | `<system temp dir>/tasking_workspaces` | no | Workspace root directory; supports `~` expansion and `$VAR` indirection; relative paths are resolved relative to the directory containing `WORKFLOW.md`; normalized to an absolute path before use |

Each task's workspace path is `<root>/<sanitized_identifier>`, where characters in the identifier that are not in `[A-Za-z0-9._-]` are replaced with `_`.

## `hooks` Block

Workspace lifecycle hooks.

| Field | Type | Default | Required | Description |
|------|------|--------|------|------|
| `after_create` | string (shell) | `null` | no | Runs only when a workspace directory is newly created; failure aborts workspace creation |
| `before_run` | string (shell) | `null` | no | Runs before each attempt; failure aborts the current attempt |
| `after_run` | string (shell) | `null` | no | Runs after each attempt; failure is only logged and does not affect the result |
| `before_remove` | string (shell) | `null` | no | Runs before deleting the workspace; failure is only logged and deletion continues |
| `timeout_ms` | integer | `60000` | no | Timeout (ms) applying to all hooks; an invalid value causes config validation failure |

Hooks are executed with `bash -lc <script>` in the workspace directory (cwd). Multi-line scripts use YAML's `|` literal block scalar.

## `agent` Block

Worker concurrency and retry strategy.

| Field | Type | Default | Required | Description |
|------|------|--------|------|------|
| `max_concurrent_agents` | integer | `10` | no | Caps concurrent Jira worker `opencode run` subprocesses. Feishu direct sessions run on a separate budget (`feishu.direct.max_concurrent`), so the machine-wide subprocess total can reach the sum of the two |
| `max_turns` | positive integer | `20` | no | Upper bound on session continuation turns within one worker. Turn 1 creates an opencode session, turns 2+ use `-s <sessionID>` to continue the same session (the agent retains full conversation context across turns). After the worker exits, a continuation retry creates a brand-new session (the agent re-evaluates progress from `git log`). Set to `1` for single-turn execution only. |
| `max_retry_backoff_ms` | integer | `300000` (5 minutes) | no | Cap on the failure backoff delay |
| `max_concurrent_agents_by_state` | map<string, positive integer> | `{}` | no | Per-state concurrency caps; state keys are lowercased; non-positive or non-numeric entries are ignored |

`max_concurrent_agents_by_state` example:

```yaml
agent:
  max_concurrent_agents_by_state:
    "In Progress": 3
    "In Review": 2
```

The key `In Progress` is normalized to `in progress` for lookup; unconfigured states fall back to the global `max_concurrent_agents`.

## `opencode` Block

Worker (`opencode run` subprocess) configuration.

| Field | Type | Default | Required | Description |
|------|------|--------|------|------|
| `command` | string (shell) | `opencode run` | yes (dispatch) | Worker startup command; split on whitespace into command + args |
| `agent` | string | `build` | no | `--agent` argument value, i.e. the opencode agent profile; the per-task fallback default |
| `agents` | string[] | `[]` | no | Advisory catalog of known opencode agent profiles; when non-empty it is surfaced by the `/agent` command and gives a friendly hint for unknown names; when empty no validation is performed (any `agent:<name>` label passes through). It is not a hard allowlist |
| `model` | string\|null | `null` | no | `--model` argument value (`provider/model` format); when `null` or empty string, the flag is not appended and opencode's default model is used |
| `variant` | string\|null | `null` | no | `--variant` argument value (provider-specific reasoning tier, e.g. `high`/`max`/`minimal`); when `null` or empty string, the flag is not appended. Independent of `model` |
| `turn_timeout_ms` | integer | `3600000` (1 hour) | no | Hard wall-clock total timeout for a single turn; kills on expiry regardless of activity. On timeout the attempt is marked `timed_out` (`turn_timeout`) |
| `stall_timeout_ms` | integer | `7200000` (2 hours) | no | Stall detection threshold (scheduler layer, checks whether the worker is stuck); `<= 0` disables. Set to a value greater than `turn_timeout_ms` to ensure it only acts as a fallback when both wall-clock and inactivity have failed |
| `inactivity_timeout_ms` | integer | `600000` (10 minutes) | no | Inactivity timeout (subprocess layer, checks raw stdout/stderr bytes); the timer is reset when data is received, and if silent for longer than this value, the process is terminated with SIGTERM. `<= 0` disables the inactivity timeout |
| `auto_approve` | boolean | `true` | no | Auto-approve opencode permission requests (appends the `--auto` flag); when `false`, you must configure permission rules manually via `.opencode/opencode.json` |

The actual worker startup command is: `<command> [--auto] --dir <workspace> --agent <agent> [--model <model>] [--variant <variant>] "<prompt>"`. `--model`/`--variant` are appended only when the corresponding field is non-empty. The `--agent` value is re-resolved each turn from the task's `agent:<name>` label (if present), falling back to `opencode.agent`; see the `/agent` command in the [Feishu↔Jira comment bridge](./usage.md) and ADR 0011.

## `router` Block

> **Not implemented**: this block is only parsed by the resolver — **no runtime code** consumes it (the route agent is not built). It ships commented out in the templates and in `tasking init` output as a reserved note; no configuration needed.

Route agent (unstructured triage) configuration.

| Field | Type | Default | Required | Description |
|------|------|--------|------|------|
| `enabled` | boolean | `false` | no | Whether to enable the route agent |
| `agent` | string | `triage` | no | opencode agent profile used by the route agent |
| `batch_size` | integer | `20` | no | Upper bound on inbox entries processed in a single route agent run |
| `timeout_ms` | integer | `120000` (2 minutes) | no | Timeout for a single route agent run; on timeout it is terminated, and unprocessed entries remain `untriaged` |

At most one route agent runs at a time (unless configured otherwise), and it does not block the structured scheduler.

## `feishu` Block

Feishu ↔ Jira comment sync bridge configuration. When enabled, Feishu threads are bound 1:1 to Jira issues, mirroring comments bidirectionally; users operate via `/issue`/`/state`/`/help` commands in Feishu. Inbound uses REST polling (no public port, zero new dependencies).

| Field | Type | Default | Required | Description |
|------|------|--------|------|------|
| `enabled` | boolean | `false` | no | Whether to enable the Feishu bridge; when `false`, it is not enabled even if credentials are configured |
| `edition` | string | `feishu` | no | Feishu edition: `feishu` (China mainland, `open.feishu.cn`) or `lark` (overseas, `open.larksuite.com`). Selects the REST/event-channel domain and developer-console links; an invalid value fails startup validation |
| `app_id` | string\|`$VAR` | — | yes (when enabled) | Feishu app app id |
| `app_secret` | string\|`$VAR` | — | yes (when enabled) | Feishu app app secret |
| `intake_chat_id` | string | — | yes (when enabled) | Designated group chat_id hosting all issue threads (obtain via `GET /im/v1/chats`) |
| `forward_interval_ms` | integer | `5000` | no | Jira→Feishu comment mirror cadence (fast loop) |
| `sweep_interval_ms` | integer | `43200000` | no | Sweep loss-backstop cadence (catches offline windows); also triggered at start and on WS reconnect |
| `create_issue_type` | string | — | yes (when enabled) | Default issueType for `/issue` (lists project-available types at init) |
| `verification_token` | string\|`$VAR` | — | no | Event subscription verification token (unused under REST polling, reserved for a future webhook mode) |
| `encrypt_key` | string\|`$VAR` | — | no | Event subscription encryption key (unused under REST polling, reserved) |

The old key `poll_interval_ms` (versions ≤2026-09-08) is deprecated: if present it is ignored (with a WARN logged) and `forward_interval_ms` falls back to its default 5000 — the daemon still starts; update WORKFLOW.md to the new key (see [ADR 0022](../adr/0022-deprecated-config-key-soft-migration.md)).

When enabled but `app_id`/`app_secret`/`intake_chat_id`/`create_issue_type` are missing, startup validation fails. The Feishu app must be granted scopes: `im:message.group_msg` (app-level read of group messages, no substitute), `im:message` (send messages and read content), and `im:chat` (list/create chats). Deduplication uses the visible sentinel `💬 {sender} via 飞书 [msg:{id}]:` (tasking and the agent share the Jira account, so authorship cannot be distinguished). See ADR 0002/0003/0004.

When `bindings.db` is absent (first run or a new machine), the intake cursor starts empty and the bridge anchors it via a one-shot cold-start probe against Feishu's own clock — it does not replay the past 24h and does not re-create issues, so no db file migration is needed when moving machines (see ADR 0016).

### `feishu.direct` Sub-block (direct sessions)

Feishu direct-to-opencode session configuration. When `feishu.enabled` is true, direct sessions are **enabled by default** (section absent = all defaults; path mode works with zero extra config); an explicit `enabled: false` inside the section opts out. Direct sessions bypass Jira and run opencode in fixed directories (see ADR 0022/0023).

| Field | Type | Default | Required | Description |
|------|------|--------|------|------|
| `enabled` | boolean | `true` (when the section exists) | no | An explicit `enabled: false` inside the section turns direct sessions off |
| `projects` | map (name → path string, or `{ path, auto_approve }`) | `{}` | no | Project name → directory mapping, used by `/chat <project> <msg>`. The object form's `auto_approve` overrides the global value |
| `path_roots` | string[] | `[]` | no | Directory prefix whitelist for ad-hoc path mode (`/chat /abs/path <msg>`); empty = unrestricted |
| `auto_approve` | boolean | `false` | no | When true, passes `--auto` to `opencode run` (auto-approves permissions not explicitly denied). Default false: the permission stance is governed by the target directory's own `.opencode` permission config — `ask` entries are safely auto-rejected and reported in the turn summary |
| `verbosity` | `quiet`\|`summary`\|`detailed` | `detailed` | no | How much is mirrored to Feishu: `quiet` posts only the final answer text (permission-rejection notices kept); `summary` adds a one-line stats footer (⏱/🔧/tokens) — the explicit fallback for older clients; `detailed` (default) posts one updatable per-turn process card (collapsible tool panels + interrupt/retry/full-output/end buttons; failed panels expanded) plus a markdown result card rendered at turn end (headings/tables/code blocks render; oversized answers are sent as a `.md` attachment). Collapsible panels need Feishu/Lark client >= V7.9; older clients render an upgrade placeholder (result delivery unaffected) |
| `max_concurrent` | integer | `5` | no | Daemon-wide cap on concurrent direct turns (independent of Jira's `max_concurrent_agents`); turns are always serialized per directory/session |
| `idle_ttl_ms` | integer | `2592000000` (30 days) | no | How long an idle session stays alive before being marked expired (the opencode session on disk is not deleted) |

Direct turns inherit the operator-level `opencode.agent`, `opencode.model`, and `opencode.variant` (appended as `--agent`/`--model`/`--variant` when non-empty), exactly like the Jira worker; the target directory's own `.opencode/` config still governs permissions/LSP/formatters.

Zero-config works (path mode): with `feishu.enabled: true` and no `direct` sub-block, `/chat /abs/path <msg>` in the group just works. To use project names, add two lines:

```yaml
feishu:
  direct:
    projects:
      tasking: /home/me/workspace/tasking
```

## `server` Block

Optional HTTP dashboard extension.

| Field | Type | Default | Required | Description |
|------|------|--------|------|------|
| `port` | integer\|null | `null` | no | Port to enable the HTTP dashboard; `null` does not enable; `0` requests an ephemeral port |

The CLI `--port` argument overrides this value. It binds to the loopback address `127.0.0.1` by default. The dashboard is for observability/control only and is not involved in correctness.

Endpoints:

| Path | Method | Description |
|------|------|------|
| `/` | GET | Human-readable dashboard |
| `/api/v1/state` | GET | JSON runtime state snapshot |
| `/api/v1/refresh` | POST | Trigger a poll + reconcile (returns `202`) |

## `interface_language` top-level field

The interface language: the language tasking renders its **own** interface text in — Feishu replies/toasts/card labels, CLI output (doctor/init/start errors), TUI. User content and agent output are **never translated**.

| Field | Values | Default | Notes |
|------|------|------|------|
| `interface_language` | `zh` \| `en` | `zh` | Omitting it behaves exactly like earlier versions; an invalid value fails config parsing |

- **Hot-reload takes effect immediately**: edit the field while the daemon runs and the next outbound message/render uses the new language — no restart (unlike `tracker.kind`).
- Translation happens at the exits via a dictionary; Chinese source strings are untouched. New Chinese strings must come with dictionary entries or `tests/translate-coverage.test.ts` fails CI (see ADR 0031).
- `tasking start` has no language override flag — WORKFLOW.md is the single source of truth.

## Resolution Rules

### `$VAR` Indirection

- Only applies to values that **explicitly contain** the `$VAR_NAME` form.
- `$VAR_NAME` resolves to the value of the environment variable `VAR_NAME`.
- When it resolves to an empty string, the value is treated as **missing**.
- Environment variables do **not** globally override YAML values; resolution happens only when the YAML value itself is in the `$VAR` form.
- `tasking start` / `tasking doctor` load a `.env` file from the `WORKFLOW.md` directory (if present) into the process environment at startup (already-set real env vars win and are not overridden), as a convenient source for `$VAR` references; see `.env.example` for the template.

Example:

```yaml
tracker:
  api_key: $JIRA_API_TOKEN   # 解析为 env.JIRA_API_TOKEN
  project_key: ENG            # 原样使用,不解析
```

### `~` Expansion

Only applies to path fields (e.g. `workspace.root`): when starting with `~`, it is expanded to the user's home directory.

### Relative Path Resolution

When `workspace.root` is a relative path, it is resolved **relative to the directory containing `WORKFLOW.md`** (not the current working directory). After resolution, it is normalized to an absolute path.

### Default Value Application

Built-in defaults are applied when optional fields are missing (see the "Default" column of each block's table). Missing required fields (e.g. `tracker.kind`, `tracker.api_key`, `project_key`) cause dispatch validation failure.

## Dynamic Reload

`tasking` detects changes to the `WORKFLOW.md` file, re-reads it, and re-applies the configuration and prompt template without restart.

### Re-application Scope

The reloaded configuration affects subsequent dispatch, retry scheduling, reconcile decisions, hook execution, and worker startup. Including:

- `polling.interval_ms` → subsequent tick scheduling.
- `agent.max_concurrent_agents` / `max_concurrent_agents_by_state` → subsequent dispatch decisions.
- `tracker.active_states` / `terminal_states` → subsequent reconciliation and candidate eligibility.
- `opencode.*` → subsequent worker startup.
- `workspace.*` / `hooks.*` → subsequent workspace creation and hooks.
- prompt template → subsequent attempt rendering.

**In-flight agent sessions** are not automatically restarted.

### Invalid Reload Behavior

- An invalid reload (e.g. YAML syntax error) **does not crash the daemon**.
- The **last known good configuration** remains in effect.
- A visible error is emitted to the operator (structured log, `level=error`).
- After the file is fixed, the next reload returns to normal.

## Validation Rules

### Startup Validation

Validated at startup; failure **blocks startup** (non-zero exit code). Validation items:

- `WORKFLOW.md` is loadable and parseable.
- `tracker.kind` is present and a supported value (`jira`); `none` switches to trackerless validation: Feishu credentials required, `create_issue_type` no longer mandatory, and source-less degenerate combos rejected.
- After `$` resolution, `tracker.api_key` is present.
- `tracker.project_key` or `tracker.project_slug` is present.
- When the Feishu bridge is enabled, `feishu.app_id`, `feishu.app_secret`, `feishu.intake_chat_id`, and `feishu.create_issue_type` are present.

### Per-tick Dispatch Validation

Re-validated before each tick's dispatch. On failure:

- **Skip this tick's dispatch**.
- **Keep reconciliation** (reconcile still runs).
- Emit a visible error to the operator.

This ensures temporary configuration corruption does not stop reconciliation of running tasks.

## `server` Block

| Field | Type | Default | Description |
|---|---|---|---|
| `port` | integer/null | `null` | HTTP dashboard port. CLI `--port` overrides. `null` = not started |
| `host` | string | `0.0.0.0` | HTTP dashboard bind address. Set `127.0.0.1` for local-only access |

## `logging` Block

| Field | Type | Default | Description |
|---|---|---|---|
| `file.path` | string/null | `null` | File log path. Defaults to `./tasking.log` at CLI startup |
| `file.max_bytes` | integer | `10485760` (10MB) | Maximum bytes per file; rotates when exceeded |
| `file.max_files` | integer | `5` | Number of rotation backups |

## `env` Block

Environment variables injected into the worker subprocess (`opencode run`). Values support `$VAR` indirection (same semantics as `tracker.api_key`); when it resolves to an empty string, an empty string value is injected. A missing `env` section defaults to an empty object.

Values from `config.env` take precedence over inherited `process.env` — values explicitly declared in WORKFLOW.md override the daemon process's environment variables.

| Field | Type | Default | Description |
|---|---|---|---|
| `<KEY>` | string | — | Environment variable name → value mapping; values support `$VAR` indirection |

Example:

```yaml
env:
  GITLAB_TOKEN: $GITLAB_TOKEN
  GITLAB_HOST: $GITLAB_HOST
```

## CLI Flags

| Flag | Description |
|---|---|
| `--port <n>` / `-p` | HTTP dashboard port (overrides `server.port`) |
| `--tui` | Enable the terminal TUI status panel (logs are written to file only) |
