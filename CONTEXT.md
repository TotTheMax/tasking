# Tasking

A TypeScript CLI daemon that orchestrates opencode coding-agent work from structured (Jira) and unstructured (Feishu) task sources, converging on a shared normalized Task model and a shared per-task workspace.

## Language

### Task sources & dispatch

**Task**:
A unit of work normalized from a tracker (Jira issue) or inbox (Feishu message), dispatched to an opencode worker.
_Avoid_: Issue, ticket, item

**Tracker**:
The structured task source (currently Jira) that the scheduler polls for candidate issues and state transitions. Absent when `tracker.kind: none` — a deployment running Feishu direct sessions only.
_Avoid_: Source, backend

**Topic partition (话题二分)**:
The invariant that every topic in the intake group is either a Jira-bound topic (comment bridge) or a direct-session topic — never both, never a third kind. Basis for routing card actions by their `kind` tag.
_Avoid_: Mixed topic, hybrid topic

**Attempt**:
A single dispatch of a Task to a worker; `null` on first dispatch, incremented on retry. One attempt may span multiple turns.
_Avoid_: Run, iteration

**Turn**:
One invocation of `opencode run` within an attempt; the worker loops turns up to `max_turns`, persisting the opencode session between turns.

**Workspace**:
A per-task directory (a cloned repo) where the agent runs; preserved across review pauses, removed on terminal.

### State model

**Active state**:
A tracker state listed in `active_states`; the scheduler dispatches and keeps the worker running here.
_Avoid_: Open state

**Review state**:
A tracker state in neither `active_states` nor `terminal_states` (implicit); the scheduler stops the worker but preserves the workspace, waiting for a human decision.
_Avoid_: Pending state, blocked

**Terminal state**:
A tracker state listed in `terminal_states`; the scheduler stops the worker and removes the workspace.

### Workflows

**Workflow (tasking)**:
A `WORKFLOW.md` file: YAML config frontmatter + a Liquid prompt body. Variants share one config schema and differ in the prompt body and, for `feishu-direct`, the task-source selection.
_Avoid_: Pipeline, process

**Workflow variant**:
One of `minimal`, `code-mr`, `grill-openspec`, or `feishu-direct` — the starter template `tasking init --workflow <variant>` writes into `WORKFLOW.md`. Each variant also fixes which tasking-owned skills `init` installs and which sentinel marker its prompt body carries for `detectWorkflow`.
_Avoid_: Workflow type, flavor

**minimal**:
The smallest Jira workflow variant: do the task in the working directory → upload results to Jira (comment + attachments) → transition active→terminal. No git branch, no merge request, no `glab`, no review pause, no installed skills. Its template (`WORKFLOW.minimal.md.example`) carries no sentinel marker (the `detectWorkflow` fallback). Renamed from `default` when feishu-direct became init's default variant.
_Avoid_: default, basic workflow, simple workflow

**code-mr**:
A workflow variant that drives the full VCS flow — branch from origin/main → write code → create a GitLab MR via `glab` → review (incremental fix / full reset) → `land` merge. Installs `land` + `install-glab`. Its template (`WORKFLOW.code-mr.md.example`) carries the `<!-- tasking-workflow: code-mr -->` sentinel. Formerly the pre-split default behavior.
_Avoid_: Git workflow, MR workflow

**grill-openspec**:
A workflow variant that runs four skills in sequence — `opsx-grill-with-docs`, `opsx-propose-with-tdd`, `opsx-implement`, `openspec-archive-change` — with two human review pauses (after grill, after MR). Installs `land` + `install-glab` + the four opsx skills. Its template (`assets/workflows/WORKFLOW.grill-openspec.md.example`) carries the `## 🔍 拷问 / Grill Questions` marker.

**feishu-direct**:
The workflow variant for Feishu-direct-only deployments, and init's default: writes `tracker.kind: none` + feishu enabled, installs no skills. The only variant distinguished by config rather than prompt body; its prompt body is a two-line user-facing note (direct sessions take the user's message as prompt; switch to a Jira source by re-running init). Carries the `<!-- tasking-workflow: feishu-direct -->` sentinel.
_Avoid_: Feishu mode, bridgeless mode

