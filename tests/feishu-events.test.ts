import { describe, expect, it } from "vitest";
import { normalizeEventPayload } from "../src/adapters/feishu/events.js";

function eventPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sender: {
      sender_id: { open_id: "ou_abc", union_id: "on_x", user_id: "uid" },
      sender_type: "user",
      tenant_key: "tk",
    },
    message: {
      message_id: "om_1",
      root_id: "",
      parent_id: "",
      thread_id: "",
      message_type: "text",
      create_time: "1787814079103",
      chat_id: "oc_intake",
      chat_type: "group",
      content: JSON.stringify({ text: "hello /issue" }),
    },
    ...overrides,
  };
}

describe("normalizeEventPayload", () => {
  it("maps a v2 receive event to FeishuPolledMessage", () => {
    const m = normalizeEventPayload(eventPayload());
    expect(m).not.toBeNull();
    expect(m?.message_id).toBe("om_1");
    expect(m?.msg_type).toBe("text");
    expect(m?.text).toBe("hello /issue");
    expect(m?.sender_type).toBe("user");
    expect(m?.sender_open_id).toBe("ou_abc");
    expect(m?.root_id).toBeNull();
    expect(m?.parent_id).toBeNull();
    expect(m?.chat_id).toBe("oc_intake");
  });

  it("normalizes millisecond create_time to seconds", () => {
    const m = normalizeEventPayload(eventPayload());
    expect(m?.create_time).toBe("1787814079");
  });

  it("maps message_type (v2 field name) to msg_type", () => {
    const m = normalizeEventPayload(
      eventPayload({ message: { message_id: "om_2", message_type: "post", content: "{}" } }),
    );
    expect(m?.msg_type).toBe("post");
  });

  it("carries root_id/parent_id/thread routing fields for thread replies", () => {
    const m = normalizeEventPayload(
      eventPayload({
        message: {
          message_id: "om_3",
          root_id: "om_root",
          parent_id: "om_parent",
          thread_id: "omt_root",
          message_type: "text",
          create_time: "1787814080000",
          chat_id: "oc_intake",
          content: JSON.stringify({ text: "reply" }),
        },
      }),
    );
    expect(m?.root_id).toBe("om_root");
    expect(m?.parent_id).toBe("om_parent");
  });

  it("flattens post-type content text", () => {
    const m = normalizeEventPayload(
      eventPayload({
        message: {
          message_id: "om_4",
          message_type: "post",
          create_time: "1787814081000",
          chat_id: "oc_intake",
          content: JSON.stringify({
            title: "T",
            content: [[{ tag: "text", text: "body" }]],
          }),
        },
      }),
    );
    expect(m?.text).toBe("T\nbody");
  });

  it("returns null for non-message payloads", () => {
    expect(normalizeEventPayload(null)).toBeNull();
    expect(normalizeEventPayload({})).toBeNull();
    expect(normalizeEventPayload({ message: {} })).toBeNull();
  });
});

import { describe as describe2, expect as expect2, it as it2, vi } from "vitest";
import {
  type FeishuCardAction,
  FeishuEventListener,
  makeSdkLogger,
  normalizeCardAction,
} from "../src/adapters/feishu/events.js";
import { ConsoleLogger } from "../src/observability/logger.js";

vi.mock("@larksuiteoapi/node-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@larksuiteoapi/node-sdk")>();
  return {
    ...actual,
    WSClient: vi
      .fn()
      .mockImplementation(() => ({ start: vi.fn(async () => ({})), close: vi.fn() })),
  };
});

const silentLogger = new ConsoleLogger({}, () => {});

