import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FeishuSource,
  flattenPostContent,
  parseMessageAttachments,
  parseTextContent,
  toSecondsStr,
  validateFeishuConfig,
} from "../src/adapters/feishu/source.js";
import type { FeishuConfig } from "../src/config/config-types.js";
import { ConsoleLogger } from "../src/observability/logger.js";
import { TaskingError } from "../src/shared/errors.js";
import { setLocale } from "../src/translate/locale.js";

const logger = new ConsoleLogger({}, () => {});

function makeConfig(overrides: Partial<FeishuConfig> = {}): FeishuConfig {
  return {
    enabled: true,
    edition: "feishu",
    app_id: "cli_test",
    app_secret: "secret",
    verification_token: "tok",
    encrypt_key: null,
    intake_chat_id: "oc_intake",
    forward_interval_ms: 5000,
    sweep_interval_ms: 60000,
    create_issue_type: "Task",
    ...overrides,
  };
}

function tokenFetch(handler: (url: string, init: RequestInit) => Response): typeof fetch {
  return (async (url: RequestInfo | URL, init: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    const body = init.body ? JSON.parse(init.body as string) : {};
    if (body.app_id !== undefined) {
      return new Response(JSON.stringify({ tenant_access_token: "token-123", expire: 7200 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return handler(u, init);
  }) as typeof fetch;
}

describe("feishu.edition domain derivation", () => {
  function capturingFetch(urls: string[]): typeof fetch {
    return (async (url: RequestInfo | URL, init: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      urls.push(u);
      const body = init.body ? JSON.parse(init.body as string) : {};
      if (u.includes("tenant_access_token") || body.app_id !== undefined) {
        return new Response(JSON.stringify({ tenant_access_token: "token-123", expire: 7200 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 });
    }) as typeof fetch;
  }

  it("routes token, message, and thread calls to open.larksuite.com when edition is lark", async () => {
    const urls: string[] = [];
    const src = new FeishuSource(makeConfig({ edition: "lark" }), logger, capturingFetch(urls));
    await src.postMessage("oc_x", "hi");
    await src.listThreadReplies("om_root");
    expect(urls.some((u) => u.includes("tenant_access_token"))).toBe(true);
    expect(urls.some((u) => u.includes("/im/v1/messages"))).toBe(true);
    for (const u of urls) {
      expect(u.startsWith("https://open.larksuite.com/")).toBe(true);
    }
  });

  it("keeps open.feishu.cn for the default edition", async () => {
    const urls: string[] = [];
    const src = new FeishuSource(makeConfig(), logger, capturingFetch(urls));
    await src.postMessage("oc_x", "hi");
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u.startsWith("https://open.feishu.cn/")).toBe(true);
    }
  });

  it("warns with the cross-region hint when the tenant token auth fails", async () => {
    const lines: string[] = [];
    const capturingLogger = new ConsoleLogger({}, (line) => lines.push(line));
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ code: 10014, msg: "app not exist" }), {
        status: 401,
      })) as typeof fetch;
    const src = new FeishuSource(makeConfig(), capturingLogger, fetchImpl);
    await expect(src.postMessage("oc_x", "hi")).rejects.toThrow(TaskingError);
    expect(lines.some((l) => l.includes("feishu.edition"))).toBe(true);
    expect(lines.some((l) => l.includes("lark"))).toBe(true);
  });
});

describe("FeishuSource.reply", () => {
  it("sends a reply successfully", async () => {
    const fetchImpl = tokenFetch(() => new Response(JSON.stringify({ code: 0 }), { status: 200 }));
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    await expect(src.reply("chat-1", "done")).resolves.toBeUndefined();
  });

  it("surfaces failure as TaskingError", async () => {
    const fetchImpl = tokenFetch(() => new Response("unauthorized", { status: 401 }));
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    await expect(src.reply("chat-1", "hi")).rejects.toThrow(TaskingError);
    try {
      await src.reply("chat-1", "hi");
    } catch (e) {
      expect((e as TaskingError).category).toBe("feishu_api_status");
    }
  });
});