**Sentinel marker (workflow)**:
A string in a starter template's prompt body that `detectWorkflow` reads to identify the variant for `--update` drift reporting: `<!-- tasking-workflow: feishu-direct -->` → `feishu-direct`; `## 🔍 拷问 / Grill Questions` → `grill-openspec`; `<!-- tasking-workflow: code-mr -->` → `code-mr`; none → `minimal`. Lives in the prompt body (no schema/runtime change), honoring ADR 0001.
_Avoid_: Workflow tag, variant tag

**Template language (模板语言)**:
The written language of a starter template — `zh` (Chinese, canonical) or `en` (English); orthogonal to the workflow variant (any variant × any language). Chosen at `tasking init` time and re-detected by `init --update` so drift reports compare like with like.
_Avoid_: Locale, i18n, translation

**Interface language (界面语言)**:
The single configured language (`interface_language`, `zh`|`en`) tasking renders its own authored text in — Feishu replies, toasts, cards, CLI output, TUI. Seeded into WORKFLOW.md frontmatter by `init --lang`; user and agent content is never translated regardless of it. Distinct from Template language, which is only the written language of the starter template body.
_Avoid_: Locale, i18n, translation, reply language

**Phase**:
A runtime working segment within grill-openspec: grill, implementation, or merge. The agent determines its phase from artifacts (not the state name) plus state semantics, falling back to Jira comments and tool queries.

**Grill comment (拷问 comment)**:
A Jira comment with a marked header batching the agent's open decision questions; posted during the grill phase or a mid-run escalation, after which the task transitions to review.

**Mid-run escalation**:
The agent pausing mid-phase on a truly blocking decision by posting a grill comment and transitioning to review, resuming after the human answers.

### Init & update

**Workflow path (工作流路径)**:
The path to the WORKFLOW.md file a command operates on, defaulting to `./WORKFLOW.md`; `start` and `doctor` read it, `init` writes or updates it. Its directory is the base for the sibling `.opencode/skills/`, `.tasking/`, and `.bak` artifacts — so a custom path relocates config and its companions together.
_Avoid_: Config path, workflow file location, config directory

**Init (初始化)**:
`tasking init` writes WORKFLOW.md from the selected workflow template to the workflow path and installs tasking-owned skills into the same directory's `.opencode/skills/`.
_Avoid_: Setup, scaffold

**Skill ownership**:
The `.opencode/skills/` contents are tasking-owned: the canonical source is `assets/skills/` (shipped with the package), and users are not expected to hand-edit them.
_Avoid_: User skills, custom skills

**Workflow file ownership**:
WORKFLOW.md is user-owned — it holds credentials, state names, hooks, and env that tasking must never auto-overwrite.
_Avoid_: Managed config, auto-managed

**Skill backup**:
A byte-modified user copy of a skill file saved beside the overwrite as `<file>.bak` during `init --update`, so the user can inspect or roll back the change.
_Avoid_: Restore point, snapshot

**Drift baseline (漂移基线)**:
The config-key set `init --update` compares the user's WORKFLOW.md against: what a fresh init for the detected (or `--workflow`/`--lang`-overridden) variant × language would write today, mirroring the user's own `feishu.enabled` choice — never the raw template. Sections the generator trims by design therefore never count as drift.
_Avoid_: Template baseline, raw-template diff

**init --update (技能/配置更新)**:
The non-destructive `tasking init --update` operation that re-syncs all tasking-owned skills from `assets/skills/` (installing missing ones; a byte-modified user version is first backed up as `<file>.bak` with a warning, then overwritten) and reports drift on the user-owned WORKFLOW.md at the workflow path — fields missing vs the drift baseline (with defaults) and a prompt-body diff — without writing to it.
_Avoid_: Upgrade, force-reinit

**init --restore (技能回撤)**:
`tasking init --restore` rolls back `--update`: every `.bak` skill backup in `.opencode/skills/` is renamed back over the current skill file, restoring the pre-update user version.
_Avoid_: Uninstall, revert-to-template

### Feishu↔Jira bridge

**Binding**:
A durable 1:1 mapping from a Jira issue to a Feishu thread (root message) plus sync cursors; the routing key for all comment/message mirroring.
_Avoid_: Link, association

**Thread (话题)**:
A Feishu reply chain under one root message; the binding unit — one issue's whole discussion lives in one thread, inside the intake group.
_Avoid_: Topic, conversation

**Intake group**:
The single configured Feishu group (`feishu.intake_chat_id`) hosting every issue's thread and where `/issue` is accepted; bounds intake discovery so no multi-group scan is needed.
_Avoid_: Bot group, default chat

