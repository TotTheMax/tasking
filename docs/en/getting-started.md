# Getting Started

The shortest path to a running tasking. Two routes: **Feishu direct** (the default, ~5 minutes, no Jira) and **connect Jira** (the scheduler polls Jira issues and dispatches). Practical first; details live in the topical pages.

> tasking is a daemon: by default it runs in **Feishu-direct** mode — `/chat` in a group runs the opencode coding-agent in a configured directory; connecting Jira adds structured scheduling (the **grill-openspec** four-phase variant is a common choice — see [State Flow](./state-flow.md)).

## Prerequisites

| Item | Check |
|------|-------|
| Node.js 22+ | `node --version` ≥ v22 |
| opencode CLI on `PATH` | `opencode --version` (see [opencode.ai](https://opencode.ai)) |
| Feishu custom-app admin | required for the direct mainline (below) |
| Jira account | only when connecting Jira (chapter 2) |

## Step 1: install from npm

tasking is published on public npm as a scoped package. Install globally (requires Node 22+):

```bash
npm install -g @tothemax/tasking
tasking --help
```

# Fastest path: Feishu direct (default, ~5 minutes)

No Jira needed: create a Feishu app → `tasking init` with enter-enter-enter → `tasking start` → `/chat` in the group.

## 1.1 Create the Feishu custom app

[https://open.feishu.cn](https://open.feishu.cn) → developer console → create an enterprise custom app (e.g. `tasking`). Note the **App ID** (`cli_xxx`) and **App Secret**. Add the **bot** capability, then grant the 5 scopes:

| Scope | Purpose |
|------|---------|
| `im:message.group_msg` | app-level group message read (receiving messages, required, no substitute) |
| `im:message` | send/reply as the bot and read message content |
| `im:chat` | list the bot's chats (init's chat picker / one-click creation) |
| `im:resource` | attachment upload (degrades to plain text when missing) |
| `contact:user.id:readonly` | adds you to a newly created chat (manual chat creation when missing) |

On the **Events & Callbacks** page, **configure both blocks with long connection**: **Event configuration** — add `Receive message im.message.receive_v1`; **Callback configuration** — subscribe to `Card interaction callback card.action.trigger`.

Version management → create version → publish, admin approves (unapproved apps get 403 from APIs). Create a group (e.g. `tasking-intake`) and add the bot to it. **Personal Feishu needs no third-party approval — fully self-service**; for the complete steps, permission list, event subscription, and an error→missing-step table see [Feishu App Setup](./feishu-app-setup.md). Troubleshooting details: [Feishu quickstart](./feishu-quickstart.md).

## 1.2 tasking init (just press enter)

In any directory:

```bash
tasking init
```

The question flow (the default path only needs the three Feishu values plus an optional project):

1. **Task source**: enter = Feishu direct only (connecting Jira is chapter 2)
2. **Template language**: enter = Chinese
3. **Feishu app_id / app_secret**: init **validates on the spot** (token exchange; failures print a human-readable reason and let you re-enter the secret)
4. **Pick the intake group**: after validation the bot's chats are listed; enter picks the first
5. **Common project name (skippable)**: if filled, also enter its absolute directory — `/chat <project> <message>` works immediately and `path_roots` tightens to that directory; skipping keeps `/chat /abs/path <message>` and the completion hint warns that path mode is unrestricted

The completion hint prints your next command.

## 1.3 Start + first command

```bash
tasking start --tui    # foreground TUI; Ctrl+C stops (in-flight turns are aborted immediately and sealed interrupted)
```

In the intake group send:

```text
/chat <project> help me look at this error
```

`<project>` is the **directory alias** you entered at §1.2 question 5 (if you typed `tasking`, the command is `/chat tasking help me look at this error` — it is the name you gave your working directory, **not a tasking subcommand**). If you skipped that question, use the path form `/chat /abs/path <message>`.

The bot creates a topic and starts opencode; on completion you get a summary plus a stats line. **Reply inside the topic to continue** (follow-ups queue and merge into the next turn).

## 1.4 Common in-thread commands

| Command | Effect |
|---------|--------|
| plain reply | continue (follow-ups queue while a turn runs) |
| `/collect` → `/send` | gather several messages (attachments included) into one turn |
| `/auto [on\|once\|off]` | this session's permission posture (next turn) |
| `/agent <name>` / `/model <name>` | switch this session's agent / model (`reset` restores defaults) |
| `/name <text>` / `/status` / `/new` | rename / status card / fresh context |
| `/stop` / `/done` / `/help` | interrupt / end session / help |

All commands and behaviors: the direct-sessions section of the [usage guide](./usage.md).

# Chapter 2: connect Jira

On top of (or instead of) direct sessions: the scheduler polls Jira issues and dispatches; the agent works in a per-issue workspace.

## 2.1 Prepare the Jira PAT

The internal Jira is **self-hosted** (Jira Server): Personal Access Token + bearer auth (not Cloud's email+API token):

1. Log in → avatar → **Personal Access Tokens** → **Create token**.
2. Copy and save it (shown once).
3. It goes into `WORKFLOW.md` next (plaintext is fine; `$JIRA_API_TOKEN` references also work).

## 2.2 tasking init --workflow grill-openspec

In the root of the **target dev repo** (the repo you want the agent to work in):

```bash
tasking init --workflow grill-openspec
```

(Equivalent: pick 「接 Jira」at the task-source question, then `grill-openspec`.) Interactive init collects the Jira endpoint/token/project key, tests the connection, and writes `WORKFLOW.md` + `.opencode/skills/` (`land`/`install-glab` + 4 opsx skills). `--force` overwrites an existing `WORKFLOW.md`.

> grill-openspec four phases: **grill** (post clarifying Jira comment, go review) → after answers **implement** (propose+implement+MR, go review) → after review **merge** (land+archive, terminal). Rework resumes without re-grilling. Phase routing is agent-judged inside the prompt body, no hardcoded state names. See [State Flow](./state-flow.md).

## 2.3 Check the minimal WORKFLOW.md

After the connection test, init **maps your project's real statuses and prefills** `active_states`/`terminal_states`/`review_state` (a proposal is printed; enter confirms, declining keeps the defaults). The generated file also comments out optional sections (only required ones stay active). Open `WORKFLOW.md` and make sure the `tracker` block is at least (internal self-hosted values):

```yaml
tracker:
  kind: jira
  endpoint: http://192.168.10.17:50050/rest/api/2
  api_key: $JIRA_API_TOKEN     # Jira PAT; plaintext or $VAR env reference
  api_user: null                    # not needed for bearer
  auth_mode: bearer                 # self-hosted PAT
  review_state: 代码评审中            # review handoff state, see below
  project_key: TAS                  # your project key
  active_states:                    # candidates: only these states dispatch
    - 待办
    - 处理中
    - 合并中
    - 重置处理
  terminal_states:                  # terminal: no dispatch; workspace cleaned at startup
    - 完成
    - 关闭
    - 取消
    - 重复
polling:
  interval_ms: 30000
workspace:
  root: ~/tasking_workspaces
hooks:
  # Clone the target repo into each new workspace — without code the agent can do nothing. Required.
  # Prereq: the daemon host's SSH key can read the repo.
  after_create: git clone ssh://git@192.168.10.180:2222/ai-agent-infra/tasking.git .
env:
  # glab reads GITLAB_TOKEN for MR creation / push. Plaintext or $GITLAB_TOKEN.
  GITLAB_TOKEN: glpat-xxxxxxxxxxxxxxxxxxxx
  GITLAB_HOST: 192.168.10.180
opencode:
  command: opencode run
  agent: build
```

**Three required blocks to actually run**: `tracker` (pull issues) + `hooks.after_create` (clone the repo into workspaces) + `env.GITLAB_TOKEN` (push/MR). Missing any one leaves the agent without tasks, code, or push access.

**Three-tier state model** (the scheduler buckets by state name; names must match your Jira workflow):

| Bucket | Meaning | Here |
|--------|---------|------|
| **active** | dispatched, worker running | 待办 / 处理中 / 合并中 / 重置处理 |
| **review** | worker stopped, workspace kept, awaiting a human | 代码评审中 (= `review_state`) |
| **terminal** | not dispatched; workspace removed | 完成 / 关闭 / 取消 / 重复 |

`review_state` stays out of `active_states`/`terminal_states` and becomes the implicit review bucket — the agent moves the issue there after opening an MR; the scheduler stops the worker but keeps the workspace. The model and the two rework paths: [State Flow](./state-flow.md); all fields: [configuration](./configuration.md); full example: [WORKFLOW.grill-openspec.md.example](../../assets/workflows/WORKFLOW.grill-openspec.md.example).

## 2.4 Start + verify

```bash
tasking start --tui    # foreground TUI; Ctrl+C stops
tasking status         # another terminal: running/retry snapshot
tasking logs -f        # follow logs (TUI mode writes only to tasking.log)
```

Create a dispatchable Jira issue to verify:

- [ ] project = the `project_key` in `WORKFLOW.md`
- [ ] state ∈ `active_states`
- [ ] assignee / labels satisfy the config
- [ ] dispatch appears in `tasking logs -f` within `polling.interval_ms` (default 30s)
- [ ] a workspace is created (default `<tmp>/tasking_workspaces/<TAS-xxx>`) and opencode runs

That's the Jira path working. Under grill-openspec the agent judges its phase from issue artifacts (grill/implement/merge); you answer in review and review MRs.

## 2.5 (Optional) Feishu ↔ Jira comment bridge

On top of the Jira path: mirror issue topics ↔ Jira comments bidirectionally (`/issue` creates issues from the group). App preparation is the same as 1.1; enable the bridge in init's connect-Jira branch (or edit the `feishu:` block in `WORKFLOW.md` by hand). Step-by-step troubleshooting: [Feishu quickstart](./feishu-quickstart.md).

## Next steps

| Want | Where |
|------|-------|
| All config fields | [Configuration](./configuration.md) |
| All commands / exit codes | [Usage](./usage.md) |
| State model / rework paths | [State Flow](./state-flow.md) |
| Timeouts / retry backoff | [Timeout model](./timeout-model.md) |
| Architecture / safety invariants | [Architecture](./architecture.md) |
| Source development / release | [Development](./development.md) |
| Glossary | [CONTEXT.md](../../CONTEXT.md) |
| Docs index | [Index](./index.md) |
