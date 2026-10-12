interface FeishuMockMessage {
  message_id: string;
  root_id: string | null;
  parent_id: string | null;
  msg_type: string;
  create_time: string;
  sender: {
    sender_id?: { open_id: string };
    sender_name?: string;
    sender_type: string;
    id?: string;
    id_type?: string;
  };
  body: { content: string };
}

export interface FeishuMockSeed {
  text: string;
  senderName?: string;
  senderType?: string;
  senderOpenId?: string;
  /** Emit the real REST API sender shape ({id, id_type, sender_type}) instead of the webhook shape. */
  restSender?: boolean;
}

export interface FeishuMock {
  fetchImpl: typeof fetch;
  threadIdFor(rootId: string): string;
  cardMessages(rootId: string): Array<{ messageId: string; card: unknown }>;
  cardUpdates(): Array<{ messageId: string; card: unknown }>;
  seedChatMessage(chatId: string, seed: FeishuMockSeed): FeishuMockMessage;
  seedThreadMessage(threadId: string, seed: FeishuMockSeed): FeishuMockMessage;
  chatMessages(chatId: string): FeishuMockMessage[];
  threadMessages(threadId: string): FeishuMockMessage[];
  reset(): void;
}

const BASE_MS = Date.now();

export function createFeishuMock(): FeishuMock {
  const chats = new Map<string, FeishuMockMessage[]>();
  const threads = new Map<string, FeishuMockMessage[]>();
  const cards: Array<{ rootId: string; messageId: string; card: unknown }> = [];
  const updates: Array<{ messageId: string; card: unknown }> = [];
  let counter = 0;

  const nextMs = (): string => String(BASE_MS + counter * 1000);

  const makeMessage = (
    seed: FeishuMockSeed,
    extra: Partial<FeishuMockMessage> = {},
  ): FeishuMockMessage => {
    counter++;
    const openId = seed.senderOpenId ?? "ou_default";
    const restSender = seed.restSender === true;
    return {
      message_id: `om_${counter}`,
      root_id: null,
      parent_id: null,
      msg_type: "text",
      create_time: nextMs(),
      sender: restSender
        ? {
            id: openId,
            id_type: seed.senderType === "app" ? "app_id" : "open_id",
            sender_type: seed.senderType ?? "user",
          }
        : {
            sender_id: { open_id: openId },
            sender_name: seed.senderName ?? "user",
            sender_type: seed.senderType ?? "user",
          },
      body: { content: JSON.stringify({ text: seed.text }) },
      ...extra,
    };
  };

  const fetchImpl = (async (url: RequestInfo | URL, init: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    let body: Record<string, unknown> = {};
    if (typeof init.body === "string") {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }
    const patchMsg = /\/im\/v1\/messages\/([^/?]+)$/.exec(u);
    if (init.method === "PATCH" && patchMsg) {
      updates.push({ messageId: patchMsg[1] ?? "", card: JSON.parse(String(body.content)) });
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    }
    if (body.app_id !== undefined) {
      return new Response(JSON.stringify({ tenant_access_token: "t", expire: 7200 }), {
        status: 200,
      });
    }
    const postMsg = /\/im\/v1\/messages\/([^/?]+)\/reply$/.exec(u);
    if (init.method === "POST" && postMsg) {
      const rootId = postMsg[1] ?? "";
      const replyInThread = body.reply_in_thread === true;
      if (body.msg_type === "interactive") {
        const card = JSON.parse(String(body.content));
        const msg = makeMessage(
          { text: "[card]", senderName: "bot", senderType: "app" },
          {
            root_id: rootId,
            parent_id: rootId,
            msg_type: "interactive",
            body: { content: String(body.content) },
          },
        );
        cards.push({ rootId, messageId: msg.message_id, card });
        if (replyInThread) {
          const threadId = `omt_${rootId}`;
          const list = threads.get(threadId) ?? [];
          list.push(msg);
          threads.set(threadId, list);
        } else {
          const chatId = [...chats.keys()].find((cid) =>
            chats.get(cid)?.some((m) => m.message_id === rootId),
          );
          if (chatId) {
            const list = chats.get(chatId) ?? [];
            list.push(msg);
            chats.set(chatId, list);
          }
        }
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              message_id: msg.message_id,
              root_id: rootId,
              ...(replyInThread ? { thread_id: `omt_${rootId}` } : {}),
            },
          }),
          { status: 200 },
        );
      }
      const text = JSON.parse(String(body.content)).text;
      const msg = makeMessage(
        { text, senderName: "bot", senderType: "app" },
        { root_id: rootId, parent_id: rootId },
      );
      if (replyInThread) {
        const threadId = `omt_${rootId}`;
        const list = threads.get(threadId) ?? [];
        list.push(msg);
        threads.set(threadId, list);
        return new Response(
          JSON.stringify({
            code: 0,
            data: { message_id: msg.message_id, root_id: rootId, thread_id: threadId },
          }),
          { status: 200 },
        );
      }
      const chatId = [...chats.keys()].find((cid) =>
        chats.get(cid)?.some((m) => m.message_id === rootId),
      );
      if (chatId) {
        const list = chats.get(chatId) ?? [];
        list.push(msg);
        chats.set(chatId, list);
      }
      return new Response(
        JSON.stringify({ code: 0, data: { message_id: msg.message_id, root_id: rootId } }),
        { status: 200 },
      );
    }
    const postNew = /\/im\/v1\/messages\?receive_id_type=chat_id/.exec(u);
    if (init.method === "POST" && postNew) {
      const chatId = String(body.receive_id);
      const text = JSON.parse(String(body.content)).text;
      const msg = makeMessage({ text, senderName: "bot", senderType: "app" });
      const list = chats.get(chatId) ?? [];
      list.push(msg);
      chats.set(chatId, list);
      return new Response(
        JSON.stringify({ code: 0, data: { message_id: msg.message_id, root_id: null } }),
        { status: 200 },
      );
    }
    const listMsg = /\/im\/v1\/messages\?([^#]+)/.exec(u);
    if (init.method === "GET" && listMsg) {
      const params = new URLSearchParams(listMsg[1] ?? "");
      const containerId = params.get("container_id") ?? "";
      const containerType = params.get("container_id_type") ?? "";
      const startSec = Number(params.get("start_time") ?? "0");
      const startMs = Number.isFinite(startSec) ? startSec * 1000 : 0;
      const pageSize = Number(params.get("page_size") ?? "50");
      const pageToken = Number(params.get("page_token") ?? "0");
      const all =
        containerType === "thread"
          ? (threads.get(containerId) ?? [])
          : (chats.get(containerId) ?? []);
      const filtered = all
        .filter((m) => Number(m.create_time) >= startMs)
        .sort((a, b) => Number(a.create_time) - Number(b.create_time));
      const from = Number.isFinite(pageToken) && pageToken >= 0 ? pageToken : 0;
      const page = filtered.slice(from, from + pageSize);
      const hasMore = from + pageSize < filtered.length;
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            items: page,
            has_more: hasMore,
            page_token: hasMore ? String(from + pageSize) : "",
          },
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ code: 0 }), { status: 200 });
  }) as typeof fetch;

  return {
    fetchImpl,
    threadIdFor: (rootId: string) => `omt_${rootId}`,
    cardMessages(rootId: string): Array<{ messageId: string; card: unknown }> {
      return cards
        .filter((c) => c.rootId === rootId)
        .map((c) => ({ messageId: c.messageId, card: c.card }));
    },
    cardUpdates(): Array<{ messageId: string; card: unknown }> {
      return [...updates];
    },
    seedChatMessage(chatId: string, seed: FeishuMockSeed): FeishuMockMessage {
      const msg = makeMessage(seed);
      const list = chats.get(chatId) ?? [];
      list.push(msg);
      chats.set(chatId, list);
      return msg;
    },
    seedThreadMessage(threadId: string, seed: FeishuMockSeed): FeishuMockMessage {
      const msg = makeMessage(seed, {
        root_id: threadId.startsWith("omt_") ? threadId.slice("omt_".length) : threadId,
        parent_id: threadId.startsWith("omt_") ? threadId.slice("omt_".length) : threadId,
      });
      const list = threads.get(threadId) ?? [];
      list.push(msg);
      threads.set(threadId, list);
      return msg;
    },
    chatMessages(chatId: string): FeishuMockMessage[] {
      return [...(chats.get(chatId) ?? [])];
    },
    threadMessages(threadId: string): FeishuMockMessage[] {
      return [...(threads.get(threadId) ?? [])];
    },
    reset(): void {
      chats.clear();
      threads.clear();
      cards.length = 0;
      updates.length = 0;
      counter = 0;
    },
  };
}