**Sentinel**:
The visible prefix `💬 {sender} via 飞书 [msg:{id}]:` on a Jira comment bridged from Feishu; doubles as attribution and the marker the Jira→Feishu forwarder skips to prevent loops.
_Avoid_: Marker, tag

**CommentBridge**:
The sibling daemon component (own timer, dependency-injected) that mirrors Jira comments ⇄ Feishu threads bidirectionally and handles `/issue` `/state` `/help`; the scheduler and agent are untouched.
_Avoid_: Router, sync service

**Task state card (任务状态卡)**:
One Feishu card per binding showing the issue key, current state and assignee, with `🔀 转状态` and `打开 Jira` buttons; its message id is stored on the binding and it is patched in place when the state changes, re-published if the patch fails. Distinct from a comment card, which mirrors a single Jira comment.
_Avoid_: Status page, dashboard card

**Intake cursor (入站游标)**:
The durable time cursor (`bridge_meta.intake_cursor`) marking how far the intake poll has consumed root messages in the intake group; `discoverIntake` resumes from it each tick.
_Avoid_: Last poll time, watermark

**Intake seen-id (入站已见清单)**:
The durable, bounded list of recently processed intake root-message ids; it suppresses Sweep redelivery of already-consumed commands/acks after a restart. Ids are recorded only after processing completes, so a crash can at most replay a message, never silently drop one.
_Avoid_: processed set (that names the in-memory half)

**Cursor fallback (游标兜底)**:
The start time the Feishu poll uses when a cursor is missing. Since `bindings.db` is machine-local, a machine switch wipes every cursor; to avoid replaying history, `discoverIntake` on an empty `intake_cursor` sends one request **without time params** (Feishu returns the latest page) and records `max(create_time)` as the initial cursor — record-only, no processing that round. This anchors the start point to Feishu's own clock (no 24h lookback, no clock-skew duplication). Old thread bindings stall (not re-created) after a machine switch by design (see ADR 0016).
_Avoid_: Lookback default, replay window

**Fresh start reset (新机模式重置)**:
The one-shot `tasking start --fresh` startup behavior for a machine whose local bridge state went stale behind another machine's consumption: it drops `bridge_meta.intake_cursor` (so the next Sweep cold-start-probes instead of replaying the offline window) and reconciles local bindings against current Jira state — bindings whose issue reached a terminal state or vanished are marked terminal, still-active/review ones are kept. The machine effectively starts like a brand-new one without losing its own live thread mirrors (see ADR 0019).
_Avoid_: Machine takeover, reset-to-fresh, force resync

**Feishu edition (飞书版本)**:
Which of the two Feishu products a deployment talks to: 国内版 (`feishu.cn`) or the overseas Lark (`larksuite.com`). Set by `feishu.edition` (`"feishu"` | `"lark"`); selects the API domain and developer-console links only, never behavior. Applies to every Feishu surface (bridge, direct sessions, event channel).
_Avoid_: region, deployment, 海外版, domain config

**Event channel (事件通道)**:
The push-only WebSocket receive path (official SDK `WSClient`) that delivers `im.message.receive_v1` events in real time; exempt from the Feishu API call quota. Receive-only — every Feishu send remains a REST call — and its loss never loses messages, only immediacy (the Sweep covers the gap). A daemon upgrade requires a one-time console setup: subscription mode = long-connection, add the event, publish the app version.
_Avoid_: WebSocket (as feature name), long connection, push channel, listener

**Ingest queue (入站队列)**:
The single in-memory FIFO fed identically by the event channel and the Sweep; a message's id is claimed (deduped) at enqueue time and one consumer processes entries sequentially, so the two intake paths can never double-process a message. For intake root messages the claim also has a durable half (the Intake seen-id) that survives restarts.
_Avoid_: Message bus, job queue, work queue

**Sweep (兜底清扫)**:
The loss-backstop pass that re-pulls bound threads and intake-group messages from the durable cursors — triggered at daemon start, after each WS reconnect, and on a long safety timer (default 12h). It covers offline windows and silent event-channel anomalies, not processing failures: a message whose bridging fails is retried in-process with backoff (Jira-side, free) and, if it never succeeds, surfaces a visible failure ack while the cursor advances.
_Avoid_: Backfill, catch-up poll, resync, 补偿轮询, retry sweep