describe("FeishuSource.replyInThread", () => {
  it("POSTs to the reply endpoint under the root id", async () => {
    const holder: { url?: string; body?: unknown } = {};
    const fetchImpl = tokenFetch((url, init) => {
      holder.url = url;
      holder.body = init.body ? JSON.parse(init.body as string) : {};
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    });
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    await src.replyInThread("om_root1", "in thread");
    expect(holder.url).toContain("/im/v1/messages/om_root1/reply");
    const body = holder.body as { msg_type: string; content: string };
    expect(body.msg_type).toBe("text");
    expect(JSON.parse(body.content).text).toBe("in thread");
  });

  it("captures thread_id from the reply response (real API returns it)", async () => {
    const fetchImpl = tokenFetch(
      () =>
        new Response(
          JSON.stringify({
            code: 0,
            data: { message_id: "om_r1", root_id: "om_root1", thread_id: "omt_root1" },
          }),
          { status: 200 },
        ),
    );
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    const r = await src.replyInThread("om_root1", "in thread");
    expect(r.thread_id).toBe("omt_root1");
  });
});

describe("FeishuSource.replyCardInThread", () => {
  it("POSTs an interactive card as a thread reply and returns its ids", async () => {
    const holder: { url?: string; method?: string; body?: Record<string, unknown> } = {};
    const fetchImpl = tokenFetch((url, init) => {
      holder.url = url;
      holder.method = init.method;
      holder.body = init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
      return new Response(
        JSON.stringify({ code: 0, data: { message_id: "om_card1", thread_id: "omt_1" } }),
        { status: 200 },
      );
    });
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    const card = { schema: "2.0", config: { update_multi: true }, body: { elements: [] } };
    const r = await src.replyCardInThread("om_root1", card);
    expect(holder.url).toContain("/im/v1/messages/om_root1/reply");
    expect(holder.method).toBe("POST");
    expect(holder.body?.msg_type).toBe("interactive");
    expect(holder.body?.reply_in_thread).toBe(true);
    expect(JSON.parse(String(holder.body?.content))).toEqual(card);
    expect(r.message_id).toBe("om_card1");
    expect(r.thread_id).toBe("omt_1");
  });

  it("surfaces failure as feishu_api_status", async () => {
    const fetchImpl = tokenFetch(() => new Response("bad card", { status: 400 }));
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    await expect(src.replyCardInThread("om_root1", { schema: "2.0" })).rejects.toMatchObject({
      category: "feishu_api_status",
    });
  });
});

describe("FeishuSource.replyCardFlat", () => {
  it("POSTs an interactive card without reply_in_thread", async () => {
    const holder: { url?: string; method?: string; body?: Record<string, unknown> } = {};
    const fetchImpl = tokenFetch((url, init) => {
      holder.url = url;
      holder.method = init.method;
      holder.body = init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
      return new Response(JSON.stringify({ code: 0, data: { message_id: "om_flat1" } }), {
        status: 200,
      });
    });
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    const card = { schema: "2.0", config: { update_multi: true }, body: { elements: [] } };
    const r = await src.replyCardFlat("om_root1", card);
    expect(holder.url).toContain("/im/v1/messages/om_root1/reply");
    expect(holder.method).toBe("POST");
    expect(holder.body?.msg_type).toBe("interactive");
    expect(holder.body?.reply_in_thread).toBeUndefined();
    expect(JSON.parse(String(holder.body?.content))).toEqual(card);
    expect(r.message_id).toBe("om_flat1");
  });

  it("surfaces failure as feishu_api_status", async () => {
    const fetchImpl = tokenFetch(() => new Response("bad card", { status: 400 }));
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    await expect(src.replyCardFlat("om_root1", { schema: "2.0" })).rejects.toMatchObject({
      category: "feishu_api_status",
    });
  });
});

