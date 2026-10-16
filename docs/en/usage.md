# Usage Guide

This document covers the installation, commands, configuration, and typical usage scenarios of `tasking`. All commands and configuration key names are kept in their original English form.

## Installation

### Prerequisites

- **Node.js 22+**: confirm by running `node --version` in your terminal.
- **opencode CLI**: **opencode v2** (`>=2.0 <3`) must be executable on `PATH` (on v1 run `opencode upgrade --major`). Install from [opencode.ai](https://opencode.ai).
- **Jira account** (structured source): requires an API token for Basic auth.
- **Feishu app** (unstructured source, optional): requires an app id/secret to receive IM messages and reply.

### Global Installation

```bash
npm install -g @tothemax/tasking
tasking --help
```

### Run without installing (npx)

```bash
npx @tothemax/tasking --help
npx @tothemax/tasking init
npx @tothemax/tasking start
```

## Quick Start

### 1. Initialize the workflow file

Run in your project root:

```bash
tasking init
```

This generates a starter `WORKFLOW.md` (with YAML front matter + prompt body) and creates the local `tasking_workspaces/` directory. If `WORKFLOW.md` already exists, add `--force` to overwrite it; the previous file is automatically backed up as `WORKFLOW.md.bak`.

### 2. Edit the configuration

Open `WORKFLOW.md` and at minimum fill in your Jira credentials and project key:

```yaml
---
tracker:
  kind: jira
  endpoint: https://your-domain.atlassian.net/rest/api/3
  api_key: $JIRA_API_TOKEN
  api_user: you@example.com
  project_key: ENG
---
```

Pass the API token via an environment variable (to avoid writing it into the file):

```bash
export JIRA_API_TOKEN="你的-jira-api-token"
```

For full field documentation see [Configuration Reference](./configuration.md).

### 3. Start the daemon

```bash
tasking start
```

By default it loads `WORKFLOW.md` from the current directory. The daemon polls Jira at `polling.interval_ms` (default 30000ms) and dispatches matching tasks to opencode workers.

Press `Ctrl+C` for a graceful shutdown.

## Command Reference

### Help entrypoint

`tasking --help` (or `-h`) and `tasking help` print the top-level help: a list of commands with a one-line description each. To view detailed help for a subcommand (usage, arguments, options table), use `tasking <cmd> --help` (or `-h`) or `tasking help <cmd>`. Explicitly requested help is printed to stdout with exit code 0; missing subcommand, unknown subcommand, or `help` followed by an unknown command prints to stderr with exit code 1.

### Version entrypoint

`tasking --version` (or `-v`) prints the installed version (a bare semver from `package.json`, e.g. `0.6.17`) to stdout and exits 0. `tasking doctor` also prints this version as the first line of its report.

### `tasking init`

Generates a starter `WORKFLOW.md` and the local workspace directory. By default it runs an interactive wizard to fill in Jira credentials. The positional `[workflow-path]` selects the config file path (default `./WORKFLOW.md`); the generated config, `.opencode/skills/`, the `.tasking/` reference copy, and `.bak` backups all key off that file's directory — the same semantics as `start`/`doctor`. A directory argument is an error.

```bash
tasking init [workflow-path] [--force] [--non-interactive] [--workflow minimal|code-mr|grill-openspec|feishu-direct] [--lang zh|en] [--update | --restore]
```

| Option | Description |
|------|------|
| `workflow-path` | Path to `WORKFLOW.md`, defaults to `./WORKFLOW.md`. Same semantics for `init` (generate/`--update`/`--restore`), `start`, and `doctor`; generation recurses to create missing parent directories; a directory argument is an error |
| `--force` | Overwrite an existing `WORKFLOW.md` (the previous file is backed up as `<workflow-path>.bak`) |
| `--non-interactive` | Skip the interactive Q&A and copy the example file directly (for CI/scripts). Takes effect automatically when stdin is not a TTY |
| `--workflow <name>` | Select a workflow variant: `minimal` (minimal: complete the task in the working directory → upload to Jira → transition to a terminal state), `code-mr` (write code + create MR), `grill-openspec` (grill→propose→implement→archive, four phases), or `feishu-direct` (Feishu-direct only, **the default**). When interactive and unspecified, the first question is the task source (Feishu direct only [enter default] / connect Jira → variant follow-up); when non-interactive, the default is `feishu-direct`. An unknown value errors out |
| `--lang <zh\|en>` | Template language for WORKFLOW.md comments/guidance: `zh` (Chinese, canonical) or `en` (English). Defaults to `zh`; when interactive and unspecified, a "Template language" question asks which to choose. Composes with `--workflow` (4 variants × 2 languages). The installed skill set depends only on the variant. An unknown value errors out |
| `--update` | Non-destructive upgrade: sync all skills from `assets/skills/` to the workflow path's `.opencode/skills/` (missing ones are newly installed; modified files are backed up as `<file>.bak` before being overwritten), print the detected workflow variant, and print a WORKFLOW.md drift report (missing config fields — compared against a fresh-init-today baseline, so sections the generator trims by design never count — plus the prompt body diff). When drift exists it also writes the full new template to the same directory's `.tasking/<basename>.reference` (gitignored) and prints a `git diff --no-index` command so you can see exactly where each change belongs. It does **not** write WORKFLOW.md. Requires an existing WORKFLOW.md |
| `--restore` | Rollback: restore the workflow path's `<workflow-path>.bak` (if present, from the pre-`--force` backup) and the `.bak` backups under the same directory's `.opencode/skills/**` as the current files, recovering the pre-overwrite user versions |

`--force`, `--update`, and `--restore` are mutually exclusive (specifying more than one errors out).

In interactive mode the Q&A branches by task source:
1. (When `--workflow` is not specified) **Task source** — a two-option question: 「只用飞书直连（默认）」(enter default) enters the Feishu flow; 「接 Jira」asks the variant follow-up (`minimal` / `code-mr` / `grill-openspec`) and enters the Jira flow
2. (When `--lang` is not specified) Choose a template language (`中文` / `English`; press enter for 中文)
3. **Feishu flow**: Feishu app_id → Feishu app_secret (**validated on the spot**; failures print a human-readable reason and re-ask the secret, persistent failures can be skipped) → on success the bot's chats are **listed for selection** as the intake group (empty/failure falls back to manual `oc_xxx` entry) → an optional common project name (enter to skip) + its absolute directory (existence-checked)
4. **Jira flow**: Jira REST API endpoint → Jira API token → auth mode (basic/bearer) → Jira username (basic only) → Jira project key, then the optional Feishu Setup (enabling the bridge collects `app_id`/`app_secret`/`intake_chat_id`/`create_issue_type`)

Once the Q&A completes:
- The Jira flow tests the Jira connection with the credentials (5s timeout); on success it prints the project's status list for reference
- Checks whether `opencode` is installed (warning, non-blocking)
- Jira variants check `glab` (warning, non-blocking; when missing, prints install commands such as `brew install glab`, and the agent side can self-install via the `install-glab` skill); feishu-direct skips this
- Jira variants print a GitLab credential hint when `GITLAB_TOKEN` is unset (environment variable or writing an `env:` config block directly)
- **Feishu Setup** (Jira flow, optional): asks whether to enable the Feishu comment bridge; if enabled, it collects `app_id`/`app_secret`/`intake_chat_id`/`create_issue_type` (reusing the discovered issueTypes) and writes them into the WORKFLOW.md `feishu:` block (`app_secret` is written in plaintext; leaving it blank keeps the `$FEISHU_APP_SECRET` env reference and prints a hint)
- Installs skills into `.opencode/skills/` per the selected variant (skipped if already present): `minimal`/`feishu-direct` install none; `code-mr` installs `land` + `install-glab`; `grill-openspec` adds 4 opsx skills
- Attempts to open an editor (`$VISUAL` → `$EDITOR` → `code`)
- The generated file is **trimmed by section**: only required sections stay active (`tracker`, Jira variants' `hooks`/`env`, `feishu` when enabled); the other optional sections are fully commented with a "optional: defaults below; uncomment only to change" header. The `router` section and feishu's `verification_token`/`encrypt_key` are marked not-implemented/reserved. Interactive and non-interactive share the same output (non-interactive no longer byte-copies the template); the marker text is localized by `--lang`
- (Connect Jira) after the connection test the project statuses are **mapped and prefilled** into `active_states`/`terminal_states`/`review_state` (proposal printed, enter confirms; declining or unmappable names fall back to the template defaults)
- The completion hint is **graded by variant**: feishu-direct prints "setup complete + `tasking start` + the first `/chat <project> <message>` command" (with an "unrestricted path mode" warning when the project question was skipped); Jira variants list the remaining manual fields — state fields drop out when autofill succeeded, leaving `after_create` (plus `env.GITLAB_*` for MR variants)

Non-interactive mode installs skills per variant (`minimal`/`feishu-direct` install none; `code-mr` installs `land` + `install-glab`; `grill-openspec` installs 6), defaults to the `feishu-direct` template, and prints Feishu onboarding guidance (pointing to `docs/feishu-quickstart.md`).

Exit codes: `0` on success; `1` when `WORKFLOW.md` already exists and `--force` was not given; `1` for an unknown `--workflow` or `--lang` value.

#### Upgrade and rollback: `--update` / `--restore`

After upgrading `tasking` (`npm i -g @tothemax/tasking@new`), the new version's skills and WORKFLOW.md template/prompt body changes do not automatically flow into the user's environment. `tasking init --update` provides a non-destructive remediation path:

1. **Skills** (owned by tasking, canonical source `assets/skills/`, shipped with the package): all 6 skills are synced to `.opencode/skills/` — missing ones are newly installed; files byte-identical to the source are skipped; modified ones are backed up as `<file>.bak` in the same directory before being overwritten, with a warning and the backup path printed.
2. **WORKFLOW.md** (owned by the user): **never written**, only prints a drift report — a list of missing config fields (against the **drift baseline**: the key set a fresh init for the detected variant × language would write today, with the feishu section shaped by your own `feishu.enabled`; a key counts as missing only when the baseline has it and your file does not, defaults rendered as YAML/JSON, e.g. `[]`; the file still runs without them, missing fields fall back to `DEFAULTS`; sections the generator trims/omits by design — including `interface_language` on zh — never count) and a line-level diff of the prompt body, for a human to manually reconcile credentials/state names/prompt body improvements. The report template is detected by default via four-way marker detection from the user's prompt body (containing `<!-- tasking-workflow: feishu-direct -->` → `feishu-direct`; containing `## 🔍 拷问 / Grill Questions` → `grill-openspec`; containing `<!-- tasking-workflow: code-mr -->` → `code-mr`; otherwise `minimal`), and can be explicitly overridden with `--workflow`. The template **language** is detected the same way: a WORKFLOW.md containing the `<!-- tasking-workflow-lang: en -->` sentinel drift-reports against the English template, otherwise against the zh template; `--lang` overrides it explicitly. The detected (or explicit) variant and language are printed at the start of the output. When there is any drift (fields missing vs the baseline, or a prompt body diff), the full new template is also written to `.tasking/WORKFLOW.md.reference` with a `git diff --no-index WORKFLOW.md .tasking/WORKFLOW.md.reference` hint, so you can review every change in context with your own diff tool; the reference is removed automatically once the next `--update` finds no drift.

`tasking init --restore` rolls back overwrites: if `WORKFLOW.md.bak` exists (the automatic backup taken before a `--force` overwrite), it is first restored as `WORKFLOW.md`; then each `.bak` under `.opencode/skills/**` is restored as the current skill file (when there is no backup at all, it prints a notice and exits normally). The backup retains only the version from right before the most recent overwrite. Both operations require no interactive input and are scriptable.

> **Skill delivery**: `tasking init` installs skills from `assets/skills/` into the init directory's `.opencode/skills/` — `minimal`/`feishu-direct` install no skills; `code-mr` installs `land` + `install-glab`; `grill-openspec` installs `land` + `install-glab` + 4 opsx skills (`opsx-grill-with-docs`/`opsx-propose-with-tdd`/`opsx-implement`/`openspec-archive-change`, 6 in total). The user runs init inside the target repo (the one `after_create` clones), and the skills enter each workspace via the clone; the runtime daemon does not copy them per workspace. After an upgrade, use `tasking init --update` to sync the new-version skills and template.

#### The `grill-openspec` variant

#### The `feishu-direct` variant

`--workflow feishu-direct` uses the `assets/workflows/WORKFLOW.feishu-direct.md.example` template: a Feishu-direct-only deployment (`tracker.kind: none`) with no Jira scheduling or mirror — `/chat` is the task surface; interactive init skips the Jira questions.

`--workflow grill-openspec` uses the `assets/workflows/WORKFLOW.grill-openspec.md.example` template, with four-phase routing:

1. **grill** (initial active state): runs `opsx-grill-with-docs`, investigates code to establish facts, drafts `CONTEXT.md`/`docs/adr/`, and merges pending decisions into a single Jira comment with a marker header `## 🔍 拷问 / Grill Questions`, then transitions to the review state and stops. **Does not create an MR or an openspec change.** If there are no questions, it proceeds directly to phase 2.
2. Once a person answers the comment and moves it back to active → **implementation**: runs `opsx-propose-with-tdd` to create an openspec change, `opsx-implement` to implement it, commits the code + `openspec/changes/<name>/` together into a feature branch, creates an MR, and transitions to review.
3. Once a person reviews the MR and moves it to the "merging" semantic active state → **merge**: runs `land` to merge the MR, `openspec-archive-change` to archive, transitions to terminal → the scheduler deletes the workspace.

At any phase, a truly blocking decision can be raised as a grill comment to transition to review (a runtime escalation). The rework path (incremental fix / full reset) **does not re-grill**; it re-implements against the existing openspec change.

All phase routing is decided by the agent itself within the prompt body (artifacts as primary + state semantics + Jira comments/glab as fallback); no state names are hardcoded and no runtime code is changed.

> **Skill delivery**: `tasking init` installs skills from `assets/skills/` into the init directory's `.opencode/skills/` — `minimal`/`feishu-direct` install no skills; `code-mr` installs `land` + `install-glab`; `grill-openspec` installs `land` + `install-glab` + 4 opsx skills (`opsx-grill-with-docs`/`opsx-propose-with-tdd`/`opsx-implement`/`openspec-archive-change`, 6 in total). The user runs init inside the target repo (the one `after_create` clones), and the skills enter each workspace via the clone; the runtime daemon does not copy them per workspace. For known limitations see `docs/known-issues.md`.

### `tasking start`

Starts the daemon, loads the workflow, and begins polling and dispatching.

```bash
tasking start [workflow-path] [--port <n>] [--tui] [--detach] [--fresh]
```

| Argument/Option | Description |
|-----------|------|
| `workflow-path` | Path to `WORKFLOW.md`, defaults to `./WORKFLOW.md` |
| `--port` / `-p` | Enable the HTTP dashboard and specify the port; `0` requests an ephemeral port |
| `--tui` | Enable the terminal TUI status panel (logs are written to file only, to avoid contending with the TUI for stderr) |
| `--detach` | Run in the background: the parent process spawns a child then exits, and the child runs independently detached from the terminal |
| `--fresh` | Start as if on a new machine: drop the local intake cursor and reconcile stale bindings against Jira, so the offline window's history is not replayed (effective only when `feishu.enabled`; use when switching back to a machine that kept running elsewhere) |

`--detach` and `--tui` are mutually exclusive. After starting in the background with `--detach`, you can run `tasking tui` in another terminal to attach a TUI and view daemon metrics.

Exit codes:
- `0`: started normally and shut down gracefully on signal; with `--detach` the parent exits after spawning successfully.
- `1`: startup validation failed (e.g. `tracker.kind` missing, credentials missing, `WORKFLOW.md` does not exist).

On receiving `SIGINT` (Ctrl+C) or `SIGTERM`, the daemon stops active workers and exits with `0`.

### `tasking status`

Queries the running daemon's live state via the HTTP dashboard API and prints a human-readable snapshot: running tasks, the retry queue, and aggregate token/runtime totals.

```bash
tasking status [--json]
```

| Option | Description |
|------|------|
| `--json` | Output the raw API JSON, suitable for piping (`tasking status --json | jq .`) |

When the daemon has no HTTP dashboard port configured, it falls back to reporting only the PID status. When no daemon is running, it returns a non-zero exit code.

Exit codes: `0` daemon running; `1` daemon not running or query failed.

### `tasking logs`

Prints recent structured logs. The log file path is resolved in order: `log_path` in `.tasking/daemon.json` (recorded at daemon runtime from the `logging.file.path` config, or the default `tasking.log`) takes precedence, otherwise it falls back to `tasking.log` in the current directory.

```bash
tasking logs [--lines <n>] [--follow] [--level debug|info|warn|error]
```

| Option | Description |
|------|------|
| `--lines` / `-n` | Print the last N lines, default 100 |
| `--follow` / `-f` | Continuously tail the log output; exits on `SIGINT` |
| `--level` | Filter by log level; only JSON lines whose `level` field matches are kept (non-JSON lines are always kept) |

Exit codes: `0` logs present; `1` no log file.

### `tasking stop`

Stops the running daemon process. It reads `.tasking/daemon.json` for the PID, sends `SIGTERM` and waits for a graceful exit (sending `SIGKILL` after a 10s timeout), then cleans up the metadata file.

```bash
tasking stop
```

Exit codes: `0` daemon stopped; `1` daemon not running or stale metadata cleaned up.

### `tasking tui`

Connects to the running daemon's HTTP dashboard API and renders the terminal TUI dashboard (the same view as `start --tui`). Exiting the TUI does not affect the daemon process.

```bash
tasking tui [--port <n>]
```

| Option | Description |
|------|------|
| `--port` / `-p` | Manually specify the dashboard port to connect to. Resolution priority: `--port` → the `port` in the current directory's `.tasking/daemon.json` → fallback `8080`. When specified, you can connect to a daemon on any port of the same host even if you are not in the daemon's start directory or there is no `.tasking/daemon.json`; when unspecified, it reads daemon.json to locate the port, falling back to probing `8080` if neither is present. The host is taken from daemon.json if present, otherwise `127.0.0.1`. |

The TUI shows:
- Summary bar (agents/tps/runtime/tokens)
- Running tasks table (ID/STATE/AGE/TURN/TOKENS/SESSION/EVENT)
- Backoff queue (identifier/attempt/countdown/error)
- Sparkline throughput chart (10-minute trend)
- Recent logs (latest 6 entries, colored by level)

Press `c` to enter the **configuration view** (available for daemons started with `--port`), which shows the effective configuration and runtime attributes currently in effect (workflow path, pid, uptime, workspace root, log path, host:port). Use `j`/`k` to scroll and `Esc`/`q` to return. Secrets (`tracker.api_key`, `feishu.app_secret`, etc.) are uniformly masked as `****`; after a config hot-reload the view reflects it in real time.

Select a running task and press `Enter` to enter the **task detail** view, which shows workspace, session, the current `Agent`/`Model`/`Variant`, turn, tokens, etc. The detail view shows the task **Description** (folded by default to 6 wrapped lines with an `… (N more lines)` marker when longer; press `e` to expand/collapse). From the detail view press `a` to enter the **activity view**, a near-live stream of the task's opencode interactions — assistant text, tool calls, step token deltas — with the model/agent/variant in the header. Tool calls show a one-line friendly summary `🔧 <tool> · <command>/<file>`; failed calls (non-zero exit) are marked with a red `✗`. Use `↑`/`↓`/`j`/`k` to move the selected event, `Space`/`f` to pause/resume follow, and `Enter` to open the **overlay** for the selected event — `text` events show the full text (long text wraps to the terminal width with correct CJK rendering), `tool_use` events show structured execution detail (status/exit code, command/arguments, stdout output, duration; very long output is capped to the last 100 lines with a truncation marker). Scroll inside the overlay with `↑`/`↓`, then `Esc`/`q` to return to the list and again to return to the detail view. Activity data comes from the daemon's in-memory ring buffer (500 events per task cap), cleared when the worker exits. Per-task tokens accumulate live from each `step_finish` and are persisted in the workspace `.tasking-session.json`, so the session's cumulative count survives daemon restarts and retries.

Press `q` or `Ctrl+C` to exit the TUI; the daemon keeps running.

Before entering the TUI it probes `/api/v1/state` connectivity once. Exit codes: `0` normal exit; `1` resolved port unreachable or `--port` is non-numeric (the error includes the resolved port and a `--port` override hint).

### `tasking doctor`

A read-only, whole-chain health check: one command reports every problem. Checks in order (all read-only, seconds to run):

1. **WORKFLOW.md parsing** — front matter parses, what the tracker is;
2. **Feishu** (only when `feishu.enabled: true`) — credential token exchange → three scope probes (list chats / read chat messages / upload file) → intake chat reachability (the bot's chat list contains `intake_chat_id`);
3. **Jira** (only when `tracker.kind: jira`) — connection test (same logic as init's Connection Test, serverInfo only);
4. **opencode** — present on `PATH`.

```bash
tasking doctor [workflow-path]
```

Chinese output with per-item `✓/✗/−/·` marks and remediation hints, plus a summary table at the end. Exit codes: `0` all pass; `1` any failure (scriptable — a single run after a machine switch/reinstall tells you the state). The positional `[workflow-path]` defaults to `./WORKFLOW.md` with the same semantics as `start`/`init` (a directory argument is an error), and `.env` loads from that file's directory; it performs no writes; for scope-remediation pointers (console deep links etc.) see [Feishu App Setup](./feishu-app-setup.md). `tasking init` embeds the same health check in its Feishu collection flow (runs automatically after credential validation; missing scopes warn without blocking) — doctor is for re-checking at any time.

## Credential configuration

### Switching the interface language

tasking's own interface text (Feishu replies/toasts/cards, CLI output, TUI) is bilingual, controlled by a top-level WORKFLOW.md field:

```yaml
interface_language: en   # zh (default) | en; user messages and agent output are unaffected
```

Save the file and it takes effect on the next outbound message (hot reload, no restart). `tasking init --lang en` writes the field into the generated config; `tasking doctor` and `tasking tui` follow it too.

### Jira (structured source)

The Jira adapter uses the Cloud REST v3 API with Basic auth (email + API token):

```yaml
tracker:
  kind: jira
  endpoint: https://your-domain.atlassian.net/rest/api/3
  api_key: $JIRA_API_TOKEN      # 推荐:用环境变量
  api_user: you@example.com      # Basic auth 的 username
  project_key: ENG               # 必需:Jira 项目 key
```

To get an API token: Jira → Account settings → Security → Create and manage API tokens.

`api_key` accepts a literal value or a `$VAR_NAME` indirection. When `$VAR` resolves to an empty string it is treated as missing and triggers a validation error.

### Feishu ↔ Jira comment bridge

> For a step-by-step onboarding (create app / authorize / create group / get chat_id / verification checklist) see the [Feishu onboarding quickstart](./feishu-quickstart.md).

Feishu acts as a comment-synchronization mirror for existing Jira issues: a Feishu thread is bound 1:1 to a Jira issue, mirroring comments in both directions — Jira comments written by the agent are forwarded into the Feishu thread to notify people; messages people post in the Feishu thread are bridged into Jira comments for the agent to read. People stay in Feishu, the agent only knows Jira, and the runtime/agent is untouched (ADR 0002).

**Setup prerequisites:**

1. Create a self-built app on the Feishu open platform, enable the bot capability, and authorize the scopes: `im:message.group_msg` (app-level read of all group messages, no substitute), `im:message` (send messages and read content), `im:chat` (list/create chats), and `im:resource` (file upload; degrades to plain text when missing).
2. Add the bot to a designated group (the intake group) — all issue threads live in this group, and each `/issue` becomes a thread.
3. Get that group's `chat_id` (`GET /im/v1/chats` lists the bot's groups).

```yaml
feishu:
  enabled: true
  app_id: $FEISHU_APP_ID
  app_secret: $FEISHU_APP_SECRET
  intake_chat_id: oc_xxxxxxxxxxxxxxxx   # chat_id of the group above
  forward_interval_ms: 5000            # Jira→Feishu comment mirror cadence, default 5s
  sweep_interval_ms: 43200000          # Sweep loss-backstop cadence, default 12h
  create_issue_type: Task              # default issueType for /issue, listed by init
```

`enabled: false` (default) disables it. When enabled but `app_id`/`app_secret`/`intake_chat_id`/`create_issue_type` is missing, startup validation fails.

**Inbound runs over the event channel; no public ingress port**: receiving is pushed in real time via the official SDK's WS long connection (`im.message.receive_v1`) — unmetered, no exposed port, no webhooks ([ADR 0018](../adr/0018-event-driven-feishu-ingress.md), superseding the REST polling of [ADR 0003](../adr/0003-rest-poll-feishu-ingress.md)). Polling survives as the Sweep backstop: it re-pulls at start, on WS reconnect, and every `sweep_interval_ms` (default 12h), covering offline windows. Feishu→Jira is seconds; Jira→Feishu mirror is ≤ `forward_interval_ms`. A one-time event subscription setup in the developer console is required (see feishu-quickstart 8.1), and only one daemon instance may be online per app.

**Commands** (posted in the intake group or a bound thread):

- `/issue <title>` + optional `<description>` from the 2nd line onward: creates a Jira issue (title→summary, desc→description field; description is optional — a title-only `/issue` creates the issue with an empty description; project/assignee/labels are locked to reuse the tracker config so it gets picked up; type defaults to `create_issue_type` and can be overridden with `--type <name|N>`; `--agent <name>` stamps an `agent:<name>` label at creation time to specify the agent this task uses). `/issue` with no args lists the project's available issueTypes and the default. The command message itself is the thread root. Multi-line descriptions are stored correctly per API version (v2 string / v3 ADF paragraphs), with no extra first comment written (ADR 0009).
- `/chat <project> <msg>` / `/chat /abs/path <msg>`: creates an opencode direct session in a fixed directory (intake group only; requires `feishu.direct` config, see below). The command message is the thread root and its message is the first-turn prompt; afterwards **just reply inside the thread to continue** (follow-ups sent while a turn is running are queued and merged into the next run), `/stop` inside the thread interrupts the current task, `/done` ends the session (and deletes the underlying opencode session, matching idle-TTL expiry). Each turn posts one completion text; the process level is configurable via `feishu.direct.verbosity`: `quiet` (final text only) / `summary` (text + stats line) / `detailed` (default; one **process card** per turn: collapsible tool panels, failures expanded, header showing session name/status/cumulative tokens — panels need Feishu/Lark client >= V7.9, older clients render an upgrade placeholder and can set `summary` explicitly; the card is sealed into a plain record when the turn ends and the next turn gets a fresh one, plus a **markdown result card** carrying the full answer — under `summary`/`quiet` the result stays plain text). One thread maps strictly to one opencode session; after a daemon restart the mapping is restored from the `direct_sessions` table. `tasking stop`/Ctrl-C immediately aborts in-flight direct turns (SIGKILL of the child process tree; the thread's card is sealed as interrupted and queued follow-ups are dropped); if the process is hard-killed (`kill -9`) before it can abort, restart recovery covers it (the session is marked idle and the thread is told to re-send). Active direct sessions appear in the TUI as a separate **Direct sessions** block showing each session's name (first prompt), status, age, tokens, and queue depth, with an active-session count (`(N)`, plus `· R running` while a turn is in flight) (cycle focus with `←/→`/Tab; `Enter` opens the direct detail, `a` reuses the activity view; direct session tokens are included in the home `Tokens:` total). They never affect the Jira running/retry list. Direct sessions and the Jira path do not affect each other.
  - **How the turn completion message is formed**: it is neither prompt-constrained nor a second LLM summarization pass — tasking assembles it mechanically from the polled session messages: the body is the turn's last assistant text message (the model's natural reply to your message — your message is the prompt, no extra template); the trailing stats line (`⏱ duration · 🔧 tool calls · ≈tokens`) comes from tool-entry counts, message tokens and timing (total = input+output+reasoning, see ADR 0037); over 3500 chars it is truncated. Failure/timeout notices are composed by tasking itself.
- `/chat`: lists configured projects and path-mode usage.
- **Direct rich input**: sending **images/files** directly in the thread (including a "text + screenshot" post) downloads them into a tasking-owned inbox (`<workspace.root>/direct-inbox/`, 20MB per attachment, oversized/failed downloads are reported) and hands the absolute path to the agent — logs/CSV/code are immediately useful, screenshots depend on the model's vision. **Merged forwards** are handled by the existing parsing; a "forward with comment" arrives as two messages (one turn each) — collect them with `/collect` then `/send` when they belong in one turn.
- **In-thread commands**: `/auto [on|once|off]` (view/switch this session's permission posture via the session ruleset, **effective immediately**), `/agent <name>`, `/model <name>` (switch this session's agent/model, `reset` restores the configured default), `/collect` → `/send` (collect several messages, attachments included, and submit them as **one** turn; `/cancel` discards; auto-submits after 10 idle minutes; the buffer is in memory and is lost on restart), `/name <text>` (rename this session; shown in the card header and TUI; no argument reports the current name), `/new` (clear the context, start a fresh session, and delete the abandoned opencode session), `/status` (reply with a session dashboard card), `/stop`, `/done`, `/help`. Informational commands (`/help`, `/auto` view, `/collect` state, `/agent`/`/model` view) reply with a **card**; the `/auto` and `/collect` state cards carry action buttons (permission on/off, start/submit/discard collection) that execute on click and refresh that card in place, falling back to plain text when cards are unavailable. Transient acknowledgements (e.g. `📥 已收集 N 条`, attachment-failure warnings, unknown-command hints) stay plain text. These overrides apply to **this session only**, never write WORKFLOW.md or the target's `.opencode`; the permission posture takes effect immediately via `session.update`. Every turn logs one `direct turn starting` line in `tasking.log` (with `dir`/`agent`/`model`/`auto_approve`/`session_id`/`poll_interval_ms`) so what was actually passed can be checked turn by turn.
- **Direct-session card controls** (`verbosity: detailed`): the turn card's footer offers `⏹ Interrupt` (running turn only), `🔁 Retry` (re-runs the latest turn's prompt), `📄 Full output` (sends the latest turn's complete tool detail as a `.md` file in the thread; falls back to a long text message when upload is unavailable, then to a pointer at the TUI activity view), `🔐 Permission` (a confirm row offers session / next-turn-only / cancel; when already open the same button closes it immediately; the header always shows `🔓 auto` / `⚡ 下轮放开` / `🧠 <agent>`), and `🛑 End` (two-step confirm, then ends the session and deletes the underlying opencode session; the confirm step keeps the rest of the card). Buttons coexist with the slash commands and any group member may use them. Lifecycle messages name the operator with their **group display name** (resolved from the intake group's member list and cached; falls back to the open_id). When cards are unavailable, that turn's process degrades to coalesced text messages.
- **Synchronous permission approval** (new in 0.7): when the target directory's `.opencode` config marks an operation `ask` and the permission posture is not open, the agent **pauses** on that operation and tasking posts an **approval card** into the session thread (`✅ Allow once` / `♾️ Always allow` / `✖ Reject`); a click resumes the turn immediately via `session.permission.reply`. "Always allow" is saved by the opencode server per command pattern (machine-level, across sessions). The wait budget defaults to 30 minutes (`opencode.permission_timeout_ms`), then auto-rejects and stamps the card; the card is stamped in place after reply/timeout/interruption and kept as a record. Jira tasks post approval cards into their bound thread (effective when `auto_approve: false`, see [Configuration](./configuration.md)).
- **One-time console setup** (needed for the full `detailed` surface): ① grant the `im:resource` scope (`📄` file upload); ② add the `card.action.trigger` callback under "Events & callbacks" (subscription mode = long connection, for buttons). Both fit in a single "create version → publish" pass; without them cards still send and update, and `📄` degrades to text.
- **Manual acceptance** (button clicks cannot be automated): under `verbosity: detailed`, send a `/chat`, then click `⏹ Interrupt`, `🔁 Retry`, `📄 Full output`, `🔐 Permission` (the confirm row) and `🛑 End` (two-step confirm), checking the card state, the completion texts and the operator attribution.
- `/state`: posted in a bound thread, replies with a **task state card** in recall style (issue key + current state + assignee, with `🔀 转状态`, `🔄 Refresh` (re-queries and replaces the card in place) and `打开 Jira` buttons): every publish first deletes the previous state card and sends a fresh one at the topic bottom, so the card never gets lost under piled-up messages (send `/state` again to bring it back). Clicking `🔀` fetches the currently available transitions **live** and renders one button per transition; picking one opens a confirm row (confirm/cancel) and only confirming writes to Jira — after which the scheduler is nudged immediately, the state card is refreshed and the result is broadcast in the thread (cancel writes nothing). `/state <N|name>` remains available and shares the same transition logic (queried from Jira at runtime, no hardcoded state names).
- `/agent`: queries the default agent (`opencode.agent`) + the configured catalog (`opencode.agents`; if empty, it reports unconfigured); inside a bound thread it also shows the agent currently resolved for that task. `/agent <name>` switches the task's agent inside the thread (changing the `agent:<name>` label, **taking effect at the next turn boundary** — the current turn is not interrupted); `/agent default` clears the agent label and falls back to the default. `/agent <name>` in the intake group prompts that it must be used inside a thread. See ADR 0011.
- `/help`, the `/agent` list: reply with a **card** (falling back to plain text when cards are unavailable).
- **Non-command free text** (a root message in the intake group): replies with a "已收到"-type acknowledgment (including `/issue` and `/help` hints); it does not enter Jira and creates no binding. Free text **inside a bound thread** is bridged into a Jira comment, mirrored on the Jira side as a **card** (author header + body, plus `打开 Jira` and `📋 状态`, which summons a live state card at the topic bottom; when the body exceeds the 24KB card budget it is truncated and gains a `📄 Full output` button that delivers the whole comment as a `.md` file in the thread). On success it replies "✅ 已收到，已同步到 {issue_key}" (`reply_in_thread` under that message), and on a write failure (non-404) it replies "⚠️ 同步失败，请稍后重试"; the acknowledgment is sent by the bot and auto-skipped in the next poll round, with no echo-back and no re-bridging.

**Deduplication**: Jira comments bridged over carry a visible sentinel `💬 {sender} via 飞书 [msg:{id}]:` (which also conveys attribution); the forwarder uses it to skip and not echo back (tasking and the agent share the Jira account and cannot distinguish by author, ADR 0004). Comments people post directly in Jira (no sentinel) are forwarded to Feishu for completeness. On reaching terminal it sends a "✅ 已完结" ack + stops syncing; a reopen continues in the same thread. The v1 message semantics cover `text` and `post` (rich text is flattened to plain text; multi-line `/issue`/thread free text works); image/edit/delete syncing is deferred.

## Workspaces and hooks

### Workspace path

Each task gets an independent workspace, with a path of `<workspace.root>/<sanitized_identifier>`. Characters in the identifier that are not in `[A-Za-z0-9._-]` are replaced with `_`.

```yaml
workspace:
  root: ~/tasking_workspaces   # 支持 ~ 与 $VAR
```

The default root is `<system temp dir>/tasking_workspaces`. Relative paths are resolved relative to the directory containing `WORKFLOW.md`.

### Lifecycle hooks

`WORKFLOW.md` can configure four hooks:

| hook | When triggered | Failure semantics |
|------|----------|----------|
| `after_create` | Only when the workspace directory is newly created | Failure aborts workspace creation |
| `before_run` | Before each attempt | Failure aborts the current attempt |
| `after_run` | After each attempt | Failure is only logged, does not affect the result |
| `before_remove` | Before deleting the workspace | Failure is only logged; deletion proceeds |

Hooks execute with `bash -lc` in the workspace directory (cwd), constrained by `hooks.timeout_ms` (default 60000ms).

```yaml
hooks:
  timeout_ms: 60000
  after_create: |
    echo "workspace created"
    # 可在此 clone 代码、安装依赖等
  before_run: |
    echo "preparing run"
```

## Skill system

tasking supports opencode skill files (`.opencode/skills/<name>/SKILL.md`), which provide structured operational guidance for the agent. Skill files are placed in the dev repo in advance and enter the workspace via the `after_create` hook's `git clone`; tasking does not inject them.

### Built-in skill templates

The tasking repo's `assets/skills/` directory ships 7 reference skill templates you can copy into your own dev repo:

| Skill | Purpose | Prerequisites |
|------|------|---------|
| `commit` | Conventional git commit (type prefix, imperative subject, 72-column body) | git |
| `pull` | Merge origin/main into the feature branch + conflict resolution | git |
| `push` | Push a branch + create/update a GitLab MR | `glab` CLI |
| `debug` | tasking log correlation tracing | `tasking.log` |
| `land` | GitLab MR landing (CI monitoring + review + squash-merge) | `glab` CLI + Python 3 |
| `install-glab` | Idempotent self-install of `glab` (releases API download to `~/.local/bin`, or brew/snap/scoop) | Network |
| `jira` | Jira interactions (transitions, comments, attachments, labels) | `jira_rest` + `jira_upload_attachment` MCP tools |

### Usage

1. Copy the skills under `assets/skills/` into your dev repo's `.opencode/skills/` directory
2. Customize the skill contents to your repo's needs
3. Ensure the `after_create` hook runs `git clone` (the default config already includes it)
4. The WORKFLOW.md prompt body references all 7 skills (pull/commit/push/debug/land/install-glab/jira)

### glab CLI prerequisites

The `push` and `land` skills require the `glab` CLI to be available:

```bash
# 验证 glab 已安装并认证
glab auth status

# 缺失时两种途径：
# 1) agent 侧：在目标仓库工作区运行 install-glab 技能（tasking init 已装入 .opencode/skills/）
# 2) 手动：brew install glab / snap install glab / scoop install glab
#    或下载官方二进制: https://gitlab.com/gitlab-org/cli/-/releases
```

## Prompt template

The prompt body of `WORKFLOW.md` (the content after the front matter) is the per-task prompt template, rendered with strict Liquid-compatible syntax.

### Variables

| Variable | Type | Description |
|------|------|------|
| `task` | Object | The normalized task entity, with fields including `identifier`, `title`, `description`, `priority`, `state`, `labels`, `blocked_by`, etc. |
| `issue` | Object | An alias for `task`; equivalent |
| `attempt` | Integer or null | `null` on the first try; an integer on retries/continuation turns |

### Tags

Supports `if`/`else`/`endif` conditional blocks:

```liquid
{% if task.description %}
描述:
{{ task.description }}
{% else %}
无描述
{% endif %}

{% if attempt %}
这是第 {{ attempt }} 次尝试。
{% else %}
这是首次尝试。
{% endif %}
```

### Filters

Supports filters such as `upcase`, `downcase`, `trim`. Unknown filters cause rendering to fail.

### Strict mode

- Unknown variable → rendering fails, the attempt fails.
- Unknown filter → rendering fails, the attempt fails.
- When the prompt body is empty, it falls back to the default prompt (`You are working on an issue from the tracker.`).
- A `WORKFLOW.md` file read/parse error does not fall back; it prevents startup.

## Typical scenarios

### Scenario 1: Jira structured only

Minimal config, dispatching only Jira tasks:

```yaml
---
tracker:
  kind: jira
  endpoint: https://example.atlassian.net/rest/api/3
  api_key: $JIRA_API_TOKEN
  api_user: you@example.com
  project_key: ENG
  active_states:
     - 待办
     - 处理中
     - 合并中
     - 重置处理
   terminal_states:
     - 完成
     - 关闭
polling:
  interval_ms: 30000
agent:
  max_concurrent_agents: 5
opencode:
  command: opencode
  agent: build
---
你正在处理一个 Jira 任务:{{ task.identifier }}

{{ task.title }}
```

### Scenario 2: Jira + Feishu dual sources

Enable both structured dispatch and the Feishu comment bridge:

```yaml
---
tracker:
  kind: jira
  api_key: $JIRA_API_TOKEN
  api_user: you@example.com
  project_key: ENG
feishu:
  enabled: true
  app_id: $FEISHU_APP_ID
  app_secret: $FEISHU_APP_SECRET
  intake_chat_id: oc_xxx
  create_issue_type: Task
---
处理任务 {{ task.identifier }}:{{ task.title }}
```

Jira issues are dispatched by the scheduler; Feishu threads are bound 1:1 to issues and mirror comments in both directions. Issues people create via `/issue` in Feishu also enter the scheduler for dispatch.

### Scenario 3: Enable the HTTP dashboard

```bash
tasking start --port 8080
```

Or via config:

```yaml
server:
  port: 8080
```

After startup, visit:
- `http://<host>:8080/`: human-readable dashboard.
- `http://<host>:8080/api/v1/state`: JSON runtime state snapshot.
- `http://<host>:8080/api/v1/<issue_identifier>`: per-issue runtime details (workspace path, retry state, tokens).
- `http://<host>:8080/api/v1/refresh`: triggers one poll + reconcile (POST, returns `202`).

`--port` overrides the `server.port` config. `server.host` controls the bind address (default `0.0.0.0`). Unsupported methods return `405`. The dashboard is not involved in correctness; orchestration still runs normally when it is off.

### Scenario 3b: Enable the terminal TUI status panel

```bash
# 方式一:前台启动 + TUI
tasking start --tui

# 方式二:后台启动,再附加 TUI
tasking start --detach
tasking tui
```

The TUI renders an ANSI-colored status screen on stderr:
- Summary bar (agents/tps/runtime/tokens)
- Running tasks table (ID/STATE/AGE/TURN/TOKENS/SESSION/EVENT)
- Backoff queue (identifier/attempt/countdown/error)
- Sparkline throughput chart (10-minute trend)
- Recent logs (latest 6 entries, colored by level)

When the TUI is enabled, logs are written to file only (`tasking.log`), not stderr.

### Scenario 4: Upload attachments to a Jira task

After completing a task, the agent can use the `jira_upload_attachment` tool to upload artifacts (screenshots, logs, test reports, etc.) to the Jira task. This tool is provided by `tasking`'s MCP server and reuses the tracker credentials already configured in WORKFLOW.md.

Example call:

```
jira_upload_attachment({ issue_key: "OS-262", filename: "screenshot.png", content: "<base64>" })
```

The `content` parameter is the file's base64-encoded string. The agent can generate it with:

```javascript
const fs = require("fs");
const content = fs.readFileSync("path/to/file").toString("base64");
```

The attachment size limit is 10MB (after base64 encoding); exceeding it is rejected. This step is optional — it runs only when there are artifacts to upload, and the WORKFLOW.md starter template already references the `jira` skill to perform it. For the full usage guide see the `jira` skill (`assets/skills/jira/SKILL.md`).

### Scenario 5: Multi-agent per-task routing

`opencode.agent` (default `build`) is always the fallback; the optional `opencode.agents` catalog lists known profiles for the `/agent` command to display. The per-task agent is specified by a Jira `agent:<name>` label — the worker re-resolves it each turn from the refreshed Task; with no label it uses the default, and an unknown name (not in a non-empty catalog) warns and falls back to the default without blocking dispatch.

```yaml
opencode:
  command: opencode
  agent: build              # fallback default
  agents: [build, review]   # advisory catalog (optional; empty = no validation)
```

Three ways to set/switch it, all operating on the same `agent:<name>` label (single source of truth):

- **Set at creation**: `/issue --agent review Title\nDescription` → stamps the `agent:review` label when creating the issue.
- **Edit directly in Jira**: add the `agent:review` label to the issue; takes effect on the next dispatch tick.
- **Switch at runtime**: in the issue's Feishu thread, `/agent review` → changes the label, **taking effect at the next turn boundary** (the in-flight turn finishes first, then the worker re-resolves the agent from the refreshed Task). `/agent default` clears the label and falls back to the default.

`/agent` (no args) anywhere lists the default + catalog; inside a bound thread it also shows the task's current agent. See ADR 0011.