**Intake ack (收到确认)**:
The friendly text reply tasking sends to a non-command, non-parseable root message in the intake group (e.g. "已收到"), so the sender isn't left wondering whether the message was seen. It is not bridged to Jira and does not create a binding.
_Avoid_: Read receipt, echo

**Terminal hint (完结话题提示)**:
The one-time visible reply tasking leaves in a bound-but-terminal topic when someone posts there (issue key + how to revive via /state or re-create via /issue); repeated posts in the same topic stay silent, and nothing is bridged to Jira. Exists so a finished task's topic is never a silent black hole.
_Avoid_: Dead-topic notice, terminal ack

**Thread ack (话题回执)**:
The confirmation reply tasking sends to a user's free-text message inside a bound thread after it is successfully bridged to Jira as a comment (e.g. "✅ 已收到，已同步到 ENG-42"), so the sender knows the message was pulled and added. It is sent by the bot, so the next poll skips it and it is never bridged back to Jira.
_Avoid_: Read receipt, delivery confirmation

**Feishu init setup (init 飞书引导)**:
The optional interactive `tasking init` section that collects Feishu bridge config (app_id / app_secret / intake_chat_id / create_issue_type) and writes the `feishu:` block into WORKFLOW.md; non-interactive init prints a pointer to the quickstart instead.
_Avoid_: Feishu onboarding, setup wizard

### Direct sessions (直连会话)

**Direct session (直连会话)**:
A Feishu-thread-driven opencode session that runs directly in a fixed directory, bypassing Jira and the scheduler entirely; one thread maps 1:1 to one opencode session, and follow-up messages in the thread become continuation turns.
_Avoid_: Chat session, direct chat, free session

**Fixed directory (固定目录)**:
An existing, user-owned directory — a config-mapped project or an explicitly given path — where a direct session runs; tasking never creates, clones, or removes it.
_Avoid_: Static workspace, target workspace, project dir

**Chat command (/chat)**:
The intake-group root command that starts a direct session by project name or absolute path; all follow-ups happen inside the created thread, never in the group.
_Avoid_: Run command, spawn command

**DirectSessionManager (直连会话管理器)**:
The CommentBridge-sibling component that owns direct-session lifecycle — command intake, turn queueing, subprocess execution, expiry — reusing the worker's subprocess primitives and the bridge's durable store; the Jira path is untouched.
_Avoid_: Chat manager, session service, direct router

**Turn card (轮次卡片)**:
The Feishu interactive card that represents one turn of a direct session — that turn's tool calls as collapsible panels plus the session's control buttons. It is updated in place while the turn runs and becomes a read-only record once sealed.
_Avoid_: 进度卡, session card, dashboard card

**Sealing (封存)**:
Ending a turn card's interactive life: its control-button row is replaced by a one-line stats footer, so the card reads as a historical record while its panels, text and expand state stay as they were.
_Avoid_: 归档, 冻结, closing a card

**Card action (卡片动作)**:
A button press on a turn card, delivered as a `card.action.trigger` callback over the event channel and answered within seconds with a toast and/or a new version of that card. It is a distinct ingress kind from a user message and is never queued behind one.
_Avoid_: 按钮事件, card callback

**Turn completion message (轮次完成消息)**:
The single result a direct session posts when a turn ends — that turn's final answer plus its stats line. It is a plain text message under `summary`/`quiet` and a markdown result card under `detailed`; the process-only turn card never repeats it.
_Avoid_: summary message, result message

### Interaction surfaces (交互面)

**回访路径 (revisit path)**:
The designed way a user reaches an interaction surface again once messages pile up or time passes — one of 常驻 (always reachable), 召回 (re-summoned on demand), or 命令兜底 (a command always works). Every new interaction surface states its revisit path deliberately in design; an unstated one is a defect of design, not an oversight.
_Avoid_: Navigation, entry point

### Testing

**真实 API 集成测试**:
The `INTEGRATION=1`-gated test (`tests/integration-real.test.ts`) that hits the real Feishu bot/group + real Jira TEST project end-to-end; credentials resolve from real env vars or the gitignored repo-root `.env` file (Node 22 native `loadEnvFile`; no committed defaults), so `INTEGRATION=1` with an empty credential fails fast, and it skips cleanly when `INTEGRATION != 1`, so CI never runs it. Distinct from the mock-driven E2E (`tests/bridge-flow.test.ts`) which exercises the same flow against `tests/helpers/feishu-mock.ts`.
_Avoid_: Smoke test, live test, recording test