describe("FeishuSource.deleteMessage", () => {
  it("DELETEs the message by id", async () => {
    const holder: { url?: string; method?: string } = {};
    const fetchImpl = tokenFetch((url, init) => {
      holder.url = url;
      holder.method = init.method;
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    });
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    await expect(src.deleteMessage("om_del1")).resolves.toBeUndefined();
    expect(holder.url).toContain("/im/v1/messages/om_del1");
    expect(holder.method).toBe("DELETE");
  });

  it("surfaces failure as feishu_api_status", async () => {
    const fetchImpl = tokenFetch(() => new Response("forbidden", { status: 403 }));
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    await expect(src.deleteMessage("om_del1")).rejects.toMatchObject({
      category: "feishu_api_status",
    });
  });
});

describe("FeishuSource.updateCard", () => {
  it("PATCHes the card message with the serialized card", async () => {
    const holder: { url?: string; method?: string; body?: { content?: string } } = {};
    const fetchImpl = tokenFetch((url, init) => {
      holder.url = url;
      holder.method = init.method;
      holder.body = init.body ? (JSON.parse(init.body as string) as { content?: string }) : {};
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    });
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    const card = { schema: "2.0", body: { elements: [{ tag: "markdown", content: "hi" }] } };
    await src.updateCard("om_card1", card);
    expect(holder.url).toContain("/im/v1/messages/om_card1");
    expect(holder.method).toBe("PATCH");
    expect(JSON.parse(String(holder.body?.content))).toEqual(card);
  });

  it("surfaces failure as feishu_api_status", async () => {
    const fetchImpl = tokenFetch(() => new Response("recalled", { status: 400 }));
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    await expect(src.updateCard("om_card1", { schema: "2.0" })).rejects.toMatchObject({
      category: "feishu_api_status",
    });
  });
});

describe("FeishuSource.uploadFile + sendFileMessage", () => {
  function uploadFetch(
    calls: Array<{ url: string; method?: string; body?: unknown }>,
    uploadResponse: Response,
  ): typeof fetch {
    return (async (url: RequestInfo | URL, init: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/auth/v3/tenant_access_token/internal")) {
        return new Response(JSON.stringify({ tenant_access_token: "t", expire: 7200 }), {
          status: 200,
        });
      }
      calls.push({ url: u, method: init.method, body: init.body });
      if (u.endsWith("/im/v1/files")) return uploadResponse;
      return new Response(
        JSON.stringify({ code: 0, data: { message_id: "om_f1", thread_id: "omt_f1" } }),
        { status: 200 },
      );
    }) as typeof fetch;
  }

  it("uploads multipart then sends the file_key as a thread file message", async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const fetchImpl = uploadFetch(
      calls,
      new Response(JSON.stringify({ code: 0, data: { file_key: "file_v2_abc" } }), { status: 200 }),
    );
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);

    const key = await src.uploadFile(Buffer.from("# full detail"), "detail.md");
    expect(key).toBe("file_v2_abc");
    const upload = calls[0];
    expect(upload?.url).toContain("/im/v1/files");
    expect(upload?.method).toBe("POST");
    expect(upload?.body).toBeInstanceOf(FormData);
    const form = upload?.body as FormData;
    expect(form.get("file_type")).toBe("stream");
    expect(form.get("file_name")).toBe("detail.md");
    expect(form.get("file")).toBeInstanceOf(Blob);

    const r = await src.sendFileMessage("om_root", key);
    const send = calls[1];
    expect(send?.url).toContain("/im/v1/messages/om_root/reply");
    expect(send?.method).toBe("POST");
    const body = JSON.parse(String(send?.body));
    expect(body.msg_type).toBe("file");
    expect(body.reply_in_thread).toBe(true);
    expect(JSON.parse(body.content)).toEqual({ file_key: "file_v2_abc" });
    expect(r.message_id).toBe("om_f1");
  });

  it("surfaces a missing-scope upload error as TaskingError", async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const fetchImpl = uploadFetch(
      calls,
      new Response(JSON.stringify({ code: 99991672, msg: "Access denied" }), { status: 400 }),
    );
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    await expect(src.uploadFile(Buffer.from("x"), "a.md")).rejects.toMatchObject({
      category: "feishu_api_status",
    });
  });
});