describe2("normalizeCardAction", () => {
  it2("reads the v2 nested context/operator/action shape", () => {
    const a = normalizeCardAction({
      schema: "2.0",
      header: { event_type: "card.action.trigger" },
      event: {
        operator: { open_id: "ou_op" },
        action: { tag: "button", value: { action: "stop", root_id: "om_root", turn: 2 } },
        context: { open_message_id: "om_card", open_chat_id: "oc_intake" },
      },
    });
    expect2(a).toEqual({
      messageId: "om_card",
      chatId: "oc_intake",
      operatorOpenId: "ou_op",
      operatorName: null,
      value: { action: "stop", root_id: "om_root", turn: 2 },
    });
  });

  it2("falls back to top-level ids for alternate surfaces", () => {
    const a = normalizeCardAction({
      open_message_id: "om_card2",
      open_chat_id: "oc_2",
      operator: { open_id: "ou_op2" },
      action: { value: { action: "done" } },
    });
    expect2(a?.messageId).toBe("om_card2");
    expect2(a?.chatId).toBe("oc_2");
  });

  it2("returns null when ids or action value are missing", () => {
    expect2(normalizeCardAction(null)).toBeNull();
    expect2(normalizeCardAction({})).toBeNull();
    expect2(
      normalizeCardAction({ context: { open_message_id: "om_card" }, operator: {}, action: {} }),
    ).toBeNull();
  });
});

