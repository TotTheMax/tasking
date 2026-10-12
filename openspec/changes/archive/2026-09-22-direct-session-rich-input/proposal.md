## Why

A direct session only understands text today: an image, a file, or a text+image rich-post message is either dropped (the image) or answered with "暂仅支持文本消息，图片/文件请用文字描述～". Verified in Feishu: text+image go out as one `post` message (so the common "描述 + 截图" case is a single message), while a file is always its own message.

## What Changes

- **Attachments are parsed**: a `post` message's inline images, a standalone `image`, and a standalone `file`/`audio`/`video` message all surface as `attachments` on the polled/event message (text stays as today).
- **Attachments are materialised**: for each one the adapter downloads the resource (`GET /im/v1/messages/:id/resources/:file_key`) and the manager writes it into a tasking-owned inbox directory (never into the user's repo) and appends its absolute path to that turn's prompt, so the agent can read it (documents/logs/archives immediately; screenshots whenever the model has vision, otherwise via its own tooling).
- **Attachment-only messages start a turn** (the "text only" guard now requires neither text nor attachments).
- **Forwards**: dropped after live verification — merged-forward messages are already handled by the existing parsing, and a forward-with-comment arriving as two messages (two turns) is covered by /collect. Quote replies are out of scope — Feishu topics offer no quote-reply interaction.
- Cleanup: the session's inbox directory is removed with `/done`, `/new`, and TTL expiry.

Explicit non-goals: an ingress debounce (a text+file pair legitimately becomes two turns — the operator decided the delay is not worth it); native vision guarantees (depends on the configured model); downloading resources > 100 MB (Feishu's own limit) or resources of restricted/保密 messages.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `feishu-source`: message parsing surfaces `attachments` for `post`/`image`/`file` messages, and a resource download method is added.
- `direct-sessions`: attachments become part of a turn's prompt via an inbox directory; quoted/forwarded text is inlined; the attachment-only guard.

## Impact

- `src/adapters/feishu/source.ts` (`attachments` parsing, `downloadMessageResource`), `events.ts` (same parsing on the event path).
- `src/direct/manager.ts` (prompt composition, inbox dir + cleanup, guard, quote/forward fetch).
- Docs: `docs/{zh,en}/usage.md`, `docs/{zh,en}/configuration.md` (inbox location, limits).
