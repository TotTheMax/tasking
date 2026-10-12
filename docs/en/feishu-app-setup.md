# Feishu App Setup and Permissions

Every interaction between tasking and Feishu (direct `/chat` sessions, the Jira bridge `/issue`, card buttons) goes through a single **Feishu custom app**. This page covers the one-time Feishu-side preparation: create the app → grant permissions → subscribe to events → publish → put the resulting config into `WORKFLOW.md`, and explains the differences between **personal Feishu** and **enterprise Feishu**. Once this is done, continue with [Getting Started](./getting-started.md) (direct path) or the [Feishu Quickstart](./feishu-quickstart.md) (full Jira-bridge flow with troubleshooting).

## 1. Personal vs Enterprise Feishu

| | Personal Feishu | Enterprise Feishu |
|---|---|---|
| Who can create an app | The account owner (a personal account is the admin of its own tenant) | Any member can create; publishing requires an enterprise admin |
| Permission (scope) grants | Self-service, effective immediately | Sensitive scopes may require admin approval depending on console policy |
| Version release | Create and publish yourself — effective immediately, no approval | Must be approved by an enterprise admin in the Feishu Admin Console |
| Best for | Individual developers, trials, PoCs | Team / company production use |

The steps are **identical** for both editions — the only difference is *who approves*. On enterprise Feishu without admin rights, hand the permission list (§4), event list (§5), and availability-scope requirement (§6) from this page to your admin to complete.

> tasking only uses IM capabilities (messages / chats / bot / cards) and does not depend on enterprise-only features such as the org directory — nothing is missing on personal Feishu.

## 2. Create the custom app

1. Open <https://open.feishu.cn> in a browser → sign in (personal or enterprise account) → go to the **Developer Console**.
2. **Create custom app** (*创建企业自建应用*) → fill in a name (e.g. `tasking`), description, logo → create. For personal accounts the app lives under your personal tenant — ignore the word "enterprise" in the menu item.
3. App details → **Credentials & Basic Info** → note the **App ID** (`cli_xxx`) and **App Secret** (used later as `app_id` / `app_secret`; the secret is shown once — reset it on that page if lost).

## 3. Enable the bot capability

App details → **App capabilities** → **Bot** → **Add bot capability**. This bot is the identity tasking uses to send and receive messages in chats.

## 4. Grant permissions (scopes)

**Permission Management** → **API Permissions** → search and enable:

**Required (3) — the matching feature fails without them:**

| Scope | What tasking uses it for |
|---|---|
| `im:message.group_msg` | App-level access to all group messages — receiving `/chat`, `/issue`, etc.; without it the polling fallback `GET /im/v1/messages` fails with **230027**; no substitute |
| `im:message` | Get and send chat messages — every tasking reply and card (`POST /im/v1/messages`, `.../reply`), message content reads (reconciliation after reconnects), plus update/recall of sent messages (`PATCH` / `DELETE` `/im/v1/messages/:id`) for in-place card refresh; without it cards stop refreshing and arrive as separate messages |
| `im:chat` | Get and update chat info — `tasking init` lists candidate intake chats and offers "➕ create intake chat (and add you)" (`POST /im/v1/chats`); without it, creating reports the missing scope and init falls back to picking an existing chat |

**Enhanced (2) — recommended:**

| Scope | What tasking uses it for | Behavior when missing |
|---|---|---|
| `im:resource` | Upload images/files (`POST /im/v1/files`) so agent artifacts land directly in the chat | Upload fails with **99991672 / Access denied**; tasking degrades to plain-text replies |
| `contact:user.id:readonly` | Resolves your open_id from email/mobile when creating the intake chat (`POST /contact/v3/users/batch_get_id`) so you are added to it — **without adding a human member, a bot-created chat contains only the bot and is invisible to you** | init cannot locate your account: it warns, does not select the bot-only chat, and points you to manual creation + "⟳ refresh chat list" |

**Alternative authorizations (when you prefer not to grant the combined scopes):** scopes authorize endpoints and overlap. Without `im:message`, use `im:message:send_as_bot` (send) + `im:message:readonly` (read content) instead — you lose in-place card refresh (exclusive to PATCH/DELETE). Without `im:chat`, use `im:chat:readonly` (list only, no creation). Nothing substitutes for `im:message.group_msg`. The minimal working set is the 3 + 2 above (verified live on Lark).

Enterprise note: some scopes show a *pending approval* state after enabling — an admin must approve them in the Admin Console before they take effect.

## 5. Subscribe to events (WS long connection)

