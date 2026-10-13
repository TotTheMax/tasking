# Known Issues

> Contains two categories: **known limitations** and **TODOs**. TODO items are designed-but-unimplemented enhancements.

## Known Limitations

### buildContinuationGuidance is slightly off in the grill phase

`buildContinuationGuidance` in `src/worker/prompt.ts` is the globally shared continuation-turn guidance for turn 2+, and its content is MR-centric (incremental fix / full reset / land merge).

- **Impact**: if the grill phase of the grill-openspec workflow (which has no MR) reaches turn 2+, it receives a continuation-turn hint that is slightly off for the current phase.
- **Mitigation**: the grill phase usually posts its grill comment and transitions to review within turn 1, so in practice it rarely reaches turn 2.
- **A full fix crosses the boundary**: a complete fix would require changing `src/worker/prompt.ts` (making the continuation-turn guidance workflow-aware), which violates the grill-openspec "zero runtime changes" boundary (see `docs/adr/0001-phase-routing-in-prompt.md`); hence it is not fixed in v1.

## TODOs

### Insufficient Feishu integration tests: mock false-positives caused many manual bugs

> Improvement plans 1 and 2 have been fixed in TAS-10 (feishu-mock-e2e-tests); plan 3 was not done this round.

**Problem**: after the Feishu↔Jira comment bridge was implemented, all 491 unit tests were green, yet manual testing kept surfacing bugs (around 17). The root cause is that the mock HTTP server's response structure was based on **assumptions** about the Feishu/Jira API — when the assumptions were wrong, the mocks were wrong too, so the tests were verifying "whether the code logic matches the wrong assumptions" rather than "whether the code logic matches the real API".

**Typical false-positive cases**:

| bug | Why the mock did not catch it | TAS-10 fix |
|---|---|---|
| `thread_id` not captured | the mock's `replyInThread` response does not return `thread_id` (the real API does) | mock adds `thread_id`; E2E asserts binding persistence |
| `create_time` ms→s | the mock simulates with `"1000"`; the real API returns a 13-digit ms timestamp | mock uses 13-digit ms; `toSecondsStr` normalizes |
| `normalizeAssignee` skips `name` | the mock assignee object only has `emailAddress`, no `name` (Server/DC has it) | mock adds `name`; adds Server/DC assignee cases |
| `onDispatch` has no thread | the test only verifies that `postMessage` was called, not whether a thread was created | E2E asserts `thread_id` + thread messages |
| `container_id_type=thread` | the mock does not distinguish `chat` vs `thread` container types | the mock distinguishes by container type; assertions hit each separately |

**Three root-cause categories**:

1. **API knowledge gaps (~40%)**: Feishu IM API docs are scattered, and behaviors like `reply_in_thread`, `thread_id`, and `container_id_type=thread` only surface when actually called. Mocks built on incomplete understanding inevitably drift from reality.
2. **Mock false-positives (~35%)**: mock accuracy is bounded by the understanding of the API — wrong understanding → wrong mock → tests green but production broken. The missing `thread_id`, `create_time` format, `assignee` field, and `onDispatch` thread creation all fall into this category.
3. **Design-consensus gaps (~15%)**: the design focused on the `/issue` → thread happy path; the `onDispatch` → thread path was not explicitly specced (is a thread created? where does `thread_id` come from?).
4. **Pure code quality (~10%)**: busy-loop, cursor logic, etc. — the mock should have caught these but did not cover them.

**Improvement plan (three layers, in decreasing priority)**:

1. **Fix the mock response structure** (low cost, immediate benefit) ✅: fill out the existing mock's responses (add `thread_id`, the `name` field, `create_time` in ms, etc.) so they match the real API. This immediately catches the previous categories of bugs. Landed in: `tests/helpers/feishu-mock.ts` (realistic Feishu mock, distinguishes chat/thread containers, 13-digit ms timestamps, returns `thread_id`).
2. **End-to-end flow tests** (medium cost) ✅: simulate the full chain dispatch→thread→user reply→Jira comment→agent comment→thread, running a complete cycle with the corrected mock to verify cursor advance, sentinel dedup, and binding lifecycle. Landed in: `tests/bridge-flow.test.ts`, covering the full flow of both entry points (Feishu `/issue` and Jira dispatch).
3. **Optional: record real API responses for contract testing** (high cost, long-term benefit) ⏳ not done: wrap a recorder around `FeishuSource`/`JiraTracker`'s `fetchImpl` that auto-saves request/response to fixtures during manual testing, and have tests load these fixtures instead of hand-written mocks. Optionally `INTEGRATION=1 npm test` runs a real-API smoke test (not run in CI). Per the issue agreement, TAS-10 does not do this; the real credentials are kept in the issue description for manual verification.