**Mock 驱动 E2E (mock-driven E2E)**:
The always-runnable end-to-end suites with no external dependencies: `tests/e2e.test.ts` (scheduler flow: Jira→workspace→worker→terminal, restart recovery, concurrency budget) plus `tests/bridge-flow.test.ts` (full Feishu↔Jira bridge flow against `tests/helpers/feishu-mock.ts` + mock Jira server, both the Feishu `/issue` and Jira dispatch entry points). The hard gate for end-to-end-critical changes; already enforced in CI by `npm test`.
_Avoid_: Fast E2E, local E2E

**测试策略 (test policy)**:
The mandatory-gate guidance codified in `AGENTS.md` and `docs/{zh,en}/development.md` (see ADR 0014): after changing the Feishu adapter, Jira adapter, scheduler, or Feishu↔Jira comment bridge, agents MUST run `npm run test:e2e` (mock-driven, hard gate) and, whenever the live test environment is reachable, `npm run test:integration` (real API, `INTEGRATION=1`); when unreachable, the reason goes in the commit/MR. Other changes test as needed. The npm scripts are the single source of truth for the commands.
_Avoid_: Test rules, QA policy

**回路测试 (round-trip test)**:
A card-interaction test that starts from the rendered card itself: it extracts a button's callback value from the card JSON and dispatches it through the real event-channel router, asserting the user-visible outcome. Guards the seams (routing discriminants, dedup with real render seqs) that direct-call unit tests bypass; direct-call tests remain the unit layer for handler logic.
_Avoid_: E2E test, integration test