describe("FeishuSource.listChatMembers", () => {
  it("lists members with names and follows pagination", async () => {
    const urls: string[] = [];
    const fetchImpl = tokenFetch((url) => {
      urls.push(url);
      if (url.includes("page_token=p2")) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              items: [{ member_id_type: "open_id", member_id: "ou_b", name: "李四" }],
              has_more: false,
              page_token: "",
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            items: [{ member_id_type: "open_id", member_id: "ou_a", name: "张三" }],
            has_more: true,
            page_token: "p2",
          },
        }),
        { status: 200 },
      );
    });
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    const members = await src.listChatMembers("oc_x");
    expect(members).toEqual([
      { open_id: "ou_a", name: "张三" },
      { open_id: "ou_b", name: "李四" },
    ]);
    expect(urls[0]).toContain("/im/v1/chats/oc_x/members");
    expect(urls[0]).toContain("member_id_type=open_id");
    expect(urls[1]).toContain("page_token=p2");
  });

  it("surfaces failure as feishu_api_status", async () => {
    const fetchImpl = tokenFetch(() => new Response("no scope", { status: 400 }));
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    await expect(src.listChatMembers("oc_x")).rejects.toMatchObject({
      category: "feishu_api_status",
    });
  });
});

describe("FeishuSource.listMessages", () => {
  it("polls messages with container_id + start_time and parses them", async () => {
    const holder: { url?: string } = {};
    const fetchImpl = tokenFetch((url) => {
      holder.url = url;
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            items: [
              {
                message_id: "om_1",
                root_id: "",
                msg_type: "text",
                create_time: "1700000001000",
                sender: { sender_id: { open_id: "ou_a" }, sender_name: "Alice" },
                body: { content: JSON.stringify({ text: "hello" }) },
              },
              {
                message_id: "om_2",
                root_id: "om_root",
                msg_type: "text",
                create_time: "1700000002000",
                sender: { sender_id: { open_id: "ou_b" } },
                body: { content: JSON.stringify({ text: "reply" }) },
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    const result = await src.listMessages("oc_intake", "1700000000");
    expect(holder.url).toContain("container_id=oc_intake");
    expect(holder.url).toContain("container_id_type=chat");
    expect(holder.url).toContain("start_time=1700000000");
    expect(result).toHaveLength(2);
    expect(result[0]?.message_id).toBe("om_1");
    expect(result[0]?.root_id).toBeNull();
    expect(result[0]?.text).toBe("hello");
    expect(result[0]?.sender_name).toBe("Alice");
    expect(result[0]?.create_time).toBe("1700000001");
    expect(result[1]?.root_id).toBe("om_root");
    expect(result[1]?.sender_name).toBeNull();
    expect(result[1]?.create_time).toBe("1700000002");
  });

  it("omits start_time when since is empty (cold-start probe, no 24h lookback)", async () => {
    const holder: { url?: string } = {};
    const fetchImpl = tokenFetch((url) => {
      holder.url = url;
      return new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 });
    });
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    await src.listMessages("oc_intake", "");
    expect(holder.url).toContain("container_id=oc_intake");
    expect(holder.url).not.toContain("start_time=");
  });

  it("paginates through has_more/page_token and aggregates all pages", async () => {
    const urls: string[] = [];
    const fetchImpl = tokenFetch((url) => {
      urls.push(String(url));
      if (url.includes("page_token=p2")) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              has_more: false,
              items: [
                {
                  message_id: "om_page2",
                  root_id: "",
                  msg_type: "text",
                  create_time: "1700000010",
                  sender: { sender_id: { open_id: "ou" }, sender_name: "B", sender_type: "user" },
                  body: { content: JSON.stringify({ text: "second page" }) },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            has_more: true,
            page_token: "p2",
            items: [
              {
                message_id: "om_page1",
                root_id: "",
                msg_type: "text",
                create_time: "1700000000",
                sender: { sender_id: { open_id: "ou" }, sender_name: "A", sender_type: "user" },
                body: { content: JSON.stringify({ text: "first page" }) },
              },
            ],
          },
        }),
        { status: 200 },
      );
    });
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    const result = await src.listMessages("oc_intake", "1700000000");
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("page_token=p2");
    expect(result).toHaveLength(2);
    expect(result[0]?.message_id).toBe("om_page1");
    expect(result[1]?.message_id).toBe("om_page2");
  });

  it("flattens post (rich text) messages into plain text", async () => {
    const fetchImpl = tokenFetch(
      () =>
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              items: [
                {
                  message_id: "om_post1",
                  root_id: "",
                  msg_type: "post",
                  create_time: "1700000001",
                  sender: {
                    sender_id: { open_id: "ou" },
                    sender_name: "Alice",
                    sender_type: "user",
                  },
                  body: {
                    content: JSON.stringify({
                      title: "",
                      content: [
                        [{ tag: "text", text: "/issue 标题" }],
                        [{ tag: "text", text: "多行描述" }],
                      ],
                    }),
                  },
                },
              ],
            },
          }),
          { status: 200 },
        ),
    );
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    const result = await src.listMessages("oc_intake", "");
    expect(result[0]?.msg_type).toBe("post");
    expect(result[0]?.text).toBe("/issue 标题\n多行描述");
  });

  it("returns empty list when no items", async () => {
    const fetchImpl = tokenFetch(
      () => new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 }),
    );
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    const result = await src.listMessages("oc_intake", "");
    expect(result).toEqual([]);
  });

  it("surfaces failure as TaskingError", async () => {
    const fetchImpl = tokenFetch(() => new Response("err", { status: 500 }));
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    await expect(src.listMessages("oc_intake", "")).rejects.toThrow(TaskingError);
  });
});