**Real API integration tests (added by TAS-10, expanded to the full flow by TAS-11)** ✅: `tests/integration-real.test.ts` hits the real Feishu bot/group and a real Jira TEST project to run the full flow of both entry points — the Jira entry (create issue → `onDispatch` creates a real thread → agent stub does real `postComment`/`transitionIssue` → `forwardComments` bridges back to the real thread → `onTerminate` completes) and the Feishu entry (the bot posts a real message as the thread root → `executeIssue` does real `createIssue` + `replyInThread` to create the thread and binding → agent stub does real ops → bridging → completion). It fixed real bugs that the mock had hidden — the Feishu REST pull returns the sender as `{id, id_type, sender_type}` (no `sender.sender_id.open_id`/`sender_name`), and `parsePolledMessage` was updated to parse the REST shape. How to run: `INTEGRATION=1 npm test` (credentials resolve from real `FEISHU_E2E_*`/`JIRA_E2E_*` env vars or the repo-root `.env` file (`cp .env.example .env` for your own test environment; no committed defaults); skipped by default, not run in CI; `INTEGRATION=1` with an empty credential fails fast listing the missing keys). The test self-cleans the real Jira issues it creates. **Limitation**: the Feishu→Jira user-reply direction and the `/state` command cannot be fully auto-tested for real, because the bridge skips `sender_type=app` messages and the bot cannot impersonate a non-app sender; these are covered by the mock E2E (`tests/bridge-flow.test.ts`).

**(Supplementary info):**
1. A dedicated Feishu test group and bot for end-to-end testing are already prepared (app_id / app_secret / intake_chat_id) — per-developer values go in the gitignored repo-root `.env` (`cp .env.example .env`); there are no committed defaults.
2. A test project has been created on the Jira side (project_key is `TEST`), along with endpoint, api_key, and auth_mode=bearer — same as above, credentials go in the repo-root `.env` (`JIRA_E2E_*` keys); for other info (e.g. gitlab) refer to WORKFLOW.md.
3. The repo uses after_create: git clone ssh://git@192.168.10.180:2222/jiangxy/test2.git .
4. Adopted improvement plans 1 and 2; plan 3 is deferred for now.
5. The end-to-end test should ideally simulate the entire flow; the task the agent completes can be very simple, with the emphasis on testing the whole flow. At minimum it covers both entry points (Feishu and Jira): create issue --> agent runs --> modify state in both Feishu and Jira --> opencode agent adds a comment --> see the new comment/message in both Jira and Feishu --> opencode finishes --> finally the Jira issue is completed. The specific execution inside the agent is non-deterministic; if it cannot be covered, leave it for now — it can run the simplest task (creating and merging an MR is enough), with the focus on the fixed flow.

## High priority

> The following two items were fixed in TAS-9 (fix-known-issues-high-priority); kept as a historical record.

### Task description is truncated when too long
```
╭─ tasking — HEIH-55
│
│  Title:        生成恢复脚本
│  State:        处理中
│  Assignee:     postgres
│  Priority:     3
│  Source:       jira
│  URL:          http://192.168.10.17:50050/browse/HEIH-55
│
│  Workspace:    /home/xjiang3/tasking_workspaces/HEIH-55
│  Session:      ses_feba5dfbcffeo2FrXWA8CZA6dV
│  Started:      44m 25s ago
│  Turn:         2
│  Last event:   turn_started
│  Last message: turn 2 of 20
│
│  Tokens:       in 0 | out 0 | total 0
│
│
│  Description:
│  备份pipeline（jobs/Manage/Backups/ReplicateBackups180To182）会产生备份产物到182机器的目录上,
│  之前针对备份产物对服务进行了恢复测试，docs/recovery-summary目录下是备份测试的总结文档。现在需要
│  把这三个备份过程一对一的生成对应的恢复脚本。
│  要求：
│  1. 脚本能实际进行恢复
│
│  Esc/q back
╰──────────────────────────────────────────────────
```
Here the Description only shows part; normally it should all be shown.
**Fix**: the TUI running-details view now renders the full description (no longer truncated at 200 chars / 5 lines); see TAS-9.

### Issue when creating an issue via /issue in Feishu
When creating an issue via /issue in Feishu, the description was added to both the description and the comments (the comment contained the title and description); the comment is redundant and can be omitted.
**Fix**: `executeIssue` no longer writes a first comment after creating the issue (summary/description already carry the full content); see TAS-9 and `docs/adr/0009-issue-first-comment-removed.md`.

### Unstable routes to Lark international cause card-update 5xx
Accessing the Lark international API (open.larksuite.com) from mainland networks — directly or through a poor proxy — can intermittently return 504/502 for card updates, message sends, and file uploads. tasking retries retryable errors (5xx/429/network) once after a delay; if that also fails, the turn falls back to text and card mode recovers on the next turn. Feishu (open.feishu.cn) is unaffected. The root fix is a stable international route for the daemon host.

### No retry on card creation (deferred enhancement)
Card **creation** (`replyCardInThread` — the result card and turn card) does not yet use the delayed retry: a transient 5xx falls straight through to text delivery (no content loss, only the card's markdown look). Card **updates** (`updateCard`) already have retryable classification + delayed retry. Add this only if real usage reports "route is fine overall but result cards occasionally lost" (true transient blips); on a chronically degraded route retry would only delay the answer.
