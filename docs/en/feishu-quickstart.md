# Feishu onboarding quickstart

A step-by-step on connecting tasking to Feishu: create app → authorize → create group → get chat_id → configure WORKFLOW → start → verify. Feishu acts as a comment-synchronization mirror for existing Jira issues (people stay in Feishu, the agent only knows Jira, the runtime is untouched, see [ADR 0002](../adr/0002-feishu-jira-comment-bridge.md)).

> **Lark (overseas) users**: the steps below apply, but create the app in the **Lark Developer Console** (<https://open.larksuite.com>) — Feishu and Lark apps, credentials, and tenants are entirely separate (logging into Lark with the same phone number does not change this). Set `feishu.edition: lark`; every `open.feishu.cn` API domain and console link in this document then becomes `open.larksuite.com`.

## Prerequisites

- tasking is installed and Jira works: `tasking init` has been run and `tasking start` can dispatch Jira issues.
- Admin permissions for a Feishu "enterprise self-built app" (create app, authorize, publish versions, approve). Personal Feishu is fully self-service; for the complete app-setup and permissions guide (personal vs enterprise differences, enhanced scopes, event subscription) see [Feishu App Setup](./feishu-app-setup.md).

## 1. Create a Feishu self-built app

1. Open <https://open.feishu.cn> in a browser → log in → go to "Developer Console".
2. "Create enterprise self-built app" → fill in the name (e.g. `tasking`), description, logo → create.
3. App details → "Credentials & Basic Info" → note the **App ID** (`cli_xxx`) and **App Secret** (used later as `app_id`/`app_secret`).

## 2. Enable the bot capability

App details → "App Capabilities" → "Bot" → click "Add bot capability" → confirm. This lets the app send and receive IM messages.

## 3. Authorize scopes

"Permission Management" → "Permissions" → search and enable:

| scope | Purpose |
|------|------|
| `im:message.group_msg` | App-level read of all group messages (polling `GET /im/v1/messages`, **required** — missing it causes error 230027; no substitute) |
| `im:message` | Send messages/replies (`POST /im/v1/messages`, `.../reply`) and read message content |
| `im:chat` | List the bot's groups (`GET /im/v1/chats`, to get the intake group chat_id) and one-click chat creation |
| `im:resource` | Upload images/files (degrades to plain-text replies when missing) |

> Alternatives when `im:message` / `im:chat` are not enabled: `im:message:send_as_bot` (send), `im:message:readonly` (read content), `im:chat:readonly` (list chats) — see [Feishu App Setup](./feishu-app-setup.md).

## 4. Publish a version and get it approved

1. "Version Management & Release" → "Create Version" → fill in the version number and availability (everyone or specified) → submit.
2. The enterprise admin approves it in Feishu's "Admin Console" → "Workbench" → "App Management".

An unpublished/unapproved app's API calls return 403.

## 5. Create the intake group and add the bot

1. Create a group in the Feishu client (e.g. `tasking-intake`) — **all issue threads live in this one group**, and each `/issue` becomes a thread.
2. Group "Settings" → "Group Bots" → add the `tasking` bot you just created.

## 6. Get the intake group chat_id

After the bot joins the group, use the API to list groups and grab the chat_id. First get a tenant_access_token:

```bash
curl -X POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal \
  -H "Content-Type: application/json" \
  -d '{"app_id":"cli_xxx","app_secret":"你的secret"}'
# → {"tenant_access_token":"t-xxx","expire":7200}
```

Then list groups:

```bash
curl "https://open.feishu.cn/open-apis/im/v1/chats?page_size=20" \
  -H "Authorization: Bearer t-xxx"
# → {"data":{"items":[{"chat_id":"oc_xxxxx","name":"tasking-intake",...}]}}
```

Find the intake group's name and note its **chat_id** (`oc_xxx`).

## 7. Configure WORKFLOW.md

Pick a Jira issueType as the `/issue` default (if unsure, run `tasking init`; the connection test lists "Project issue types"). Edit the `WORKFLOW.md` front matter:

```yaml
feishu:
  enabled: true
  app_id: $FEISHU_APP_ID
  app_secret: $FEISHU_APP_SECRET
  intake_chat_id: oc_xxxxxxxxxxxxxxxx
  forward_interval_ms: 5000
  create_issue_type: Task
```

Reference credentials indirectly with `$VAR`; set the environment variables:

```bash
export FEISHU_APP_ID=cli_xxx
export FEISHU_APP_SECRET=你的secret
```

For field meanings see [Configuration Reference · the `feishu` block](./configuration.md).

## 8. Start

```bash
tasking start
```

The logs should show `feishu comment bridge ready` + `daemon started`. **No public port is listened on** — the bridge is outbound REST polling, receives no webhooks and exposes no port ([ADR 0003](../adr/0003-rest-poll-feishu-ingress.md)).

## 9. Verification checklist

In the intake group, post:

- [ ] `/help` → the bot replies instantly with the command list.
- [ ] `/issue 暗色模式` newline `需要暗色主题切换` → replies `✅ 已创建 ENG-xxx`; that command message becomes the thread root; in Jira the issue's summary=暗色模式 and the description field contains the multi-line content (no extra first comment is written). **Multi-line / rich-text (`post` type) messages are also supported** — Feishu delivers messages with line breaks as rich text, and the bridge flattens them to plain text before parsing, with the same effect as plain text.
- [ ] In that issue's thread, post `/state` → replies `当前: To Do` + a numbered list of available transitions.
- [ ] Post a non-command text directly in the intake group (e.g. `你好`) → the bot replies `已收到 ✓（/issue 创建任务，/help 看用法）`, and no Jira comment/binding is produced.
- [ ] Within seconds (event push) check Jira: `ENG-xxx` has a comment `💬 你的名 via 飞书 [msg:om_xxx]:\n需要暗色主题切换` (person → Jira, with sentinel). If nothing happens, run the self-check below (see FAQ), then inspect the push records on the Feishu event-log page.
- [ ] Post another non-command free text in that thread (e.g. `帮我看看这个`) → the bot replies `✅ 已收到，已同步到 ENG-xxx`, and the corresponding message with sentinel appears as a Jira comment.
- [ ] Add a comment directly to `ENG-xxx` in Jira → within ≤5s the Feishu thread shows a `🤖 agent:` or `💬 {人} (Jira):` forward (Jira → person, for completeness).
- [ ] `/state <some terminal number>` → replies `✅ 已转 ...（完结）`, the thread is marked terminal and syncing stops.

## 10. Common issues

- **Bot does not reply**: scopes not enabled / version not published and approved / bot not in the intake group / `intake_chat_id` filled in wrong. Look for `feishu_api_status` 4xx in the `tasking start` logs.
- **`/issue` created the issue but the scheduler does not dispatch it**: the bridge already locks `tracker.project_key`/`assignee`/`required_labels` for reuse, so it should match. If it still does not dispatch, check Jira for whether the issue's state is in `active_states` and whether assignee/labels match the tracker.
- **Event self-check (1 minute)**: `tasking start` logs should include `event channel connected`; send a message in the group and the log shows ingest/creation/bridge records. If not, recheck the three steps in 8.1 (subscription mode / event / publish).
- **Perceived latency**: Feishu→Jira is event-pushed (seconds); Jira→Feishu comment mirror is ≤ `forward_interval_ms` (default 5s). Offline windows are caught up by the Sweep backstop (default every 12h, see [ADR 0018](../adr/0018-event-driven-feishu-ingress.md)).
- **Restart re-send / re-create**: it does not — cursors are persisted in `bindings.db` (under `workspace.root`), so a restart resumes; the intake cursor is also persistent and issues are not re-created.
- **Moving to a new machine**: no db file migration is needed. With `bindings.db` absent, the intake cursor is empty and the bridge runs a cold-start probe (one request without time params → Feishu's latest page) to anchor the cursor at Feishu's own clock, so it does not replay or re-create past issues. Trade-offs: messages posted during the switch window are not consumed, and existing thread bindings stall until they are re-bound (see [ADR 0016](../adr/0016-cold-start-intake-cursor.md)).
- **Moving back to the old machine** (after another machine has been running): the old machine's `bindings.db` cursors are stale, so a restart replays the offline window and re-creates issues. Start with `tasking start --fresh` to behave like a new machine: it drops the local intake cursor (the next Sweep cold-starts instead of replaying) and reconciles bindings against Jira's current state (bindings whose issue is done/gone are marked terminal; still-active ones are kept). Messages in the offline window that no machine consumed are not backfilled — re-raise them manually (see [ADR 0019](../adr/0019-fresh-start-intake.md)).
- **tasking and the agent share a Jira account**: by design (`buildMcpConfig` injects the same set of credentials); deduplication relies on the visible sentinel rather than the author ([ADR 0004](../adr/0004-sentinel-comment-dedup.md)).

## Advanced / Limitations

- v1 text semantics: both the `text` and `post` (rich text) Feishu message types are flattened to plain text for processing — multi-line `/issue` and multi-line free text in threads both work; messages without text content such as images are ignored. Jira comments (ADF) are flattened to plain text and sent to Feishu; image, edit, and delete syncing is deferred (see the Feishu section of [usage.md](./usage.md)).
- One intake group carries all threads; multi-group partitioning and cross-group fan-out will be added later.
- To understand the design tradeoffs: [ADR 0002](../adr/0002-feishu-jira-comment-bridge.md) / [0003](../adr/0003-rest-poll-feishu-ingress.md) / [0004](../adr/0004-sentinel-comment-dedup.md).