describe("FeishuSource.listThreadReplies", () => {
  it("passes since as start_time for incremental polling", async () => {
    const holder: { url?: string } = {};
    const fetchImpl = tokenFetch((url) => {
      holder.url = url;
      return new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 });
    });
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    await src.listThreadReplies("omt_1", "1700000000");
    expect(holder.url).toContain("container_id=omt_1");
    expect(holder.url).toContain("container_id_type=thread");
    expect(holder.url).toContain("start_time=1700000000");
  });

  it("omits start_time in listThreadReplies when since is empty", async () => {
    const holder: { url?: string } = {};
    const fetchImpl = tokenFetch((url) => {
      holder.url = url;
      return new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 });
    });
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    await src.listThreadReplies("omt_1", null);
    expect(holder.url).toContain("container_id=omt_1");
    expect(holder.url).not.toContain("start_time=");
  });
});

describe("validateFeishuConfig", () => {
  it("fails when enabled but app_id missing", () => {
    const errors = validateFeishuConfig(makeConfig({ app_id: null }));
    expect(errors.some((e) => e.category === "feishu_missing_credentials")).toBe(true);
  });

  it("passes when disabled", () => {
    const errors = validateFeishuConfig(makeConfig({ enabled: false }));
    expect(errors).toHaveLength(0);
  });
});

describe("FeishuSource timeouts", () => {
  it("aborts a stalled request after the timeout instead of hanging forever", async () => {
    const stalled: typeof fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    }) as typeof fetch;
    const src = new FeishuSource(makeConfig(), logger, stalled, {
      defaultMs: 50,
      tokenMs: 50,
    });
    await expect(src.listMessages("oc_intake", "")).rejects.toThrow(TaskingError);
  });
});

describe("toSecondsStr", () => {
  it("normalizes 13-digit ms timestamps to seconds", () => {
    expect(toSecondsStr("1700000001000")).toBe("1700000001");
    expect(toSecondsStr("1700000002000")).toBe("1700000002");
  });

  it("passes through 10-digit second timestamps unchanged", () => {
    expect(toSecondsStr("1700000001")).toBe("1700000001");
  });

  it("returns empty string for invalid or non-positive input", () => {
    expect(toSecondsStr("")).toBe("");
    expect(toSecondsStr("0")).toBe("");
    expect(toSecondsStr("-5")).toBe("");
    expect(toSecondsStr("abc")).toBe("");
  });
});