tasking receives messages over a **WebSocket long connection** (outbound-only: no public IP, domain, or certificate needed — see [ADR 0018](../adr/0018-event-driven-feishu-ingress.md)). In the [Developer Console](https://open.feishu.cn/app), under the app:

1. **Events & Callbacks → Subscription mode** → choose *Receive events via long connection* → save. Saving requires the client to be online: start `tasking start` on your machine first, then come back to save.
2. **Events & Callbacks → Add event** — add both:
   - `Receive message im.message.receive_v1` — the entry point for chat messages (`/chat`, `/issue`, free text).
   - `Card interaction callback card.action.trigger` — card button clicks (direct-session `/stop`, state-transition cards, etc.).
3. After changing event subscriptions you must **publish a new version** (next section) for them to take effect.

> Single-instance constraint: only one tasking daemon may be online per Feishu app. If multiple machines connect with the same `app_id`, the platform routes events randomly in cluster mode and instances steal each other's messages.

## 6. Publish the app

- **Personal**: **Version Management & Release** → **Create version** → fill in the version (default availability is fine) → publish. Effective immediately.
- **Enterprise**: when creating the version, choose the availability scope (everyone, or selected departments/members — **at minimum the person who creates the intake chat and the users**) → submit → an enterprise admin approves it in Feishu **Admin Console → Workbench → App Management**.

Unpublished / unapproved apps get **403** on every API call.

## 7. Create the intake chat and add the bot

1. Create a chat in the Feishu client (e.g. `tasking-intake`) — **all task threads live in this one chat** (every direct project session, every `/issue` topic of the bridge).
2. Chat **Settings** → **Chat bots** → add the `tasking` bot you just created.
3. You do **not** need to look up the `chat_id` by hand: after validating app_id/app_secret, `tasking init` calls the chat-list API and lets you pick from the bot's chats (requires `im:chat` from §4); if there are no chats yet, the "➕ create intake chat" option at the top of the picker creates one directly (requires `im:chat` from §4, default name `tasking-intake`, selected right after creation). For the manual two-step curl method, see [Feishu Quickstart §6](./feishu-quickstart.md#6-get-the-intake-chat-id).

## 8. Put it into WORKFLOW.md

Both shapes share the same `feishu:` block; `tasking init` generates it during onboarding. Minimal manual configuration:

**Direct (no Jira, `tracker` is `none`):**

```yaml
feishu:
  enabled: true
  app_id: $FEISHU_APP_ID
  app_secret: $FEISHU_APP_SECRET
  intake_chat_id: oc_xxxxxxxxxxxxxxxx
  direct:
    enabled: true
```

**Bridge (Jira connected, `tracker` is `jira`):**

```yaml
feishu:
  enabled: true
  app_id: $FEISHU_APP_ID
  app_secret: $FEISHU_APP_SECRET
  intake_chat_id: oc_xxxxxxxxxxxxxxxx
  forward_interval_ms: 5000
  create_issue_type: Task
```

Common fields:

| Field | Meaning |
|---|---|
| `enabled` | Feishu master switch |
| `app_id` / `app_secret` | App credentials from §2; prefer `$ENV_VAR` indirection (below) over plaintext in the repo |
| `intake_chat_id` | The intake chat ID from §7 (starts with `oc_`) |
| `direct.enabled` | Direct sessions (`/chat`) switch — required for the direct path |
| `forward_interval_ms` / `sweep_interval_ms` | Bridge comment-forwarding / sweep intervals |
| `create_issue_type` | Jira issueType used by `/issue` (e.g. `Task`) |

Inject credentials via environment variables:

```bash
export FEISHU_APP_ID=cli_xxx
export FEISHU_APP_SECRET=your-secret
```

See [Configuration · `feishu` block](./configuration.md) for the complete field reference.

## 9. Error → missing-step table

> Faster troubleshooting: run `tasking doctor` — it performs this table's mapping automatically (credentials / three scope probes / intake-chat reachability) and prints what is missing with pointers into this page. `tasking init`'s Feishu collection flow runs the same health check automatically.

| Symptom | Missing step |
|---|---|
| Every API call returns 403 | Version not published/approved (§6), or no scopes at all (§4) |
| Polling fails with **230027** | Missing `im:message.group_msg` (§4) |
| Upload fails with **99991672 / Access denied** | Missing `im:resource` (§4) |
| Event log shows `FAIL app not online` | Subscription mode not set to long connection / events not added / no re-publish after the change (§5) |
| Bot sends but never receives | Event subscription issue (§5); or another machine is online with the same `app_id` (single-instance constraint) |
| `tasking init` lists no chats | Bot not in the chat (§7), or missing `im:chat` (§4) |
| "➕ create intake chat" fails | Missing `im:chat` (§4) — init falls back to picking an existing chat |
| Bot invisible in the chat | Bot capability not added (§3), or availability scope excludes you (§6) |

## Related

- [Getting Started](./getting-started.md) — the 5-minute direct path
- [Feishu Quickstart](./feishu-quickstart.md) — full Jira-bridge flow with troubleshooting
- [Configuration](./configuration.md) — complete `feishu` block reference
- [ADR 0018](../adr/0018-event-driven-feishu-ingress.md) — why WS long connection instead of webhooks