describe2("FeishuEventListener", () => {
  it2("delivers normalized messages via onMessage when an event arrives", () => {
    const received: Array<{ id: string; text: string }> = [];
    const listener = new FeishuEventListener({
      appId: "a",
      appSecret: "s",
      onMessage: (msg) => received.push({ id: msg.message_id, text: msg.text }),
      onConnected: () => {},
      logger: silentLogger,
    });
    listener.handleEventData(eventPayload());
    listener.handleEventData(null);
    listener.handleEventData({ sender: { sender_type: "user" } });
    expect2(received).toEqual([{ id: "om_1", text: "hello /issue" }]);
  });

  it2("registers card.action.trigger and forwards normalized card actions", async () => {
    const received: FeishuCardAction[] = [];
    const captured: {
      dispatcher?: { invoke: (data: unknown, params?: unknown) => Promise<unknown> };
    } = {};
    const listener = new FeishuEventListener({
      appId: "a",
      appSecret: "s",
      onMessage: () => {},
      onCardAction: (a) => received.push(a),
      onConnected: () => {},
      logger: silentLogger,
      clientFactory: () => ({
        start: (options: { eventDispatcher: unknown }) => {
          captured.dispatcher = options.eventDispatcher as never;
          return Promise.resolve();
        },
      }),
    });
    listener.start();
    await vi.waitFor(() => expect2(captured.dispatcher).toBeDefined());
    await captured.dispatcher?.invoke(
      {
        schema: "2.0",
        header: { event_type: "card.action.trigger", event_id: "e1" },
        event: {
          operator: { open_id: "ou_op" },
          action: { tag: "button", value: { action: "stop", root_id: "om_root", turn: 2 } },
          context: { open_message_id: "om_card", open_chat_id: "oc_intake" },
        },
      },
      { needCheck: false },
    );
    expect2(received).toEqual([
      {
        messageId: "om_card",
        chatId: "oc_intake",
        operatorOpenId: "ou_op",
        operatorName: null,
        value: { action: "stop", root_id: "om_root", turn: 2 },
      },
    ]);
    listener.stop();
  });

  it2("ignores un-normalizable card actions", () => {
    const received: FeishuCardAction[] = [];
    const listener = new FeishuEventListener({
      appId: "a",
      appSecret: "s",
      onMessage: () => {},
      onCardAction: (a) => received.push(a),
      onConnected: () => {},
      logger: silentLogger,
    });
    listener.handleCardActionData({ context: { open_message_id: "om_card" }, action: {} });
    listener.handleCardActionData(null);
    listener.handleCardActionData({ event: { action: { value: {} } } });
    expect2(received).toEqual([]);
  });

  it2("fires onConnected on first connect and after each reconnect episode", () => {
    let connectedCount = 0;
    let fireReady: (() => void) | null = null;
    const listener = new FeishuEventListener({
      appId: "a",
      appSecret: "s",
      onMessage: () => {},
      onConnected: () => connectedCount++,
      logger: silentLogger,
      clientFactory: (onConnected) => {
        fireReady = onConnected;
        return { start: () => Promise.resolve() };
      },
    });
    listener.start();
    fireReady?.();
    fireReady?.();
    expect2(connectedCount).toBe(2);
    listener.stop();
  });

  it2("retries with delay after the SDK gives up (onError)", () => {
    vi.useFakeTimers();
    try {
      let connectedCount = 0;
      let startCount = 0;
      const listener = new FeishuEventListener({
        appId: "a",
        appSecret: "s",
        onMessage: () => {},
        onConnected: () => connectedCount++,
        logger: silentLogger,
        retryDelayMs: 60000,
        clientFactory: (_onConnected, onError) => {
          return {
            start: () => {
              startCount++;
              if (startCount === 1) {
                onError(new Error("app not online"));
                return Promise.reject(new Error("app not online"));
              }
              return Promise.resolve();
            },
          };
        },
      });
      listener.start();
      expect2(startCount).toBe(1);
      vi.advanceTimersByTime(60000);
      expect2(startCount).toBe(2);
      expect2(connectedCount).toBe(0);
      listener.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe2("FeishuEventListener edition domain", () => {
  it2("constructs WSClient with Domain.Lark when edition is lark", async () => {
    const { WSClient, Domain } = await import("@larksuiteoapi/node-sdk");
    (WSClient as unknown as ReturnType<typeof vi.fn>).mockClear();
    const listener = new FeishuEventListener({
      appId: "a",
      appSecret: "s",
      edition: "lark",
      onMessage: () => {},
      onConnected: () => {},
      logger: silentLogger,
    });
    listener.start();
    expect2(WSClient).toHaveBeenCalledWith(expect2.objectContaining({ domain: Domain.Lark }));
    listener.stop();
  });

  it2("constructs WSClient with the Feishu domain by default", async () => {
    const { WSClient, Domain } = await import("@larksuiteoapi/node-sdk");
    (WSClient as unknown as ReturnType<typeof vi.fn>).mockClear();
    const listener = new FeishuEventListener({
      appId: "a",
      appSecret: "s",
      edition: "feishu",
      onMessage: () => {},
      onConnected: () => {},
      logger: silentLogger,
    });
    listener.start();
    expect2(WSClient).toHaveBeenCalledWith(expect2.objectContaining({ domain: Domain.Feishu }));
    listener.stop();
  });
});

describe2("makeSdkLogger", () => {
  it2("routes SDK log calls into the tasking logger instead of the console", () => {
    const lines: string[] = [];
    const capture = new ConsoleLogger({}, (line: string) => lines.push(line));
    const sdk = makeSdkLogger(capture);
    sdk.info("ws client ready");
    sdk.error("boom", { code: 1 });
    const joined = lines.join("\n");
    expect2(joined).toContain("feishu-ws ws client ready");
    expect2(joined).toContain("feishu-ws boom");
  });

  it2("filters SDK onboarding/registration noise, keeps connection config intact", () => {
    const lines: string[] = [];
    const capture = new ConsoleLogger({}, (line: string) => lines.push(line));
    const sdk = makeSdkLogger(capture);
    sdk.info(
      "receive events or callbacks through persistent connection only available in self-build & Feishu app",
    );
    sdk.debug("register im.message.receive_v1 handle");
    sdk.debug("event-dispatch is ready");
    sdk.debug([
      "[ws]",
      "get connect config success, ws url: wss://...access_key=SECRET&ticket=TTT",
    ]);
    sdk.debug("execute im.message.receive_v1 handle");
    sdk.info("ws connect success");
    const joined = lines.join("\n");
    expect2(joined).not.toContain("receive events or callbacks");
    expect2(joined).not.toContain("register im.message.receive_v1");
    expect2(joined).not.toContain("event-dispatch is ready");
    expect2(joined).toContain("get connect config success");
    expect2(joined).toContain("access_key=SECRET");
    expect2(joined).toContain("ticket=TTT");
    expect2(joined).toContain("execute im.message.receive_v1 handle");
    expect2(joined).toContain("ws connect success");
  });
});