describe("parseTextContent", () => {
  it("extracts text from JSON content", () => {
    expect(parseTextContent(JSON.stringify({ text: "hello" }))).toBe("hello");
  });

  it("returns raw string when not JSON", () => {
    expect(parseTextContent("plain text")).toBe("plain text");
  });
});

describe("flattenPostContent", () => {
  it("flattens multi-line post content into plain text", () => {
    const content = JSON.stringify({
      title: "",
      content: [
        [{ tag: "text", text: "/issue 标题" }],
        [
          { tag: "text", text: "描述 " },
          { tag: "a", text: "链接", href: "https://x" },
        ],
        [
          { tag: "img", image_key: "k" },
          { tag: "text", text: "结尾" },
        ],
      ],
    });
    expect(flattenPostContent(content)).toBe("/issue 标题\n描述 链接\n[图片]结尾");
  });

  it("renders at blocks as @user_name", () => {
    const content = JSON.stringify({
      title: "",
      content: [
        [
          { tag: "text", text: "hi " },
          { tag: "at", user_id: "ou_1", user_name: "张三" },
          { tag: "text", text: " 再见" },
        ],
      ],
    });
    expect(flattenPostContent(content)).toBe("hi @张三 再见");
  });

  it("prepends non-empty title as first line", () => {
    const content = JSON.stringify({
      title: "标题",
      content: [[{ tag: "text", text: "第一行" }]],
    });
    expect(flattenPostContent(content)).toBe("标题\n第一行");
  });

  it("returns empty string when content is not a post payload", () => {
    expect(flattenPostContent("not json")).toBe("");
    expect(flattenPostContent(JSON.stringify({ foo: 1 }))).toBe("");
  });

  it("returns empty string when post content has no readable text", () => {
    const content = JSON.stringify({
      title: "",
      content: [[{ tag: "board", board_id: "b1" }], [{ tag: "doc", token: "d1" }]],
    });
    expect(flattenPostContent(content)).toBe("");
  });
});

