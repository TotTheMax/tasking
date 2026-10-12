## Context

Both ingress paths normalise to `FeishuPolledMessage` (`source.ts` for REST/Sweep, `events.ts` for the WS channel), so the parsing change belongs in the shared helpers. Downloads are a single REST call per attachment (no new scope: `im:message` suffices; `im:resource` is already granted for uploads). The direct turn's prompt is the last positional of the spawn command, so "path into the prompt" is just text composition.

## Goals / Non-Goals

**Goals:** the agent can use what the operator sent without the operator re-typing it; nothing is written into the user's repository; failures are visible.

**Non-Goals:** debounce/collect window (operator decision), guaranteed image understanding (model-dependent), >100 MB resources, 保密/restricted resources.

## Decisions

1. **`attachments: Array<{kind: "image"|"file", key, name}>` on the message.** Parsing lives next to `parseMessageText` so both ingress paths share it; `post` images are collected from the rich-text tree, standalone `image`/`file`/`media`/`audio` from their content key. Text parsing is unchanged.
2. **Inbox outside the repo**: `<workspace.root>/direct-inbox/<root_id>/<msgId>-<n>-<name>` — tasking-owned, so `git status` in the target directory stays clean. Removed by the same teardown that deletes the opencode session (`/done`, `/new`, expiry).
3. **Prompt composition**: the user's text stays verbatim first, then one line per attachment (`[附件] <abs path>`) and, when there is no text at all, a short lead-in so the model has an instruction. The "prompt invariant" (the user's message is the prompt, no template) is preserved for text messages; attachments append paths only.
4. **Download failure is visible**: a failed download reports in the thread (and, when text also exists, the turn still runs with a `[附件下载失败] …` note) so a dropped image is never silent.
5. **Guard becomes "text or attachment"**, so an image-only message starts a turn instead of the "text only" notice.
6. **Quote/forward afterwards**（2026-09-22 裁撤：话题内无引用交互；merge_forward 既有解析已覆盖，转发+留言两轮由 /collect 兜住）: quoted text needs a second fetch by `parent_id`; merged forward needs sub-message traversal. Both are pinned by the operator's payload probe before coding, and shipped as the second slice of this change.

## Risks / Trade-offs

- A 100 MB download into the inbox could fill disk → cap our own accepted size (planned 20 MB) and say so in the thread.
- The path is absolute and outside the agent's cwd → the agent must `read` it by path; verified acceptable for arbitrary tools.
- Image usefulness depends on the model's vision; documents/archives work regardless (documented).
