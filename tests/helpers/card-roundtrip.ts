import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FeishuCardAction } from "../../src/adapters/feishu/events.js";
import type { CommentBridge } from "../../src/bridge/comment-bridge.js";
import { startEventChannel } from "../../src/cli/event-channel.js";
import type { EffectiveConfig } from "../../src/config/config-types.js";
import type { Logger } from "../../src/observability/logger.js";
import type { CardActionReply } from "../../src/shared/info-card.js";

export interface RoundTripButton {
  label: string;
  action: string;
  value: Record<string, unknown>;
}

export function extractButtons(card: unknown): RoundTripButton[] {
  const elements =
    (card as { body?: { elements?: Array<Record<string, unknown>> } })?.body?.elements ?? [];
  const out: RoundTripButton[] = [];
  for (const el of elements) {
    const behaviors =
      (el as { behaviors?: Array<{ type?: string; value?: Record<string, unknown> }> }).behaviors ??
      [];
    const label = (el as { text?: { content?: unknown } }).text?.content;
    for (const b of behaviors) {
      if (b?.type === "callback" && b.value !== undefined) {
        out.push({
          label: typeof label === "string" ? label : "",
          action: String(b.value.action ?? ""),
          value: b.value,
        });
      }
    }
  }
  return out;
}

const FIXTURE = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "..", "fixtures", "feishu", "card-action-trigger.json"),
    "utf8",
  ),
) as {
  withOperatorName: CardActionEnvelope;
  withoutOperatorName: CardActionEnvelope;
};

interface CardActionEnvelope {
  header: { event_type: string; event_id: string };
  event: {
    operator: Record<string, unknown>;
    action: { tag: string; value: Record<string, unknown> };
    context: { open_message_id: string; open_chat_id: string };
  };
}

export interface CardActionEventOptions {
  operatorName?: string | null;
  operatorOpenId?: string;
  chatId?: string;
}

export function cardActionEvent(
  messageId: string,
  value: Record<string, unknown>,
  opts: CardActionEventOptions = {},
): Record<string, unknown> {
  const named = typeof opts.operatorName === "string" && opts.operatorName !== "";
  const env = structuredClone(named ? FIXTURE.withOperatorName : FIXTURE.withoutOperatorName);
  if (named && opts.operatorName !== undefined) env.event.operator.name = opts.operatorName;
  if (opts.operatorOpenId !== undefined) env.event.operator.open_id = opts.operatorOpenId;
  env.event.action.value = value;
  env.event.context.open_message_id = messageId;
  if (opts.chatId !== undefined) env.event.context.open_chat_id = opts.chatId;
  return env as unknown as Record<string, unknown>;
}

export interface RoundTripRecorder {
  replies: Array<{ rootId: string; text: string }>;
  cards: Array<{ rootId: string; card: unknown }>;
  updates: Array<{ messageId: string; card: unknown }>;
  files: Array<{ fileName: string }>;
  fileMessages: Array<{ rootId: string; fileKey: string }>;
  deleted: string[];
  fetchImpl: typeof fetch;
}

export function createRoundTripRecorder(): RoundTripRecorder {
  const rec: RoundTripRecorder = {
    replies: [],
    cards: [],
    updates: [],
    files: [],
    fileMessages: [],
    deleted: [],
    fetchImpl: (async (url: RequestInfo | URL, init: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      let body: Record<string, unknown> = {};
      if (typeof init.body === "string" && init.body !== "") {
        try {
          body = JSON.parse(init.body) as Record<string, unknown>;
        } catch {
          body = {};
        }
      }
      if (body.app_id !== undefined) {
        return new Response(JSON.stringify({ tenant_access_token: "t", expire: 7200 }), {
          status: 200,
        });
      }
      if (u.includes("/chats/") && u.includes("/members")) {
        return new Response(
          JSON.stringify({ code: 0, data: { items: [{ member_id: "ou_op", name: "张三" }] } }),
          { status: 200 },
        );
      }
      if (u.includes("/im/v1/files") && init.method === "POST") {
        const form = init.body instanceof FormData ? init.body : null;
        rec.files.push({ fileName: form === null ? "" : String(form.get("file_name") ?? "") });
        return new Response(
          JSON.stringify({ code: 0, data: { file_key: `file_v2_${rec.files.length}` } }),
          { status: 200 },
        );
      }
      if (u.includes("/im/v1/messages/") && init.method === "DELETE") {
        rec.deleted.push(u.split("/im/v1/messages/")[1]?.split("?")[0] ?? "");
        return new Response(JSON.stringify({ code: 0 }), { status: 200 });
      }
      if (u.includes("/im/v1/messages/") && init.method === "PATCH") {
        rec.updates.push({
          messageId: u.split("/im/v1/messages/")[1] ?? "",
          card: JSON.parse(String(body.content)),
        });
        return new Response(JSON.stringify({ code: 0 }), { status: 200 });
      }
      if (u.includes("/im/v1/messages/") && u.endsWith("/reply")) {
        const rootId = u.split("/im/v1/messages/")[1]?.split("/")[0] ?? "";
        const content = JSON.parse(String(body.content)) as Record<string, unknown>;
        const msgId = `om_r${rec.replies.length + rec.cards.length + rec.fileMessages.length}`;
        if (body.msg_type === "interactive") rec.cards.push({ rootId, card: content });
        else if (body.msg_type === "file")
          rec.fileMessages.push({ rootId, fileKey: String(content.file_key ?? "") });
        else rec.replies.push({ rootId, text: String(content.text ?? "") });
        return new Response(JSON.stringify({ code: 0, data: { message_id: msgId } }), {
          status: 200,
        });
      }
      if (u.includes("/im/v1/messages") && init.method === "POST") {
        rec.replies.push({ rootId: String(body.receive_id ?? ""), text: "[posted]" });
        return new Response(JSON.stringify({ code: 0, data: { message_id: "om_p1" } }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    }) as typeof fetch,
  };
  return rec;
}

export interface RoundTripHarness {
  dispatch(event: Record<string, unknown>): Promise<unknown>;
  stop(): void;
}

export function startRoundTrip(wiring: {
  config: EffectiveConfig;
  bridge: CommentBridge;
  direct?: { handleCardAction(action: FeishuCardAction): Promise<CardActionReply | undefined> };
  logger: Logger;
}): RoundTripHarness | null {
  const listener = startEventChannel({
    config: wiring.config,
    bridge: wiring.bridge,
    ...(wiring.direct === undefined ? {} : { direct: wiring.direct }),
    logger: wiring.logger,
    clientFactory: () => ({ start: () => Promise.resolve() }),
  });
  if (listener === null) return null;
  return {
    dispatch: async (event) => listener.handleCardActionData(event),
    stop: () => listener.stop(),
  };
}