describe("FeishuSource 429 cooldown", () => {
  function cooldownFetch(): { fetchImpl: typeof fetch; calls: () => number } {
    let hits = 0;
    const fetchImpl = tokenFetch(() => {
      hits++;
      return new Response(JSON.stringify({ code: 99991403 }), { status: 429 });
    });
    return { fetchImpl, calls: () => hits };
  }

  it("enters cooldown after a 429 and rejects subsequent calls without hitting the API", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const { fetchImpl, calls } = cooldownFetch();
      const src = new FeishuSource(makeConfig(), logger, fetchImpl);
      await expect(src.listMessages("oc_x", "100")).rejects.toMatchObject({
        details: { status: 429 },
      });
      expect(calls()).toBe(1);
      await expect(src.listMessages("oc_x", "100")).rejects.toMatchObject({
        category: "feishu_cooldown",
      });
      expect(calls()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("doubles the cooldown up to the 10-minute cap and resets on success", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      let status = 429;
      let hits = 0;
      const fetchImpl = tokenFetch(() => {
        hits++;
        return new Response(JSON.stringify({}), { status });
      });
      const countHits = () => hits;
      const src = new FeishuSource(makeConfig(), logger, fetchImpl);
      await expect(src.listMessages("oc_x", "1")).rejects.toMatchObject({
        details: { status: 429 },
      });
      await vi.advanceTimersByTimeAsync(59000);
      await expect(src.listMessages("oc_x", "1")).rejects.toMatchObject({
        category: "feishu_cooldown",
      });
      expect(countHits()).toBe(1);
      await vi.advanceTimersByTimeAsync(2000);
      await expect(src.listMessages("oc_x", "1")).rejects.toMatchObject({
        details: { status: 429 },
      });
      expect(countHits()).toBe(2);
      await vi.advanceTimersByTimeAsync(100000);
      await expect(src.listMessages("oc_x", "1")).rejects.toMatchObject({
        category: "feishu_cooldown",
      });
      expect(countHits()).toBe(2);
      await vi.advanceTimersByTimeAsync(30000);
      status = 200;
      await src.listMessages("oc_x", "1");
      expect(countHits()).toBe(3);
      status = 429;
      await expect(src.listMessages("oc_x", "1")).rejects.toMatchObject({
        details: { status: 429 },
      });
      expect(countHits()).toBe(4);
      await vi.advanceTimersByTimeAsync(61000);
      status = 200;
      await src.listMessages("oc_x", "1");
      expect(countHits()).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("parseMessageAttachments", () => {
  it("collects inline images from a rich-text post", () => {
    const content = JSON.stringify({
      title: "t",
      content: [
        [
          { tag: "text", text: "看这张" },
          { tag: "img", image_key: "img_v2_a" },
        ],
        [{ tag: "img", image_key: "img_v2_b" }],
      ],
    });
    expect(parseMessageAttachments("post", content)).toEqual([
      { kind: "image", key: "img_v2_a", name: "image-1.png" },
      { kind: "image", key: "img_v2_b", name: "image-2.png" },
    ]);
  });

  it("collects a standalone image message", () => {
    expect(parseMessageAttachments("image", JSON.stringify({ image_key: "img_v2_x" }))).toEqual([
      { kind: "image", key: "img_v2_x", name: "image.png" },
    ]);
  });

  it("collects a standalone file message with its name", () => {
    expect(
      parseMessageAttachments(
        "file",
        JSON.stringify({ file_key: "file_v2_y", file_name: "report.pdf" }),
      ),
    ).toEqual([{ kind: "file", key: "file_v2_y", name: "report.pdf" }]);
  });

  it("returns nothing for plain text", () => {
    expect(parseMessageAttachments("text", JSON.stringify({ text: "hi" }))).toEqual([]);
  });
});

describe("FeishuSource.downloadMessageResource", () => {
  it("GETs the resource and returns bytes with the content type", async () => {
    const holder: { url?: string } = {};
    const fetchImpl = tokenFetch((url) => {
      holder.url = url;
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    });
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    const result = await src.downloadMessageResource("om_1", "img_v2_x", "image");
    expect(holder.url).toContain("/im/v1/messages/om_1/resources/img_v2_x");
    expect(holder.url).toContain("type=image");
    expect(Array.from(result.data)).toEqual([1, 2, 3]);
    expect(result.contentType).toContain("image/png");
  });

  it("surfaces failure as TaskingError", async () => {
    const fetchImpl = tokenFetch(() => new Response("too big", { status: 400 }));
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    await expect(src.downloadMessageResource("om_1", "f", "file")).rejects.toMatchObject({
      category: "feishu_api_status",
    });
  });
});

describe("FeishuSource runtime diagnostics", () => {
  function routeFetch(handler: (url: string, init: RequestInit) => Response): typeof fetch {
    return (async (url: RequestInfo | URL, init: RequestInit) => {
      const u = url.toString();
      if (u.includes("tenant_access_token")) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: "t-1", expire: 7200 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return handler(u, init);
    }) as typeof fetch;
  }

  it("maps 403 to a publish/approval hint with the version deep link", async () => {
    const fetchImpl = routeFetch(() => new Response("no permission", { status: 403 }));
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    const err = await src.postMessage("oc_x", "hi").catch((e) => e as TaskingError);
    expect(err.message).toContain("feishu postMessage failed: 403");
    expect(err.message).toMatch(/版本未发布/);
    expect(err.message).toContain("open.feishu.cn/app/cli_test/version");
  });

  it("dedupes the hint for repeated identical failures", async () => {
    const fetchImpl = routeFetch(() => new Response("no permission", { status: 403 }));
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    const first = await src.postMessage("oc_x", "hi").catch((e) => e as TaskingError);
    const second = await src.postMessage("oc_x", "hi").catch((e) => e as TaskingError);
    expect(first.message).toContain("open.feishu.cn/app/cli_test/version");
    expect(second.message).not.toContain("open.feishu.cn");
    expect(second.message).toContain("feishu postMessage failed: 403");
  });

  it("keeps full hints for different methods with the same status", async () => {
    const fetchImpl = routeFetch(() => new Response("no permission", { status: 403 }));
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    await expect(src.postMessage("oc_x", "hi")).rejects.toThrow(/版本未发布/);
    await expect(src.uploadFile(new Uint8Array([1]), "a.txt")).rejects.toThrow(/版本未发布/);
  });

  it("maps body code 230027 to the missing group_msg scope", async () => {
    const fetchImpl = routeFetch(
      () =>
        new Response(JSON.stringify({ code: 230027, msg: "no scope" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    await expect(src.listMessages("oc_x", "")).rejects.toThrow(/im:message\.group_msg/);
  });

  it("maps body code 99991672 to missing im:resource", async () => {
    const fetchImpl = routeFetch(
      () =>
        new Response(JSON.stringify({ code: 99991672, msg: "Access denied" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    await expect(src.uploadFile(new Uint8Array([1]), "a.txt")).rejects.toThrow(/im:resource/);
  });

  it("does not decorate unrelated failures", async () => {
    const fetchImpl = routeFetch(() => new Response("boom", { status: 500 }));
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    const err = await src.postMessage("oc_x", "hi").catch((e) => e as TaskingError);
    expect(err.message).not.toMatch(/版本未发布/);
  });
});

describe("FeishuSource runtime diagnostics (hint bookkeeping)", () => {
  function routeFetch(handler: (url: string, init: RequestInit) => Response): typeof fetch {
    return (async (url: RequestInfo | URL, init: RequestInit) => {
      const u = url.toString();
      if (u.includes("tenant_access_token")) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: "t-1", expire: 7200 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return handler(u, init);
    }) as typeof fetch;
  }

  it("does not consume the once-only slot when no hint is derivable", async () => {
    let call = 0;
    const fetchImpl = routeFetch(() => {
      call++;
      return call === 1
        ? new Response("boom no code", { status: 400 })
        : new Response(JSON.stringify({ code: 230027 }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
    });
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    const first = await src.listMessages("oc_x", "").catch((e) => e as TaskingError);
    const second = await src.listMessages("oc_x", "").catch((e) => e as TaskingError);
    expect(first.message).not.toContain("im:message.group_msg");
    expect(second.message).toContain("im:message.group_msg");
  });
});

describe("FeishuSource interface language exit", () => {
  afterEach(() => {
    setLocale("zh");
  });

  it("translates outbound postMessage text when locale is en", async () => {
    setLocale("en");
    const holder: { body?: unknown } = {};
    const fetchImpl = tokenFetch((url, init) => {
      if (init.body) holder.body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ code: 0, data: { message_id: "om_1" } }), {
        status: 200,
      });
    });
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    await src.postMessage("oc_x", "已取消");
    const body = holder.body as { content: string };
    expect(JSON.parse(body.content).text).toBe("Cancelled");
  });

  it("translates replyInThread text when locale is en", async () => {
    setLocale("en");
    const holder: { body?: unknown } = {};
    const fetchImpl = tokenFetch((url, init) => {
      if (init.body) holder.body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ code: 0, data: { message_id: "om_1" } }), {
        status: 200,
      });
    });
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    await src.replyInThread("om_root", "已取消");
    const body = holder.body as { content: string };
    expect(JSON.parse(body.content).text).toBe("Cancelled");
  });

  it("passes text through unchanged when locale is zh", async () => {
    const holder: { body?: unknown } = {};
    const fetchImpl = tokenFetch((url, init) => {
      if (init.body) holder.body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ code: 0, data: { message_id: "om_1" } }), {
        status: 200,
      });
    });
    const src = new FeishuSource(makeConfig(), logger, fetchImpl);
    await src.postMessage("oc_x", "已取消");
    const body = holder.body as { content: string };
    expect(JSON.parse(body.content).text).toBe("已取消");
  });
});