**自清理真实 E2E (create-then-delete)**:
The real API integration tests (`tests/integration-real.test.ts`) genuinely create a real Jira issue in the TEST project (Feishu's "✅ 已创建 TEST-22" ack is sent only after real `createIssue` succeeds), run the full bridge flow against it, then deliberately DELETE it in a `finally` block so no throwaway probe issue pollutes the TEST project. This is why Feishu shows a TEST-22 creation ack that later vanishes from Jira — intentional cleanup, not an internal/mocked create (see ADR 0015).
_Avoid_: Mock issue, simulated issue

**E2E 凭据 (e2e credentials)**:
Two credential sets, not one. The Feishu e2e set (`FEISHU_E2E_APP_ID`/`FEISHU_E2E_APP_SECRET`/`FEISHU_E2E_INTAKE_CHAT_ID`) is a dedicated test bot + test group, distinct from the production bot in WORKFLOW.md's `feishu:` block. The Jira e2e set (`JIRA_E2E_ENDPOINT`/`JIRA_E2E_API_KEY`) reuses the production tracker PAT and endpoint (the same user can access the TEST project); only `JIRA_E2E_PROJECT_KEY` (`TEST`) differs from production (`TAS`). Per-developer values resolve from a gitignored `.env` config file (loaded via Node 22 native `process.loadEnvFile()`, precedence real env > file; no committed defaults) alongside a committed `.env.example` template; `tests/helpers/e2e-creds.ts` is the resolver and single source of the key names.
_Avoid_: Test secrets, integration creds

### Observability

**Effective config**:
The fully-resolved configuration the daemon actually runs with — the raw WORKFLOW.md frontmatter after applying defaults, env-var expansion, and home/path resolution. It is what the TUI config view shows (not the raw file), because reloads and resolution make the raw file diverge from runtime.
_Avoid_: Raw config, YAML config

**Config view (配置视图)**:
A TUI mode (key `c`) that renders the daemon's effective config and runtime properties (pid, uptime, workflow path, workspace root, log path, daemon host/port), with secret values masked. It reads from the daemon's live state, so it reflects hot reloads.
_Avoid_: Settings screen, config dump

**TUI port resolution**:
The order `tasking tui` picks the dashboard port: explicit `--port`, then the `.tasking/daemon.json` port in the current directory, then a probed fallback of `8080`. Lets `tui` attach to the local daemon via daemon.json, or to any daemon on a conventional port (e.g. remote) without local metadata.
_Avoid_: Port guessing, auto-discovery

**Opencode event stream**:
The newline-delimited JSON events opencode emits on stdout with `opencode run --format json` — `step_start` / `step_finish` (token usage) / `text` (assistant text) / `tool_use` (tool calls, carrying the full execution detail in `part.state`); the source of a running task's activity data.
_Avoid_: opencode stdout, event log

**Tool call (工具调用)**:
A single tool invocation in the activity stream (from opencode's `tool_use` event), captured with its execution detail — the arguments (`state.input`, e.g. the bash `command`), stdout (`state.output`), exit code (`state.metadata.exit`), a ready-made one-line summary (`state.title`), and duration (`state.time`). The activity view shows the summary inline and the full detail on expand.
_Avoid_: Tool use, tool event

**Activity view (活动视图)**:
A TUI mode (key `a` from `detail-running`) that renders a running task's opencode interaction stream — assistant text, tool calls (one-line execution summaries that expand to the full command/arguments/output/duration), step token deltas, plus the current model/agent/variant — sampled from the in-memory `ActivityStore` at 1 Hz. Serves requirement "对用户透明友好" (transparent view of what the agent is doing).
_Avoid_: Activity monitor, event viewer

**Log view (日志视图)**:
The full-screen TUI page (key `L` from overview, shown only when a log buffer is wired) that renders the daemon's recent log tail with level coloring, level filter keys (`1`-`4`), search, and a follow/pause toggle. One of the two scrolling live views, alongside Activity view.
_Avoid_: Log detail page, log panel, log tail page

**Follow (跟随)**:
The default live mode of a TUI scrolling view (Log view, Activity view): the viewport automatically tracks the newest entries as they arrive.
_Avoid_: Auto-scroll, live mode, tailing

**Paused (暂停)**:
The TUI scrolling-view state reached by pressing `Space`/`f` or by scrolling off the newest line: the viewport stops tracking new entries and stays on the entries that were visible when it paused — newly arriving entries must not shift the screen until the user scrolls or resumes follow.
_Avoid_: Frozen view, stopped, hold

**Scroll direction (滚动方向)**:
The TUI scrolling convention shared by Log, Config, and Activity views: `↓`/wheel-down moves the viewport down toward newer (later) content, `↑`/wheel-up toward older — matching terminal scrollback habits. The wheel is not tracked natively; in the alt screen the terminal delivers it as arrow keys, so keyboard and wheel share one code path.
_Avoid_: Inverted scroll, natural scrolling

**Step usage (步骤用量)**:
The per-request token report opencode attaches to each `step_finish` event: `input`, `output`, `reasoning`, and `cache.read`/`cache.write`. Its `total` field folds in cache re-reads (every request re-reads the whole context), so `total` grows monotonically across requests. tasking intentionally sums these `total` values for daemon-wide cost accounting (see ADR 0013).
_Avoid_: Cumulative tokens, session tokens

### Agent selection

**Default agent**:
The opencode agent profile (`opencode.agent`, e.g. `build`) used when a Task carries no per-task agent preference; the fallback for every dispatch.
_Avoid_: Base agent, main agent

**Agent catalog**:
The optional, advisory list of known opencode agent profiles (`opencode.agents`); surfaced by the `/agent` command and used for friendly validation. Empty/unset means no validation — any agent name passes through.
_Avoid_: Agent allowlist, agent registry

**Agent label**:
A Jira label on a Task that names the opencode agent profile to use for that task (e.g. `agent:review`); the single source of truth for per-task agent selection, read by the worker each turn from the refreshed Task.
_Avoid_: Agent tag, agent marker

**Agent override (mid-run)**:
Changing a running Task's agent by mutating its agent label via the in-thread `/agent <name>` command; takes effect at the next turn boundary (the in-flight turn finishes first), since the worker re-resolves the agent from the refreshed Task between turns.
_Avoid_: Agent switch, agent swap

### Documentation (bilingual)

**Bilingual parity**:
The invariant that the Chinese and English documentation sets mirror each other one-to-one: every page under `docs/zh/` has a matching page under `docs/en/` with the same slug, and vice versa. Enforced by the docs-link integrity test, which asserts filename parity across both locale trees.
_Avoid_: Translation mirror, lang sync

**Default locale**:
The single configured locale the docs site serves at its root path and that first-time visitors land on. Flipped by editing one field (`defaultLocale`) in `docs/.vitepress/config.ts`, so changing the global default (e.g. `zh` → `en`) is a one-line edit, not a structural change.
_Avoid_: Landing language, primary lang

**Language switcher**:
The per-page navbar control that jumps between the same page in the other locale (`zh` ⇄ `en`), preserving the current path and anchor. Present on every page.
_Avoid_: Locale toggle, lang picker
