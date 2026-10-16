import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeishuSource } from "../src/adapters/feishu/source.js";
import {
  JiraTracker,
  flattenAdfText,
  wrapCommentBody,
  wrapDescription,
} from "../src/adapters/jira/tracker.js";
import { type Binding, BindingStore } from "../src/bridge/binding-store.js";
import {
  type ParsedAgent,
  type ParsedIssue,
  type ParsedState,
  parseAgent,
  parseIssue,
  parseState,
} from "../src/bridge/commands.js";
import { CommentBridge, type SchedulerPort } from "../src/bridge/comment-bridge.js";
import type { EffectiveConfig, FeishuConfig, TrackerConfig } from "../src/config/config-types.js";
import { resolveConfig } from "../src/config/resolver.js";
import { DirectSessionManager } from "../src/direct/manager.js";
import { ConsoleLogger } from "../src/observability/logger.js";
import {
  type MockHandler,
  type MockServer,
  createMockJiraServer,
} from "./helpers/mock-http-server.js";

const logger = new ConsoleLogger({}, () => {});

function baseConfig(
  over: Partial<{ tracker: Partial<TrackerConfig>; feishu: Partial<FeishuConfig> }> = {},
): EffectiveConfig {
  return resolveConfig(
    {
      tracker: {
        kind: "jira",
        api_key: "tok",
        api_user: "you@example.com",
        project_key: "ENG",
        ...over.tracker,
      },
      feishu: {
        enabled: true,
        app_id: "c",
        app_secret: "s",
        intake_chat_id: "oc_intake",
        forward_interval_ms: 5000,
        sweep_interval_ms: 60000,
        create_issue_type: "Task",
        ...over.feishu,
      },
    },
    "/tmp",
    "prompt",
  );
}

function getOrFail(store: BindingStore, id: string): Binding {
  const b = store.getBinding(id);
  if (!b) throw new Error(`binding ${id} missing`);
  return b;
}
function issueOrFail(text: string): ParsedIssue {
  const p = parseIssue(text);
  if (!p) throw new Error("not an issue");
  return p;
}
function stateOrFail(text: string): ParsedState {
  const p = parseState(text);
  if (!p) throw new Error("not a state");
  return p;
}
function agentOrFail(text: string): ParsedAgent {
  const p = parseAgent(text);
  if (!p) throw new Error("not an agent command");
  return p;
}

function makeIssue(id: string, key: string, fields: Record<string, unknown> = {}): unknown {
  return { id, key, fields: { status: { name: "To Do" }, ...fields } };
}

function searchResponse(issues: unknown[], total?: number): unknown {
  return { total: total ?? issues.length, issues };
}

interface FeishuRecorder {
  replies: Array<{ rootId: string; text: string }>;
  cards: Array<{ rootId: string; card: unknown }>;
  updates: Array<{ messageId: string; card: unknown }>;
  files: Array<{ fileName: string }>;
  deleted: string[];
  fileMessages: Array<{ rootId: string; fileKey: string }>;
  posted: Array<{ chatId: string; text: string }>;
  listItems: Record<string, Array<Record<string, unknown>>>;
  counter: number;
  fetchImpl: typeof fetch;
}

function feishuRecorder(
  items: Record<string, Array<Record<string, unknown>>> = {},
): FeishuRecorder {
  const rec: FeishuRecorder = {
    replies: [],
    cards: [],
    updates: [],
    files: [],
    fileMessages: [],
    deleted: [],
    posted: [],
    listItems: items,
    counter: 0,
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
      if (u.includes("/im/v1/messages/") && u.endsWith("/reply")) {
        const rootId = u.split("/im/v1/messages/")[1]?.split("/")[0] ?? "";
        const content = JSON.parse(String(body.content)) as Record<string, unknown>;
        if (body.msg_type === "interactive") rec.cards.push({ rootId, card: content });
        else if (body.msg_type === "file")
          rec.fileMessages.push({ rootId, fileKey: String(content.file_key ?? "") });
        else rec.replies.push({ rootId, text: content.text });
        const msgId = `om_r${rec.counter++}`;
        const threadId = body.reply_in_thread ? `omt_${rootId}` : undefined;
        const replyRootId = body.reply_in_thread ? `om_topic_${rootId}` : rootId;
        return new Response(
          JSON.stringify({
            code: 0,
            data: { message_id: msgId, root_id: replyRootId, thread_id: threadId },
          }),
          { status: 200 },
        );
      }
      if (u.includes("/chats/") && u.includes("/members")) {
        return new Response(
          JSON.stringify({ code: 0, data: { items: [{ member_id: "ou_op", name: "张三" }] } }),
          { status: 200 },
        );
      }
      if (u.includes("/im/v1/messages/") && init.method === "DELETE") {
        rec.deleted.push(u.split("/im/v1/messages/")[1]?.split("?")[0] ?? "");
        return new Response(JSON.stringify({ code: 0 }), { status: 200 });
      }
      if (u.includes("/im/v1/files") && init.method === "POST") {
        const form = init.body instanceof FormData ? init.body : null;
        rec.files.push({ fileName: form === null ? "" : String(form.get("file_name") ?? "") });
        return new Response(
          JSON.stringify({ code: 0, data: { file_key: `file_v2_${rec.files.length}` } }),
          { status: 200 },
        );
      }
      if (u.includes("/im/v1/messages/") && init.method === "PATCH") {
        const messageId = u.split("/im/v1/messages/")[1] ?? "";
        rec.updates.push({ messageId, card: JSON.parse(String(body.content)) });
        return new Response(JSON.stringify({ code: 0 }), { status: 200 });
      }
      if (u.includes("/im/v1/messages") && init.method === "POST") {
        rec.posted.push({ chatId: body.receive_id, text: JSON.parse(body.content).text });
        return new Response(
          JSON.stringify({ code: 0, data: { message_id: `om_p${rec.counter++}` } }),
          { status: 200 },
        );
      }
      if (u.includes("/im/v1/messages/") && u.includes("/replies") && init.method === "GET") {
        const rootId = u.split("/im/v1/messages/")[1]?.split("/")[0] ?? "";
        return new Response(
          JSON.stringify({ code: 0, data: { items: rec.listItems[rootId] ?? [] } }),
          { status: 200 },
        );
      }
      if (u.includes("/im/v1/messages") && init.method === "GET") {
        const cid = new URL(u).searchParams.get("container_id") ?? "";
        return new Response(
          JSON.stringify({ code: 0, data: { items: rec.listItems[cid] ?? [] } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    }) as typeof fetch,
  };
  return rec;
}

describe("CommentBridge sync", () => {
  let server: MockServer | null = null;
  let root: string;
  let bindings: BindingStore;
  let bridge: CommentBridge;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "tasking-cb-"));
    bindings = new BindingStore(join(root, "b.db"));
  });

  afterEach(async () => {
    bridge?.stop();
    bindings.close();
    rmSync(root, { recursive: true, force: true });
    if (server) {
      await server.close();
      server = null;
    }
  });

  it("forwardComments forwards agent comment, skips sentinel, advances cursor", async () => {
    const sentinelText = "💬 张三 via 飞书:\nbridgetext";
    const handler: MockHandler = () => ({
      status: 200,
      body: {
        comments: [
          {
            id: "101",
            author: { emailAddress: "you@example.com" },
            body: wrapCommentBody("agent says hi", true),
            created: "t1",
          },
          {
            id: "102",
            author: { displayName: "Zhang" },
            body: wrapCommentBody(sentinelText, true),
            created: "t2",
          },
        ],
      },
    });
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.forwardComments(getOrFail(bindings, "1"), config);
    expect(rec.replies).toHaveLength(0);
    expect(rec.cards).toHaveLength(1);
    expect(rec.cards[0]?.rootId).toBe("om_root");
    expect(JSON.stringify(rec.cards[0]?.card)).toContain("🤖 agent");
    expect(JSON.stringify(rec.cards[0]?.card)).toContain("agent says hi");
    expect(JSON.stringify(rec.cards[0]?.card)).not.toContain("完整输出");
    expect(bindings.getBinding("1")?.last_jira_comment_id).toBe("102");
  });

  it("forwardComments persists healed thread_id to the binding store", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: {
        comments: [
          {
            id: "101",
            author: { displayName: "Zhang" },
            body: wrapCommentBody("heal me", true),
            created: "t1",
          },
        ],
      },
    });
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    expect(bindings.getBinding("1")?.thread_id).toBeNull();
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.forwardComments(getOrFail(bindings, "1"), config);
    expect(bindings.getBinding("1")?.thread_id).toBe("omt_om_root");
  });

  it("forwardComments forwards a comment that merely mentions 'via 飞书' in prose", async () => {
    const prose = "完成：TAS-4 优化集合\n2. sentinel comment 写入（`via 飞书` 防回投）";
    const handler: MockHandler = () => ({
      status: 200,
      body: {
        comments: [
          {
            id: "301",
            author: { displayName: "heihei" },
            body: wrapCommentBody(prose, true),
            created: "t1",
          },
        ],
      },
    });
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.forwardComments(getOrFail(bindings, "1"), config);
    expect(rec.replies).toHaveLength(0);
    expect(rec.cards).toHaveLength(1);
    expect(JSON.stringify(rec.cards[0]?.card)).toContain("完成：TAS-4 优化集合");
    expect(bindings.getBinding("1")?.last_jira_comment_id).toBe("301");
  });

  it("forwards a long comment as a truncated card with full-output and open-Jira buttons", async () => {
    const long = `开始\n${"x".repeat(30000)}`;
    const handler: MockHandler = () => ({
      status: 200,
      body: {
        comments: [
          {
            id: "401",
            author: { displayName: "Zhang" },
            body: wrapCommentBody(long, true),
            created: "t1",
          },
        ],
      },
    });
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.forwardComments(getOrFail(bindings, "1"), config);

    expect(rec.replies).toHaveLength(0);
    expect(rec.cards).toHaveLength(1);
    const card = JSON.stringify(rec.cards[0]?.card);
    expect(card).toContain("💬 Zhang (Jira)");
    expect(card).toContain("已截断");
    expect(card).toContain("完整输出");
    expect(card).toContain('"kind":"bridge"');
    expect(card).toContain('"root_id":"om_root"');
    expect(card).toContain("open_url");
    expect(card).toContain(`${server.baseUrl}/browse/ENG-1`);
  });

  it("full-output button sends the whole comment as an .md file", async () => {
    const long = `开始\n${"y".repeat(30000)}`;
    const handler: MockHandler = () => ({
      status: 200,
      body: {
        comments: [
          {
            id: "402",
            author: { displayName: "Zhang" },
            body: wrapCommentBody(long, true),
            created: "t1",
          },
        ],
      },
    });
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.forwardComments(getOrFail(bindings, "1"), config);

    const reply = await bridge.handleCardAction({
      messageId: "om_card_x",
      chatId: "oc_intake",
      operatorOpenId: "ou_op",
      operatorName: "张三",
      value: { action: "full", kind: "bridge", issue_id: "1", comment_id: "402" },
    });
    expect(reply?.toast.type).toBe("info");
    await new Promise((r) => setTimeout(r, 50));
    expect(rec.updates).toHaveLength(0);
    expect(rec.files).toHaveLength(1);
    expect(rec.files[0]?.fileName).toContain("ENG-1");
    expect(rec.fileMessages).toEqual([{ rootId: "om_root", fileKey: "file_v2_1" }]);
  });

  it("/issue discover replies with an issue-type card", async () => {
    server = await createMockJiraServer(() => ({
      status: 200,
      body: { issueTypes: [{ name: "Task" }, { name: "Bug" }] },
    }));
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.executeIssue(
      { kind: "discover", title: null, description: "", typeOverride: null, agentOverride: null },
      "om_intake",
      config,
    );
    expect(rec.replies).toHaveLength(0);
    expect(rec.cards).toHaveLength(1);
    const card = JSON.stringify(rec.cards[0]?.card);
    expect(card).toContain("Task");
    expect(card).toContain("Bug");
    expect(card).toContain("默认");
  });

  it("deduplicates repeated bridge card actions", async () => {
    const reply = await bridge
      .handleCardAction({
        messageId: "om_card_dup",
        chatId: "oc_intake",
        operatorOpenId: "ou_op",
        operatorName: "张三",
        value: { action: "full", kind: "bridge", issue_id: "1", comment_id: "9" },
      })
      .then(() => undefined);
    expect(reply).toBeUndefined();
    const again = await bridge.handleCardAction({
      messageId: "om_card_dup",
      chatId: "oc_intake",
      operatorOpenId: "ou_op",
      operatorName: "张三",
      value: { action: "full", kind: "bridge", issue_id: "1", comment_id: "9" },
    });
    expect(again?.toast.content).toBe("该操作已处理");
  });

  it("patches the stored state card when the issue disappears, republishing if the patch fails", async () => {
    server = await createMockJiraServer(() => ({
      status: 404,
      body: { errorMessages: ["Issue does not exist"] },
    }));
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    bindings.setBindingCardId("1", "om_state_card");
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.forwardComments(getOrFail(bindings, "1"), config);
    expect(bindings.getBinding("1")?.status).toBe("terminal");
    expect(rec.updates).toHaveLength(1);
    expect(JSON.stringify(rec.updates[0]?.card)).toContain("已完结");
  });

  it("cancelling the transition flow writes nothing", async () => {
    const posts: string[] = [];
    const handler: MockHandler = (req) => {
      if (req.url.endsWith("/transitions") && req.method === "POST") {
        posts.push(req.url);
        return { status: 204, body: "" };
      }
      if (req.url.endsWith("/transitions") && req.method === "GET") {
        return {
          status: 200,
          body: { transitions: [{ id: "11", name: "To Done", to: { name: "Done" } }] },
        };
      }
      return { status: 200, body: searchResponse([makeIssue("1", "ENG-1")]) };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    const click = (value: Record<string, unknown>) =>
      bridge.handleCardAction({
        messageId: "om_state",
        chatId: "oc_intake",
        operatorOpenId: "ou_op",
        operatorName: "张三",
        value,
      });
    const open = await click({ action: "state_open", kind: "bridge", issue_id: "1" });
    expect(JSON.stringify(open?.card)).toContain("Done");
    const cancel = await click({ action: "tr_cancel", kind: "bridge", issue_id: "1" });
    expect(cancel?.toast.content).toBe("已取消");
    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toHaveLength(0);
  });

  it("/agent list card buttons switch the task agent", async () => {
    const labelUpdates: Array<{ key: string; labels: string[] }> = [];
    const handler: MockHandler = (req) => {
      if (req.method === "PUT" && req.url.includes("/issue/")) {
        labelUpdates.push({
          key: req.url,
          labels: ((req.body as { fields?: { labels?: string[] } }).fields?.labels ?? []).map(
            String,
          ),
        });
        return { status: 204, body: "" };
      }
      if (req.method === "POST" && req.url.endsWith("/search")) {
        return {
          status: 200,
          body: searchResponse([makeIssue("1", "ENG-1", { labels: ["agent:review"] })]),
        };
      }
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    config.opencode.agents = ["build", "review"];
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.executeAgent(agentOrFail("/agent"), getOrFail(bindings, "1"), "om_root", config);
    const card = JSON.stringify(rec.cards[0]?.card);
    expect(card).toContain("agent_set");
    expect(card).toContain("build");
    expect(card).toContain("↩️ 默认");
    // buttons must route back to the bridge, not the direct handler
    expect(card).toContain('"kind":"bridge"');
    expect(card).toContain('"root_id":"om_root"');

    const reply = await bridge.handleCardAction({
      messageId: "om_agent_card",
      chatId: "oc_intake",
      operatorOpenId: "ou_op",
      operatorName: "张三",
      value: { action: "agent_set", kind: "bridge", issue_id: "1", agent: "build" },
    });
    expect(reply?.toast.type).toBe("info");
    await new Promise((r) => setTimeout(r, 50));
    expect(labelUpdates).toHaveLength(1);
    expect(labelUpdates[0]?.labels).toContain("agent:build");
    expect(labelUpdates[0]?.labels).not.toContain("agent:review");
    expect(rec.replies.some((r) => r.text.includes("agent:build"))).toBe(true);
    expect(rec.updates).toHaveLength(1);
    expect(JSON.stringify(rec.updates[0]?.card)).toContain("🧠 Agent");
  });

  it("reports and refreshes when a confirmed transition is no longer available", async () => {
    const handler: MockHandler = (req) => {
      if (req.url.endsWith("/transitions") && req.method === "POST") {
        return { status: 400, body: { errorMessages: ["Transition is not valid"] } };
      }
      return { status: 200, body: searchResponse([makeIssue("1", "ENG-1")]) };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.handleCardAction({
      messageId: "om_state",
      chatId: "oc_intake",
      operatorOpenId: "ou_op",
      operatorName: "张三",
      value: {
        action: "tr_confirm",
        kind: "bridge",
        issue_id: "1",
        transition_id: "11",
        transition_name: "Done",
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(rec.replies.some((r) => r.text.includes("转状态失败"))).toBe(true);
    expect(bindings.getBinding("1")?.status).toBe("active");
  });

  it("read-only card actions are repeatable within the dedup window", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: searchResponse([makeIssue("1", "ENG-1")]),
    });
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    const click = () =>
      bridge.handleCardAction({
        messageId: "om_state",
        chatId: "oc_intake",
        operatorOpenId: "ou_op",
        operatorName: "张三",
        value: { action: "state_refresh", kind: "bridge", issue_id: "1" },
      });
    const first = await click();
    const second = await click();
    expect(first?.toast.type).toBe("success");
    expect(second?.toast.type).toBe("success");
    expect(second?.toast.content).not.toBe("该操作已处理");
  });

  it("/state recalls the state card: deletes the old one and sends a fresh card", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: searchResponse([makeIssue("1", "ENG-1")]),
    });
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });

    await bridge.executeState(stateOrFail("/state"), getOrFail(bindings, "1"), config);
    const first = bindings.getBinding("1")?.card_message_id;
    expect(first).toBeTruthy();
    expect(rec.deleted).toHaveLength(0);
    expect(JSON.stringify(rec.cards[0]?.card)).toContain('"kind":"bridge"');

    await bridge.executeState(stateOrFail("/state"), getOrFail(bindings, "1"), config);
    expect(rec.deleted).toEqual([first]);
    expect(rec.cards).toHaveLength(2);
    expect(bindings.getBinding("1")?.card_message_id).toBeTruthy();
    expect(bindings.getBinding("1")?.card_message_id).not.toBe(first);
  });

  it("comment cards summon a fresh state card at the topic bottom", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: {
        comments: [
          {
            id: "501",
            author: { displayName: "Zhang" },
            body: wrapCommentBody("看看状态", true),
            created: "t1",
          },
        ],
      },
    });
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.forwardComments(getOrFail(bindings, "1"), config);
    expect(rec.cards).toHaveLength(1);
    expect(JSON.stringify(rec.cards[0]?.card)).toContain("📋 状态");

    const reply = await bridge.handleCardAction({
      messageId: "om_comment_card",
      chatId: "oc_intake",
      operatorOpenId: "ou_op",
      operatorName: "张三",
      value: { action: "state_summon", kind: "bridge", issue_id: "1" },
    });
    expect(reply?.toast.type).toBe("info");
    await new Promise((r) => setTimeout(r, 50));
    expect(rec.cards).toHaveLength(2);
    expect(JSON.stringify(rec.cards[1]?.card)).toContain("状态：");
    expect(bindings.getBinding("1")?.card_message_id).toBeTruthy();
  });

  it("transition broadcast resolves the operator display name from the member list", async () => {
    const handler: MockHandler = (req) => {
      if (req.url.endsWith("/transitions") && req.method === "POST") {
        return { status: 204, body: "" };
      }
      return { status: 200, body: searchResponse([makeIssue("1", "ENG-1")]) };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.handleCardAction({
      messageId: "om_state",
      chatId: "oc_intake",
      operatorOpenId: "ou_op",
      operatorName: null,
      value: {
        action: "tr_confirm",
        kind: "bridge",
        issue_id: "1",
        transition_id: "11",
        transition_name: "Done",
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    const broadcast = rec.replies.find((r) => r.text.includes("已转 Done"));
    expect(broadcast?.text).toContain("操作人：张三");
    expect(broadcast?.text).not.toContain("ou_op");
  });

  it("/state <N> patches the state card with the real assignee", async () => {
    const handler: MockHandler = (req) => {
      if (req.url.endsWith("/transitions") && req.method === "GET") {
        return {
          status: 200,
          body: { transitions: [{ id: "11", name: "To Done", to: { name: "Done" } }] },
        };
      }
      if (req.url.endsWith("/transitions") && req.method === "POST") {
        return { status: 204, body: "" };
      }
      if (req.method === "POST" && req.url.endsWith("/search")) {
        return {
          status: 200,
          body: searchResponse([
            makeIssue("1", "ENG-1", { status: { name: "Done" }, assignee: { name: "zhangsan" } }),
          ]),
        };
      }
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.executeState(stateOrFail("/state"), getOrFail(bindings, "1"), config);
    const firstCardId = bindings.getBinding("1")?.card_message_id ?? "";
    expect(firstCardId).not.toBe("");
    await bridge.executeState(stateOrFail("/state 1"), getOrFail(bindings, "1"), config);
    const patched = rec.updates.find((u) => u.messageId === firstCardId);
    expect(JSON.stringify(patched?.card)).toContain("zhangsan");
    expect(JSON.stringify(patched?.card)).toContain("Done");
  });

  it("state card refresh button re-queries and replaces the card", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: searchResponse([makeIssue("1", "ENG-1", { status: { name: "In Review" } })]),
    });
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    const reply = await bridge.handleCardAction({
      messageId: "om_state",
      chatId: "oc_intake",
      operatorOpenId: "ou_op",
      operatorName: "张三",
      value: { action: "state_refresh", kind: "bridge", issue_id: "1" },
    });
    expect(reply?.toast.type).toBe("success");
    const card = JSON.stringify(reply?.card);
    expect(card).toContain("In Review");
    expect(card).toContain("刷新");
  });

  it("re-entering the transition flow re-confirms with a fresh render seq", async () => {
    const posts: string[] = [];
    const handler: MockHandler = (req) => {
      if (req.url.endsWith("/transitions") && req.method === "GET") {
        return {
          status: 200,
          body: { transitions: [{ id: "11", name: "To Done", to: { name: "Done" } }] },
        };
      }
      if (req.url.endsWith("/transitions") && req.method === "POST") {
        posts.push(req.url);
        return { status: 204, body: "" };
      }
      return { status: 200, body: searchResponse([makeIssue("1", "ENG-1")]) };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    const buttonValue = (card: unknown, action: string): Record<string, unknown> | undefined => {
      const elements =
        (card as { body?: { elements?: Array<Record<string, unknown>> } }).body?.elements ?? [];
      for (const el of elements) {
        const behaviors =
          (el as { behaviors?: Array<{ type?: string; value?: Record<string, unknown> }> })
            .behaviors ?? [];
        for (const b of behaviors) {
          if (b.type === "callback" && b.value?.action === action) return b.value;
        }
      }
      return undefined;
    };
    const click = (value: Record<string, unknown>) =>
      bridge.handleCardAction({
        messageId: "om_state",
        chatId: "oc_intake",
        operatorOpenId: "ou_op",
        operatorName: "张三",
        value,
      });
    const runOnce = async () => {
      const open = await click({ action: "state_open", kind: "bridge", issue_id: "1" });
      const tr = buttonValue(open?.card, "tr");
      if (tr === undefined) throw new Error("no tr button");
      const confirm = await click(tr);
      const confirmVal = buttonValue(confirm?.card, "tr_confirm");
      if (confirmVal === undefined) throw new Error("no confirm button");
      return click(confirmVal);
    };
    const first = await runOnce();
    expect(first?.toast.content).toBe("正在转换…");
    await new Promise((r) => setTimeout(r, 50));
    const second = await runOnce();
    expect(second?.toast.content).toBe("正在转换…");
    expect(second?.toast.content).not.toBe("该操作已处理");
    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toHaveLength(2);
  });

  it("state card buttons open, confirm and apply a transition", async () => {
    const posts: string[] = [];
    const handler: MockHandler = (req) => {
      if (req.url.endsWith("/transitions") && req.method === "GET") {
        return {
          status: 200,
          body: { transitions: [{ id: "11", name: "To Done", to: { name: "Done" } }] },
        };
      }
      if (req.url.endsWith("/transitions") && req.method === "POST") {
        posts.push(req.url);
        return { status: 204, body: "" };
      }
      return { status: 200, body: searchResponse([makeIssue("1", "ENG-1")]) };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    let nudged = 0;
    bridge = new CommentBridge({
      tracker,
      feishu,
      bindings,
      config: () => config,
      logger,
      requestRefresh: () => {
        nudged++;
        return true;
      },
    });
    const click = (value: Record<string, unknown>) => ({
      messageId: "om_state",
      chatId: "oc_intake",
      operatorOpenId: "ou_op",
      operatorName: "张三",
      value,
    });

    const open = await bridge.handleCardAction(
      click({ action: "state_open", kind: "bridge", issue_id: "1" }),
    );
    const openCard = JSON.stringify(open?.card);
    expect(openCard).toContain("状态：");
    expect(openCard).toContain('"kind":"bridge"');
    expect(openCard).toContain("Done");
    expect(openCard).toContain("transition_id");

    const confirm = await bridge.handleCardAction(
      click({
        action: "tr",
        kind: "bridge",
        issue_id: "1",
        transition_id: "11",
        transition_name: "Done",
      }),
    );
    expect(JSON.stringify(confirm?.card)).toContain("确认转为「Done」");

    const applied = await bridge.handleCardAction(
      click({
        action: "tr_confirm",
        kind: "bridge",
        issue_id: "1",
        transition_id: "11",
        transition_name: "Done",
      }),
    );
    expect(applied?.toast.type).toBe("info");
    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toHaveLength(1);
    expect(nudged).toBe(1);
    expect(rec.updates.some((u) => JSON.stringify(u.card).includes("状态："))).toBe(true);
    expect(rec.replies.some((r) => r.text.includes("已转 Done"))).toBe(true);
  });

  it("forwardComments holds cursor when reply fails, then retries on next tick", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: {
        comments: [
          {
            id: "201",
            author: { emailAddress: "you@example.com" },
            body: wrapCommentBody("agent says hi", true),
            created: "t1",
          },
        ],
      },
    });
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const failReplyFetch: typeof fetch = (async (url: RequestInfo | URL, init: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const body = init.body ? JSON.parse(init.body as string) : {};
      if (body.app_id !== undefined) {
        return new Response(JSON.stringify({ tenant_access_token: "t", expire: 7200 }), {
          status: 200,
        });
      }
      if (u.includes("/reply")) {
        return new Response("err", { status: 500 });
      }
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    }) as typeof fetch;
    const feishu = new FeishuSource(config.feishu, logger, failReplyFetch);
    const lines: string[] = [];
    const collectingLogger = new ConsoleLogger({}, (line) => lines.push(line));
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    bridge = new CommentBridge({
      tracker,
      feishu,
      bindings,
      config: () => config,
      logger: collectingLogger,
    });
    await bridge.forwardComments(getOrFail(bindings, "1"), config);
    expect(bindings.getBinding("1")?.last_jira_comment_id).toBeNull();
    expect(lines.some((l) => l.includes("cursor held for retry"))).toBe(true);

    const rec = feishuRecorder();
    const feishu2 = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bridge = new CommentBridge({
      tracker,
      feishu: feishu2,
      bindings,
      config: () => config,
      logger,
    });
    await bridge.forwardComments(getOrFail(bindings, "1"), config);
    expect(rec.replies).toHaveLength(0);
    expect(rec.cards).toHaveLength(1);
    expect(JSON.stringify(rec.cards[0]?.card)).toContain("agent says hi");
    expect(JSON.stringify(rec.cards[0]?.card)).not.toContain("完整输出");
    expect(bindings.getBinding("1")?.last_jira_comment_id).toBe("201");
  });

  it("bridgeMessages bridges human free-text with sentinel, skips bot + command", async () => {
    const items = [
      {
        message_id: "om_a",
        root_id: "om_root",
        msg_type: "text",
        create_time: "1",
        sender: { sender_id: { open_id: "o" }, sender_type: "app" },
        body: { content: JSON.stringify({ text: "bot ack" }) },
      },
      {
        message_id: "om_b",
        root_id: "om_root",
        msg_type: "text",
        create_time: "2",
        sender: { sender_id: { open_id: "h1" }, sender_name: "Alice", sender_type: "user" },
        body: { content: JSON.stringify({ text: "/state" }) },
      },
      {
        message_id: "om_c",
        root_id: "om_root",
        msg_type: "text",
        create_time: "3",
        sender: { sender_id: { open_id: "h2" }, sender_name: "Bob", sender_type: "user" },
        body: { content: JSON.stringify({ text: "please fix the bug" }) },
      },
    ];
    const postedComments: Array<{ key: string; body: string }> = [];
    const handler: MockHandler = (req) => {
      if (req.method === "POST" && req.url.endsWith("/comment")) {
        const b = req.body as { body?: unknown };
        postedComments.push({ key: req.url, body: flattenAdfText(b.body) });
        return { status: 201, body: { id: "c1" } };
      }
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder({ oc_intake: items, om_root: items });
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.bridgeMessages(getOrFail(bindings, "1"), config);
    expect(postedComments).toHaveLength(1);
    expect(postedComments[0]?.body).toContain("💬 Bob via Feishu:");
    expect(postedComments[0]?.body).toContain("please fix the bug");
    expect(bindings.getBinding("1")?.last_feishu_msg_id).toBe("3");
  });

  it("bridgeMessages bridges post-type free text and handles post-type commands", async () => {
    const items = [
      {
        message_id: "om_post_a",
        root_id: "om_root",
        msg_type: "post",
        create_time: "1",
        sender: { sender_id: { open_id: "h1" }, sender_name: "Alice", sender_type: "user" },
        body: {
          content: JSON.stringify({
            title: "",
            content: [
              [
                { tag: "text", text: "please fix the bug" },
                { tag: "text", text: " again" },
              ],
            ],
          }),
        },
      },
      {
        message_id: "om_post_b",
        root_id: "om_root",
        msg_type: "post",
        create_time: "2",
        sender: { sender_id: { open_id: "h2" }, sender_name: "Bob", sender_type: "user" },
        body: {
          content: JSON.stringify({
            title: "",
            content: [[{ tag: "text", text: "/state" }]],
          }),
        },
      },
    ];
    const postedComments: Array<{ key: string; body: string }> = [];
    const handler: MockHandler = (req) => {
      if (req.method === "POST" && req.url.endsWith("/comment")) {
        postedComments.push({
          key: req.url,
          body: flattenAdfText((req.body as { body?: unknown }).body),
        });
        return { status: 201, body: { id: "c1" } };
      }
      if (req.url.endsWith("/transitions") && req.method === "GET") {
        return {
          status: 200,
          body: { transitions: [{ id: "11", name: "To Done", to: { name: "Done" } }] },
        };
      }
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder({ om_root: items });
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.bridgeMessages(getOrFail(bindings, "1"), config);
    expect(postedComments).toHaveLength(1);
    expect(postedComments[0]?.body).toContain("please fix the bug again");
    expect(rec.cards.some((c) => JSON.stringify(c.card).includes("状态："))).toBe(true);
  });

  it("bridgeMessages replies success ack under the user message after bridging", async () => {
    const items = [
      {
        message_id: "om_c",
        root_id: "om_root",
        msg_type: "text",
        create_time: "3",
        sender: { sender_id: { open_id: "h2" }, sender_name: "Bob", sender_type: "user" },
        body: { content: JSON.stringify({ text: "please fix the bug" }) },
      },
    ];
    const postedComments: string[] = [];
    const handler: MockHandler = (req) => {
      if (req.method === "POST" && req.url.endsWith("/comment")) {
        postedComments.push(flattenAdfText((req.body as { body?: unknown }).body));
        return { status: 201, body: { id: "c1" } };
      }
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder({ om_root: items });
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.bridgeMessages(getOrFail(bindings, "1"), config);
    expect(postedComments).toHaveLength(1);
    expect(rec.replies).toHaveLength(1);
    expect(rec.replies[0]?.rootId).toBe("om_c");
    expect(rec.replies[0]?.text).toBe("✅ 已收到，已同步到 ENG-1");
  });

  it("bridgeMessages replies failure ack after a failed postComment and advances cursor", async () => {
    const items = [
      {
        message_id: "om_fail",
        root_id: "om_root",
        msg_type: "text",
        create_time: "4",
        sender: { sender_id: { open_id: "h1" }, sender_name: "Alice", sender_type: "user" },
        body: { content: JSON.stringify({ text: "please fix" }) },
      },
    ];
    const handler: MockHandler = (req) => {
      if (req.method === "POST" && req.url.endsWith("/comment")) {
        return { status: 500, body: { errorMessages: ["boom"] } };
      }
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder({ om_root: items });
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      await bridge.bridgeMessages(getOrFail(bindings, "1"), config);
      expect(rec.replies).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(30000);
      await bridge.whenIdle();
      await vi.advanceTimersByTimeAsync(120000);
      await bridge.whenIdle();
      expect(rec.replies).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(600000);
      await bridge.whenIdle();
      expect(rec.replies).toHaveLength(1);
      expect(rec.replies[0]?.rootId).toBe("om_fail");
      expect(rec.replies[0]?.text).toBe("⚠️ 同步失败，请稍后重试");
      expect(bindings.getBinding("1")?.status).toBe("active");
      expect(bindings.getBinding("1")?.last_feishu_msg_id).toBe("4");
    } finally {
      vi.useRealTimers();
    }
  });

  it("bridgeMessages does not re-post messages older than the persisted cursor after restart", async () => {
    const items = [
      {
        message_id: "om_old",
        root_id: "om_root",
        msg_type: "text",
        create_time: "1",
        sender: { sender_id: { open_id: "h1" }, sender_name: "Alice", sender_type: "user" },
        body: { content: JSON.stringify({ text: "already bridged" }) },
      },
      {
        message_id: "om_new",
        root_id: "om_root",
        msg_type: "text",
        create_time: "5",
        sender: { sender_id: { open_id: "h2" }, sender_name: "Bob", sender_type: "user" },
        body: { content: JSON.stringify({ text: "fresh message" }) },
      },
    ];
    const postedComments: string[] = [];
    const handler: MockHandler = (req) => {
      if (req.method === "POST" && req.url.endsWith("/comment")) {
        postedComments.push(flattenAdfText((req.body as { body?: unknown }).body));
        return { status: 201, body: { id: "c1" } };
      }
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder({ om_root: items });
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "om_root",
    });
    bindings.advanceFeishuCursor("1", "3");
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.bridgeMessages(getOrFail(bindings, "1"), config);
    expect(postedComments).toHaveLength(1);
    expect(postedComments[0]).toContain("fresh message");
  });

  it("forwardComments auto-cleans binding on jira 404", async () => {
    const handler: MockHandler = () => ({
      status: 404,
      body: { errorMessages: ["Issue Does Not Exist"] },
    });
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.forwardComments(getOrFail(bindings, "1"), config);
    expect(bindings.getBinding("1")?.status).toBe("terminal");
    expect(rec.replies).toHaveLength(0);
  });

  it("bridgeMessages skips the bot ack on the next tick (no re-bridge, no duplicate ack)", async () => {
    const items = [
      {
        message_id: "om_a",
        root_id: "om_root",
        msg_type: "text",
        create_time: "1",
        sender: { sender_id: { open_id: "h1" }, sender_name: "Alice", sender_type: "user" },
        body: { content: JSON.stringify({ text: "please fix" }) },
      },
    ];
    const postedComments: string[] = [];
    const handler: MockHandler = (req) => {
      if (req.method === "POST" && req.url.endsWith("/comment")) {
        postedComments.push(req.url);
        return { status: 201, body: { id: "c1" } };
      }
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder({ om_root: items });
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.bridgeMessages(getOrFail(bindings, "1"), config);
    expect(postedComments).toHaveLength(1);
    items.push({
      message_id: "om_ack",
      root_id: "om_root",
      msg_type: "text",
      create_time: "2",
      sender: { sender_id: { open_id: "bot" }, sender_type: "app" },
      body: { content: JSON.stringify({ text: "✅ 已收到，已同步到 ENG-1" }) },
    });
    await bridge.bridgeMessages(getOrFail(bindings, "1"), config);
    expect(postedComments).toHaveLength(1);
    const acks = rec.replies.filter((r) => r.text.includes("已收到"));
    expect(acks).toHaveLength(1);
    expect(acks[0]?.rootId).toBe("om_a");
  });

  it("bridgeMessages does not send the thread ack for command messages", async () => {
    const items = [
      {
        message_id: "om_cmd",
        root_id: "om_root",
        msg_type: "text",
        create_time: "3",
        sender: { sender_id: { open_id: "h2" }, sender_name: "Bob", sender_type: "user" },
        body: { content: JSON.stringify({ text: "/help" }) },
      },
    ];
    server = await createMockJiraServer(() => ({ status: 200, body: {} }));
    const config = baseConfig();
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder({ om_root: items });
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.bridgeMessages(getOrFail(bindings, "1"), config);
    expect(rec.replies).toHaveLength(0);
    expect(rec.cards).toHaveLength(1);
    expect(JSON.stringify(rec.cards[0]?.card)).toContain("tasking 命令");
    expect(JSON.stringify(rec.cards[0]?.card)).not.toContain("已收到");
  });

  it("thread /help falls back to plain text when the card send fails", async () => {
    const items = [
      {
        message_id: "om_cmd2",
        root_id: "om_root",
        msg_type: "text",
        create_time: "4",
        sender: { sender_id: { open_id: "h2" }, sender_name: "Bob", sender_type: "user" },
        body: { content: JSON.stringify({ text: "/help" }) },
      },
    ];
    server = await createMockJiraServer(() => ({ status: 200, body: {} }));
    const config = baseConfig();
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder({ om_root: items });
    const inner = rec.fetchImpl;
    rec.fetchImpl = (async (url: RequestInfo | URL, init: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const body = init.body ? JSON.parse(init.body as string) : {};
      if (u.endsWith("/reply") && body.msg_type === "interactive") {
        return new Response("boom", { status: 400 });
      }
      return inner(url, init);
    }) as typeof fetch;
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.bridgeMessages(getOrFail(bindings, "1"), config);
    expect(rec.cards).toHaveLength(0);
    expect(rec.replies.some((r) => r.text.includes("tasking 命令"))).toBe(true);
  });

  it("thread /help omits intake-only /issue and /chat usage lines", async () => {
    const items = [
      {
        message_id: "om_cmd3",
        root_id: "om_root",
        msg_type: "text",
        create_time: "5",
        sender: { sender_id: { open_id: "h2" }, sender_name: "Bob", sender_type: "user" },
        body: { content: JSON.stringify({ text: "/help" }) },
      },
    ];
    server = await createMockJiraServer(() => ({ status: 200, body: {} }));
    const config = baseConfig();
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder({ om_root: items });
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.bridgeMessages(getOrFail(bindings, "1"), config);
    const card = JSON.stringify(rec.cards[0]?.card);
    expect(card).toContain("/state");
    expect(card).toContain("/agent");
    expect(card).toContain("intake 群内使用");
    expect(card).not.toContain("创建 issue");
    expect(card).not.toContain("opencode 会话");
  });

  it("thread /chat replies a group-command redirect", async () => {
    const items = [
      {
        message_id: "om_cmd4",
        root_id: "om_root",
        msg_type: "text",
        create_time: "6",
        sender: { sender_id: { open_id: "h2" }, sender_name: "Bob", sender_type: "user" },
        body: { content: JSON.stringify({ text: "/chat tasking 跑个测试" }) },
      },
    ];
    server = await createMockJiraServer(() => ({ status: 200, body: {} }));
    const config = baseConfig();
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder({ om_root: items });
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.bridgeMessages(getOrFail(bindings, "1"), config);
    expect(rec.replies.some((r) => r.text.includes("/chat 是群聊命令"))).toBe(true);
    expect(rec.replies.some((r) => r.text.includes("已收到"))).toBe(false);
  });

  it("thread unknown command replies the thread-scoped list", async () => {
    const items = [
      {
        message_id: "om_cmd5",
        root_id: "om_root",
        msg_type: "text",
        create_time: "7",
        sender: { sender_id: { open_id: "h2" }, sender_name: "Bob", sender_type: "user" },
        body: { content: JSON.stringify({ text: "/frobnicate" }) },
      },
    ];
    server = await createMockJiraServer(() => ({ status: 200, body: {} }));
    const config = baseConfig();
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder({ om_root: items });
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.bridgeMessages(getOrFail(bindings, "1"), config);
    expect(rec.replies.some((r) => r.text.includes("话题内可用：/state、/agent、/help"))).toBe(
      true,
    );
  });

  it("bridgeMessages advances cursor even when the ack reply fails", async () => {
    const items = [
      {
        message_id: "om_a",
        root_id: "om_root",
        msg_type: "text",
        create_time: "1",
        sender: { sender_id: { open_id: "h1" }, sender_name: "Alice", sender_type: "user" },
        body: { content: JSON.stringify({ text: "please fix" }) },
      },
    ];
    const postedComments: string[] = [];
    const handler: MockHandler = (req) => {
      if (req.method === "POST" && req.url.endsWith("/comment")) {
        postedComments.push(req.url);
        return { status: 201, body: { id: "c1" } };
      }
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const failAckFetch: typeof fetch = (async (url: RequestInfo | URL, init: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const body = init.body ? JSON.parse(init.body as string) : {};
      if (body.app_id !== undefined) {
        return new Response(JSON.stringify({ tenant_access_token: "t", expire: 7200 }), {
          status: 200,
        });
      }
      if (u.endsWith("/reply")) {
        return new Response("err", { status: 500 });
      }
      if (u.includes("/im/v1/messages") && init.method === "GET") {
        return new Response(JSON.stringify({ code: 0, data: { items } }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    }) as typeof fetch;
    const feishu = new FeishuSource(config.feishu, logger, failAckFetch);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.bridgeMessages(getOrFail(bindings, "1"), config);
    expect(postedComments).toHaveLength(1);
    expect(bindings.getBinding("1")?.last_feishu_msg_id).toBe("1");
    expect(bindings.getBinding("1")?.status).toBe("active");
  });

  it("bridgeMessages auto-cleans binding when postComment hits 404", async () => {
    const items = [
      {
        message_id: "om_a",
        root_id: "om_root",
        msg_type: "text",
        create_time: "1",
        sender: { sender_id: { open_id: "h1" }, sender_name: "Alice", sender_type: "user" },
        body: { content: JSON.stringify({ text: "please fix" }) },
      },
    ];
    const handler: MockHandler = (req) => {
      if (req.method === "POST" && req.url.endsWith("/comment")) {
        return { status: 404, body: { errorMessages: ["Issue Does Not Exist"] } };
      }
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder({ om_root: items });
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.bridgeMessages(getOrFail(bindings, "1"), config);
    expect(bindings.getBinding("1")?.status).toBe("terminal");
  });

  it("bridgeMessages 404 on postComment cleans binding without a failure ack", async () => {
    const items = [
      {
        message_id: "om_404",
        root_id: "om_root",
        msg_type: "text",
        create_time: "5",
        sender: { sender_id: { open_id: "h1" }, sender_name: "Alice", sender_type: "user" },
        body: { content: JSON.stringify({ text: "please fix" }) },
      },
    ];
    const handler: MockHandler = (req) => {
      if (req.method === "POST" && req.url.endsWith("/comment")) {
        return { status: 404, body: { errorMessages: ["Issue Does Not Exist"] } };
      }
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder({ om_root: items });
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.bridgeMessages(getOrFail(bindings, "1"), config);
    expect(bindings.getBinding("1")?.status).toBe("terminal");
    expect(rec.replies).toHaveLength(0);
  });

  it("bridgeMessages does not re-post nor re-log already-processed messages across ticks", async () => {
    const items = [
      {
        message_id: "om_a",
        root_id: "om_root",
        msg_type: "text",
        create_time: "1",
        sender: { sender_id: { open_id: "h1" }, sender_name: "Alice", sender_type: "user" },
        body: { content: JSON.stringify({ text: "please fix" }) },
      },
    ];
    const postedComments: string[] = [];
    const handler: MockHandler = (req) => {
      if (req.method === "POST" && req.url.endsWith("/comment")) {
        postedComments.push(req.url);
        return { status: 201, body: { id: "c1" } };
      }
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder({ om_root: items });
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    const lines: string[] = [];
    const collectingLogger = new ConsoleLogger({}, (line) => lines.push(line));
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "om_root",
    });
    bridge = new CommentBridge({
      tracker,
      feishu,
      bindings,
      config: () => config,
      logger: collectingLogger,
    });
    await bridge.bridgeMessages(getOrFail(bindings, "1"), config);
    expect(postedComments).toHaveLength(1);
    await bridge.bridgeMessages(getOrFail(bindings, "1"), config);
    expect(postedComments).toHaveLength(1);
    const bridgedLogs = lines.filter((l) => l.includes("feishu → jira"));
    expect(bridgedLogs).toHaveLength(1);
  });

  it("executeIssue creates issue + binds + acks; locks project/assignee/labels", async () => {
    const captured: Array<Record<string, unknown>> = [];
    const handler: MockHandler = (req) => {
      if (req.method === "POST" && req.url === "/rest/api/3/issue") {
        const b = req.body as { fields?: Record<string, unknown> };
        captured.push(b.fields ?? {});
        return { status: 201, body: { key: "ENG-42", id: "10042" } };
      }
      if (req.method === "GET" && req.url === "/rest/api/3/myself") {
        return { status: 200, body: { accountId: "acc-123", name: "you@example.com" } };
      }
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({
      tracker: {
        endpoint: `${server.baseUrl}/rest/api/3`,
        assignee: "me",
        required_labels: ["tothemax"],
      },
    });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.executeIssue(issueOrFail("/issue 暗色模式\n需要暗色切换"), "om_issue_msg", config);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.summary).toBe("暗色模式");
    expect(captured[0]?.description).toEqual(wrapDescription("需要暗色切换", true));
    expect(captured[0]?.issuetype).toEqual({ name: "Task" });
    expect(captured[0]?.labels).toEqual(["tothemax"]);
    expect(captured[0]?.assignee).toEqual({ accountId: "acc-123" });
    expect(bindings.getBinding("10042")?.issue_key).toBe("ENG-42");
    expect(bindings.getBinding("10042")?.root_id).toBe("om_topic_om_issue_msg");
    expect(rec.replies[0]?.text).toContain("✅ 已创建 ENG-42");
  });

  it("cold-start probe anchors the cursor to a 120s window, never to history", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const items = [
      {
        message_id: "om_old1",
        root_id: null,
        msg_type: "text",
        create_time: "100",
        sender: { sender_id: { open_id: "u1" }, sender_name: "Alice", sender_type: "user" },
        body: { content: JSON.stringify({ text: "ancient message" }) },
      },
    ];
    server = await createMockJiraServer(() => ({ status: 200, body: {} }));
    const config = baseConfig();
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder({ oc_intake: items });
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.discoverIntake(config);
    const cursor = bindings.getMeta("intake_cursor") ?? "";
    expect(Number(cursor)).toBeGreaterThanOrEqual(nowSec - 125);
    expect(Number(cursor)).toBeLessThanOrEqual(nowSec - 115);
    expect(rec.replies).toHaveLength(0);
    expect(bindings.listActive()).toHaveLength(0);
  });

  it("cold-start probe adopts a message inside the window and the next sweep consumes later ones", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const inWindow = String(nowSec - 30);
    const later = String(nowSec + 50);
    const items = [
      {
        message_id: "om_in_window",
        root_id: null,
        msg_type: "text",
        create_time: inWindow,
        sender: { sender_id: { open_id: "u1" }, sender_name: "Alice", sender_type: "user" },
        body: { content: JSON.stringify({ text: "just now" }) },
      },
    ];
    server = await createMockJiraServer(() => ({ status: 200, body: {} }));
    const config = baseConfig();
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder({ oc_intake: items });
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.discoverIntake(config);
    expect(bindings.getMeta("intake_cursor")).toBe(inWindow);
    expect(rec.replies).toHaveLength(0);
    rec.listItems.oc_intake = [
      ...items,
      {
        message_id: "om_after",
        root_id: null,
        msg_type: "text",
        create_time: later,
        sender: { sender_id: { open_id: "u2" }, sender_name: "Bob", sender_type: "user" },
        body: { content: JSON.stringify({ text: "fresh hello" }) },
      },
    ];
    await bridge.discoverIntake(config);
    expect(rec.replies).toHaveLength(1);
    expect(rec.replies[0]?.rootId).toBe("om_after");
    expect(rec.replies[0]?.text).toContain("已收到");
    expect(bindings.getMeta("intake_cursor")).toBe(later);
  });

  it("discoverIntake acks non-command root messages without binding or jira comment", async () => {
    const items = [
      {
        message_id: "om_intake_1",
        root_id: null,
        msg_type: "text",
        create_time: "10",
        sender: { sender_id: { open_id: "u1" }, sender_name: "Alice", sender_type: "user" },
        body: { content: JSON.stringify({ text: "hello tasking" }) },
      },
    ];
    const handler: MockHandler = (req) => {
      expect(req.method).toBe("GET");
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig();
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder({ oc_intake: items });
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.setMeta("intake_cursor", "1");
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.discoverIntake(config);
    expect(rec.replies).toHaveLength(1);
    expect(rec.replies[0]?.rootId).toBe("om_intake_1");
    expect(rec.replies[0]?.text).toContain("已收到");
    expect(bindings.listActive()).toHaveLength(0);
  });

  it("discoverIntake creates issue from post-type /issue message", async () => {
    const items = [
      {
        message_id: "om_intake_post",
        root_id: null,
        msg_type: "post",
        create_time: "10",
        sender: {
          sender_id: { open_id: "u1" },
          sender_name: "Alice",
          sender_type: "user",
        },
        body: {
          content: JSON.stringify({
            title: "",
            content: [
              [{ tag: "text", text: "/issue 暗色模式" }],
              [{ tag: "text", text: "多行描述" }],
            ],
          }),
        },
      },
    ];
    const captured: Array<Record<string, unknown>> = [];
    const handler: MockHandler = (req) => {
      if (req.method === "POST" && req.url.endsWith("/issue")) {
        captured.push((req.body as { fields?: Record<string, unknown> }).fields ?? {});
        return { status: 201, body: { key: "ENG-43", id: "10043" } };
      }
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder({ oc_intake: items });
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.setMeta("intake_cursor", "1");
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.discoverIntake(config);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.summary).toBe("暗色模式");
    expect(rec.replies.some((r) => r.text.includes("✅ 已创建 ENG-43"))).toBe(true);
  });

  it("discoverIntake keeps unknown-command reply for / commands, not the ack", async () => {
    const items = [
      {
        message_id: "om_intake_2",
        root_id: null,
        msg_type: "text",
        create_time: "11",
        sender: { sender_id: { open_id: "u1" }, sender_name: "Alice", sender_type: "user" },
        body: { content: JSON.stringify({ text: "/frobnicate" }) },
      },
    ];
    server = await createMockJiraServer(() => ({ status: 200, body: {} }));
    const config = baseConfig();
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder({ oc_intake: items });
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.setMeta("intake_cursor", "1");
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.discoverIntake(config);
    expect(rec.replies).toHaveLength(1);
    expect(rec.replies[0]?.text).toContain("未知命令");
    expect(rec.replies[0]?.text).not.toContain("已收到");
  });

  it("discoverIntake skips a recalled (reply 400) message, advances cursor, keeps going", async () => {
    const items = [
      {
        message_id: "om_recall",
        root_id: null,
        msg_type: "text",
        create_time: "100",
        sender: { sender_id: { open_id: "u1" }, sender_name: "Alice", sender_type: "user" },
        body: { content: JSON.stringify({ text: "recalled hello" }) },
      },
      {
        message_id: "om_real",
        root_id: null,
        msg_type: "text",
        create_time: "101",
        sender: { sender_id: { open_id: "u2" }, sender_name: "Bob", sender_type: "user" },
        body: { content: JSON.stringify({ text: "real hello" }) },
      },
    ];
    const recalledIds = new Set(["om_recall"]);
    const replied: string[] = [];
    const fetchImpl: typeof fetch = (async (url: RequestInfo | URL, init: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const body = init.body ? JSON.parse(init.body as string) : {};
      if (body.app_id !== undefined) {
        return new Response(JSON.stringify({ tenant_access_token: "t", expire: 7200 }), {
          status: 200,
        });
      }
      if (u.includes("/reply")) {
        const rootId = u.split("/im/v1/messages/")[1]?.split("/")[0] ?? "";
        if (recalledIds.has(rootId)) {
          return new Response("recalled", { status: 400 });
        }
        replied.push(rootId);
        return new Response(
          JSON.stringify({ code: 0, data: { message_id: `om_ack_${rootId}`, root_id: rootId } }),
          { status: 200 },
        );
      }
      if (u.includes("/im/v1/messages") && init.method === "GET") {
        return new Response(JSON.stringify({ code: 0, data: { items } }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    }) as typeof fetch;
    server = await createMockJiraServer(() => ({ status: 200, body: {} }));
    const config = baseConfig();
    const tracker = new JiraTracker(config.tracker);
    const feishu = new FeishuSource(config.feishu, logger, fetchImpl);
    const lines: string[] = [];
    const collectingLogger = new ConsoleLogger({}, (line) => lines.push(line));
    bindings.setMeta("intake_cursor", "1");
    bridge = new CommentBridge({
      tracker,
      feishu,
      bindings,
      config: () => config,
      logger: collectingLogger,
    });
    await expect(bridge.discoverIntake(config)).resolves.toBeUndefined();
    expect(bindings.getMeta("intake_cursor")).toBe("101");
    expect(replied).toEqual(["om_real"]);
    expect(lines.some((l) => l.includes("likely recalled"))).toBe(true);
    const repliedBefore = replied.length;
    await bridge.discoverIntake(config);
    expect(replied.length).toBe(repliedBefore);
  });

  it("executeIssue --agent tags the issue with agent:<name>", async () => {
    const captured: Array<Record<string, unknown>> = [];
    const handler: MockHandler = (req) => {
      if (req.method === "POST" && req.url.endsWith("/issue")) {
        captured.push((req.body as { fields?: Record<string, unknown> }).fields ?? {});
        return { status: 201, body: { key: "ENG-44", id: "10044" } };
      }
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({
      tracker: { endpoint: `${server.baseUrl}/rest/api/3`, required_labels: ["tothemax"] },
    });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.executeIssue(
      issueOrFail("/issue --agent review 暗色模式\n需要暗色切换"),
      "om_msg",
      config,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]?.labels).toEqual(["tothemax", "agent:review"]);
  });

  it("executeIssue --agent with unknown agent still creates and warns", async () => {
    const captured: Array<Record<string, unknown>> = [];
    const handler: MockHandler = (req) => {
      if (req.method === "POST" && req.url.endsWith("/issue")) {
        captured.push((req.body as { fields?: Record<string, unknown> }).fields ?? {});
        return { status: 201, body: { key: "ENG-45", id: "10045" } };
      }
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    config.opencode.agents = ["build"];
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.executeIssue(issueOrFail("/issue --agent foo 标题\n描述"), "om_msg2", config);
    expect(captured).toHaveLength(1);
    expect((captured[0]?.labels as string[]).some((l) => l === "agent:foo")).toBe(true);
    expect(rec.replies.some((r) => r.text.includes("不在"))).toBe(true);
  });

  it("executeIssue creates issue without posting redundant first comment", async () => {
    let capturedDescription: unknown = null;
    const commentPosts: unknown[] = [];
    const handler: MockHandler = (req) => {
      if (req.method === "POST" && req.url.endsWith("/issue")) {
        capturedDescription = (req.body as { fields?: Record<string, unknown> }).fields
          ?.description;
        return { status: 201, body: { key: "ENG-42", id: "10042" } };
      }
      if (req.method === "POST" && req.url.endsWith("/comment")) {
        commentPosts.push(req.body);
        return { status: 201, body: { id: "c1" } };
      }
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.executeIssue(issueOrFail("/issue 暗色模式\n需要暗色切换"), "om_issue_msg", config);
    expect(capturedDescription).toEqual(wrapDescription("需要暗色切换", true));
    expect(commentPosts).toHaveLength(0);
  });

  it("executeState lists transitions then transitions by number + nudges + marks terminal", async () => {
    const handler: MockHandler = (req) => {
      if (req.url.endsWith("/transitions") && req.method === "GET") {
        return {
          status: 200,
          body: { transitions: [{ id: "11", name: "To Done", to: { name: "Done" } }] },
        };
      }
      if (req.url.endsWith("/transitions") && req.method === "POST") {
        return { status: 204, body: "" };
      }
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    let nudged = 0;
    bridge = new CommentBridge({
      tracker,
      feishu,
      bindings,
      config: () => config,
      logger,
      requestRefresh: () => {
        nudged++;
        return true;
      },
    });
    await bridge.executeState(stateOrFail("/state"), getOrFail(bindings, "1"), config);
    expect(rec.replies).toHaveLength(0);
    expect(JSON.stringify(rec.cards[0]?.card)).toContain("状态：");
    await bridge.executeState(stateOrFail("/state 1"), getOrFail(bindings, "1"), config);
    expect(nudged).toBe(1);
    expect(rec.replies[0]?.text).toContain("✅ 已转 Done");
    expect(bindings.getBinding("1")?.status).toBe("terminal");
  });

  it("onDispatch binds Jira-origin issue, skips when already bound", async () => {
    server = await createMockJiraServer(() => ({ status: 200, body: {} }));
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    const running = new Map<string, { task: { identifier: string; title: string } }>();
    running.set("10001", { task: { identifier: "ENG-1", title: "Fix bug" } });
    const ee = new EventEmitter();
    const scheduler: SchedulerPort = {
      on: ((e: string, l: (...a: unknown[]) => void) => ee.on(e, l)) as SchedulerPort["on"],
      state: { running },
    };
    bridge = new CommentBridge({
      tracker,
      feishu,
      bindings,
      config: () => config,
      logger,
      scheduler,
    });
    const onDispatch = (
      bridge as unknown as {
        onDispatch: (this: CommentBridge, id: string) => Promise<void>;
      }
    ).onDispatch;
    await onDispatch.call(bridge, "10001");
    expect(rec.posted[0]?.text).toContain("📋 ENG-1 · Fix bug 已开始");
    expect(rec.replies[0]?.text).toContain("💬 可在此话题回复");
    expect(bindings.getBinding("10001")?.issue_key).toBe("ENG-1");
    expect(bindings.getBinding("10001")?.thread_id).not.toBeNull();
    const before = rec.posted.length;
    await onDispatch.call(bridge, "10001");
    expect(rec.posted.length).toBe(before);
    bindings.markTerminal("10001");
    await onDispatch.call(bridge, "10001");
    expect(bindings.getBinding("10001")?.status).toBe("active");
  });

  it("onTerminate acks + marks terminal", async () => {
    server = await createMockJiraServer(() => ({ status: 200, body: {} }));
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "10001",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    const onTerminate = (
      bridge as unknown as {
        onTerminate: (this: CommentBridge, id: string, reason: string) => Promise<void>;
      }
    ).onTerminate;
    await onTerminate.call(bridge, "10001", "terminal");
    expect(rec.replies[0]?.text).toContain("✅ 已完结 ENG-1");
    expect(bindings.getBinding("10001")?.status).toBe("terminal");
    const repliesBefore = rec.replies.length;
    await onTerminate.call(bridge, "999", "missing from tracker");
    expect(rec.replies.length).toBe(repliesBefore);
  });

  it("executeAgent lists default + catalogue in intake", async () => {
    server = await createMockJiraServer(() => ({ status: 200, body: {} }));
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    config.opencode.agent = "build";
    config.opencode.agents = ["build", "review"];
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.executeAgent(agentOrFail("/agent"), null, "om_intake", config);
    const card = JSON.stringify(rec.cards[0]?.card);
    expect(card).toContain("build");
    expect(card).toContain("review");
  });

  it("executeAgent lists default + 未配置 when catalogue empty in intake", async () => {
    server = await createMockJiraServer(() => ({ status: 200, body: {} }));
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.executeAgent(agentOrFail("/agent"), null, "om_intake", config);
    const card = JSON.stringify(rec.cards[0]?.card);
    expect(card).toContain("build");
    expect(card).toContain("未配置");
  });

  it("executeAgent shows the task's current resolved agent in a bound thread", async () => {
    const handler: MockHandler = (req) => {
      if (req.method === "POST" && req.url.endsWith("/search")) {
        return {
          status: 200,
          body: searchResponse([makeIssue("1", "ENG-1", { labels: ["bug", "agent:review"] })]),
        };
      }
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    config.opencode.agents = ["Build", "Review"];
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.executeAgent(agentOrFail("/agent"), getOrFail(bindings, "1"), "om_root", config);
    expect(JSON.stringify(rec.cards[0]?.card)).toContain("Review");
  });

  it("executeAgent switch swaps the agent label and acks next-turn in a bound thread", async () => {
    const puts: Array<{ key: string; labels: string[] }> = [];
    const handler: MockHandler = (req) => {
      if (req.method === "POST" && req.url.endsWith("/search")) {
        return {
          status: 200,
          body: searchResponse([makeIssue("1", "ENG-1", { labels: ["bug", "agent:build"] })]),
        };
      }
      if (req.method === "PUT" && req.url === "/rest/api/3/issue/ENG-1") {
        puts.push({
          key: "ENG-1",
          labels: (req.body as { fields?: { labels?: string[] } }).fields?.labels ?? [],
        });
        return { status: 204, body: "" };
      }
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    config.opencode.agents = ["Build", "Review"];
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.executeAgent(
      agentOrFail("/agent review"),
      getOrFail(bindings, "1"),
      "om_root",
      config,
    );
    expect(puts).toHaveLength(1);
    expect(puts[0]?.labels).toEqual(["bug", "agent:review"]);
    expect(rec.replies[0]?.text).toContain("agent:review");
    expect(rec.replies[0]?.text).toContain("下一 turn");
  });

  it("executeAgent reset clears the agent label in a bound thread", async () => {
    const puts: Array<{ labels: string[] }> = [];
    const handler: MockHandler = (req) => {
      if (req.method === "POST" && req.url.endsWith("/search")) {
        return {
          status: 200,
          body: searchResponse([makeIssue("1", "ENG-1", { labels: ["bug", "agent:review"] })]),
        };
      }
      if (req.method === "PUT" && req.url === "/rest/api/3/issue/ENG-1") {
        puts.push({
          labels: (req.body as { fields?: { labels?: string[] } }).fields?.labels ?? [],
        });
        return { status: 204, body: "" };
      }
      return { status: 200, body: {} };
    };
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "om_root",
    });
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.executeAgent(
      agentOrFail("/agent default"),
      getOrFail(bindings, "1"),
      "om_root",
      config,
    );
    expect(puts).toHaveLength(1);
    expect(puts[0]?.labels).toEqual(["bug"]);
  });

  it("executeAgent switch in intake is rejected with a use-in-thread hint", async () => {
    server = await createMockJiraServer(() => ({ status: 200, body: {} }));
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    await bridge.executeAgent(agentOrFail("/agent review"), null, "om_intake", config);
    expect(rec.replies[0]?.text).toContain("话题");
  });

  it("start/stop lifecycle toggles isRunning", () => {
    server = null;
    const config = baseConfig();
    const tracker = new JiraTracker(config.tracker);
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bridge = new CommentBridge({ tracker, feishu, bindings, config: () => config, logger });
    bridge.start();
    expect(bridge.isRunning).toBe(true);
    bridge.stop();
    expect(bridge.isRunning).toBe(false);
  });
});

function postedCommentsFor(bridge: CommentBridge): string[] {
  const tracker = (bridge as unknown as { deps: { tracker: { postedComments?: string[] } } }).deps
    .tracker;
  return tracker.postedComments ?? [];
}

function polledMsg(over: {
  message_id: string;
  root_id?: string | null;
  msg_type?: string;
  text?: string;
  sender_type?: string;
  chat_id?: string;
  create_time?: string;
}): FeishuPolledMessage {
  return {
    message_id: over.message_id,
    root_id: over.root_id ?? null,
    parent_id: over.root_id ?? null,
    msg_type: over.msg_type ?? "text",
    text: over.text ?? "hello",
    sender_open_id: "ou_u",
    sender_name: "User",
    sender_type: over.sender_type ?? "user",
    create_time: over.create_time ?? "100",
    chat_id: over.chat_id ?? "oc_intake",
  };
}

describe("event ingress queue", () => {
  let root: string;
  let bindings: BindingStore;
  let bridge: CommentBridge;
  let rec: FeishuRecorder;
  let config: EffectiveConfig;
  let postedComments: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "tasking-cb-q-"));
    bindings = new BindingStore(join(root, "b.db"));
    rec = feishuRecorder();
    config = baseConfig();
    postedComments = [];
  });

  afterEach(async () => {
    bridge?.stop();
    bindings.close();
    rmSync(root, { recursive: true, force: true });
  });

  function makeBridge(retryDelaysMs?: number[], tracker?: JiraTracker): CommentBridge {
    const jira: JiraTracker =
      tracker ??
      ({
        postComment: async (_key: string, body: string) => {
          postedComments.push(body);
        },
      } as unknown as JiraTracker);
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    return new CommentBridge({
      tracker: jira,
      feishu,
      bindings,
      config: () => config,
      logger,
      retryDelaysMs,
    });
  }

  it("ingestMessage bridges a thread reply to Jira (event path)", async () => {
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "omt_root",
    });
    bridge = makeBridge();
    await bridge.ingestMessage(
      polledMsg({ message_id: "om_e1", root_id: "om_root", text: "fix it" }),
    );
    expect(postedComments).toHaveLength(1);
    expect(postedComments[0]).toContain("fix it");
    expect(rec.replies.some((r) => r.rootId === "om_e1")).toBe(true);
    expect(bindings.getBinding("1")?.last_feishu_msg_id).toBe("100");
  });

  it("claim dedup: the same msg_id enqueued twice is processed once", async () => {
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "omt_root",
    });
    bridge = makeBridge();
    const msg = polledMsg({ message_id: "om_dup", root_id: "om_root", text: "once only" });
    await Promise.all([bridge.ingestMessage(msg), bridge.ingestMessage(msg)]);
    await bridge.whenIdle();
    expect(postedComments).toHaveLength(1);
  });

  it("durable seen-id: restart replay of a processed intake root is suppressed", async () => {
    bridge = makeBridge();
    await bridge.ingestMessage(polledMsg({ message_id: "om_help1", root_id: null, text: "/help" }));
    expect(rec.cards.filter((c) => c.rootId === "om_help1")).toHaveLength(1);
    bridge.stop();
    bridge = makeBridge();
    await bridge.ingestMessage(polledMsg({ message_id: "om_help1", root_id: null, text: "/help" }));
    expect(rec.cards.filter((c) => c.rootId === "om_help1")).toHaveLength(1);
    expect(bindings.isIntakeSeen("om_help1")).toBe(true);
  });

  it("durable seen-id is written only after processing completes", async () => {
    const base = rec.fetchImpl;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    rec.fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/im/v1/messages/") && u.endsWith("/reply")) await gate;
      return base(url, init ?? {});
    }) as typeof fetch;
    bridge = makeBridge();
    const pending = bridge.ingestMessage(
      polledMsg({ message_id: "om_slow", root_id: null, text: "/frobnicate" }),
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(bindings.isIntakeSeen("om_slow")).toBe(false);
    release();
    await pending;
    expect(bindings.isIntakeSeen("om_slow")).toBe(true);
    expect(rec.replies.some((r) => r.rootId === "om_slow")).toBe(true);
  });

  it("durable seen-id is still marked when the reply send keeps failing", async () => {
    const base = rec.fetchImpl;
    rec.fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/im/v1/messages/") && u.endsWith("/reply")) {
        return new Response(JSON.stringify({ code: 99991400, msg: "boom" }), { status: 500 });
      }
      return base(url, init ?? {});
    }) as typeof fetch;
    bridge = makeBridge();
    await bridge.ingestMessage(
      polledMsg({ message_id: "om_fail", root_id: null, text: "/frobnicate" }),
    );
    expect(bindings.isIntakeSeen("om_fail")).toBe(true);
  });

  it("thread replies do not create durable intake seen-id entries", async () => {
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "omt_root",
    });
    bridge = makeBridge();
    await bridge.ingestMessage(polledMsg({ message_id: "om_t9", root_id: "om_root", text: "hi" }));
    expect(postedComments).toHaveLength(1);
    expect(bindings.isIntakeSeen("om_t9")).toBe(false);
  });

  it("routing: messages outside the intake chat are dropped", async () => {
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "omt_root",
    });
    bridge = makeBridge();
    await bridge.ingestMessage(
      polledMsg({ message_id: "om_x1", root_id: "om_root", chat_id: "oc_other" }),
    );
    expect(postedComments).toHaveLength(0);
    expect(rec.replies).toHaveLength(0);
  });

  it("routing: replies in unbound threads are dropped", async () => {
    bridge = makeBridge();
    await bridge.ingestMessage(
      polledMsg({ message_id: "om_x2", root_id: "om_nowhere", text: "wild" }),
    );
    expect(postedComments).toHaveLength(0);
    expect(rec.replies).toHaveLength(0);
  });

  it("routing: root messages in intake reach the intake path (/issue)", async () => {
    bridge = makeBridge();
    const issueTracker = {
      createIssue: async () => ({ key: "ENG-9", id: "9" }),
      fetchIssueStatesByIds: async () => [],
      isApiV3: () => false,
    } as unknown as JiraTracker;
    bridge = makeBridge(undefined, issueTracker);
    await bridge.ingestMessage(
      polledMsg({ message_id: "om_issue1", root_id: null, text: "/issue 新任务\n描述" }),
    );
    expect(rec.replies.some((r) => r.rootId === "om_issue1" && r.text.includes("已创建"))).toBe(
      true,
    );
  });

  it("transient Jira failure recovers via retry without duplicate ack", async () => {
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "omt_root",
    });
    let attempts = 0;
    const flaky: JiraTracker = {
      postComment: async (_key: string, body: string) => {
        attempts++;
        if (attempts === 1) throw new Error("jira blip");
        postedComments.push(body);
      },
    } as unknown as JiraTracker;
    bridge = makeBridge([1, 1, 1], flaky);
    await bridge.ingestMessage(polledMsg({ message_id: "om_retry", root_id: "om_root" }));
    await new Promise((r) => setTimeout(r, 20));
    await bridge.whenIdle();
    expect(attempts).toBe(2);
    expect(postedComments).toHaveLength(1);
    expect(rec.replies.filter((r) => r.text.includes("已收到"))).toHaveLength(1);
  });

  it("startup sweep processes seeded intake messages (scheduleSweep(0) trigger)", async () => {
    bindings.setMeta("intake_cursor", "1");
    rec.listItems.oc_intake = [
      {
        message_id: "om_s1",
        root_id: null,
        parent_id: null,
        msg_type: "text",
        create_time: "5000",
        chat_id: "oc_intake",
        sender: {
          sender_id: { open_id: "ou_a" },
          sender_name: "Alice",
          sender_type: "user",
        },
        body: { content: JSON.stringify({ text: "/issue 启动补拉任务\ndesc" }) },
      },
    ];
    const issueTracker = {
      createIssue: async () => ({ key: "ENG-10", id: "10" }),
      fetchIssueStatesByIds: async () => [],
      isApiV3: () => false,
    } as unknown as JiraTracker;
    bridge = makeBridge(undefined, issueTracker);
    bridge.start();
    await bridge.whenIdle();
    await new Promise((r) => setTimeout(r, 10));
    await bridge.whenIdle();
    expect(rec.replies.some((r) => r.rootId === "om_s1" && r.text.includes("已创建"))).toBe(true);
    expect(bindings.getMeta("intake_cursor")).toBe("5000");
  });
});

describe("terminal topic hint", () => {
  let root: string;
  let bindings: BindingStore;
  let bridge: CommentBridge;
  let rec: FeishuRecorder;
  let config: EffectiveConfig;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "tasking-cb-t-"));
    bindings = new BindingStore(join(root, "b.db"));
    rec = feishuRecorder();
    config = baseConfig();
  });

  afterEach(async () => {
    bridge?.stop();
    bindings.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("replies once with a revive hint for replies in a terminal topic, then stays silent", async () => {
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_dead",
      thread_id: "omt_dead",
    });
    bindings.markTerminal("1");
    bridge = makeBridgeHere();
    await bridge.ingestMessage(
      polledMsg({ message_id: "om_d1", root_id: "om_dead", text: "还有人在吗" }),
    );
    expect(
      rec.replies.filter((r) => r.rootId === "om_d1" && r.text.includes("已完结")),
    ).toHaveLength(1);
    await bridge.ingestMessage(
      polledMsg({ message_id: "om_d2", root_id: "om_dead", text: "再说一句" }),
    );
    expect(rec.replies.filter((r) => r.rootId === "om_d2")).toHaveLength(0);
    expect(postedCommentsFor(bridge)).toHaveLength(0);
  });

  function makeBridgeHere(): CommentBridge {
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    return new CommentBridge({
      tracker: {
        postComment: async () => {},
      } as unknown as JiraTracker,
      feishu,
      bindings,
      config: () => config,
      logger,
    });
  }

  it("wild threads with no binding at all stay silent (unchanged)", async () => {
    bridge = makeBridgeHere();
    await bridge.ingestMessage(
      polledMsg({ message_id: "om_w1", root_id: "om_nowhere", text: "wild" }),
    );
    expect(rec.replies).toHaveLength(0);
  });
});

describe("CommentBridge freshStartReset", () => {
  let root: string;
  let bindings: BindingStore;
  let bridge: CommentBridge;
  let rec: FeishuRecorder;
  let config: EffectiveConfig;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "tasking-cb-fresh-"));
    bindings = new BindingStore(join(root, "b.db"));
    rec = feishuRecorder();
    config = baseConfig();
  });

  afterEach(async () => {
    bridge?.stop();
    bindings.close();
    rmSync(root, { recursive: true, force: true });
  });

  function makeBridge(
    states: Array<{ id: string; state: string }>,
    opts: { failStates?: boolean; logger?: ConsoleLogger } = {},
  ): CommentBridge {
    const bridgedLogger = opts.logger ?? logger;
    const feishu = new FeishuSource(config.feishu, bridgedLogger, rec.fetchImpl);
    const tracker = {
      fetchIssueStatesByIds: async (ids: string[]) => {
        if (opts.failStates) throw new Error("tracker unreachable");
        const byId = new Map(states.map((s) => [s.id, s.state]));
        return ids
          .filter((id) => byId.has(id))
          .map((id) => ({ id, state: byId.get(id), source: "jira" }));
      },
    } as unknown as JiraTracker;
    return new CommentBridge({
      tracker,
      feishu,
      bindings,
      config: () => config,
      logger: bridgedLogger,
    });
  }

  it("clears intake_cursor so the next sweep cold-starts instead of replaying", async () => {
    bindings.setMeta("intake_cursor", "1700000001");
    bridge = makeBridge([]);
    await expect(bridge.freshStartReset()).resolves.toBe(true);
    expect(bindings.getMeta("intake_cursor")).toBeNull();
  });

  it("marks a binding terminal when its issue reached a terminal state", async () => {
    bindings.upsertBinding({
      issue_id: "10001",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_1",
    });
    bridge = makeBridge([{ id: "10001", state: "Done" }]);
    await bridge.freshStartReset();
    expect(bindings.getBinding("10001")?.status).toBe("terminal");
    expect(bindings.listActive()).toHaveLength(0);
  });

  it("marks a binding terminal when its issue is absent from the tracker (deleted/404)", async () => {
    bindings.upsertBinding({
      issue_id: "10001",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_1",
    });
    bridge = makeBridge([]);
    await bridge.freshStartReset();
    expect(bindings.getBinding("10001")?.status).toBe("terminal");
  });

  it("keeps active and review bindings, marks only terminal ones", async () => {
    bindings.upsertBinding({
      issue_id: "10001",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_1",
    });
    bindings.upsertBinding({
      issue_id: "10002",
      issue_key: "ENG-2",
      chat_id: "oc_intake",
      root_id: "om_2",
    });
    bindings.upsertBinding({
      issue_id: "10003",
      issue_key: "ENG-3",
      chat_id: "oc_intake",
      root_id: "om_3",
    });
    bridge = makeBridge([
      { id: "10001", state: "Done" },
      { id: "10002", state: "To Do" },
      { id: "10003", state: "In Review" },
    ]);
    await bridge.freshStartReset();
    expect(bindings.getBinding("10001")?.status).toBe("terminal");
    expect(bindings.getBinding("10002")?.status).toBe("active");
    expect(bindings.getBinding("10003")?.status).toBe("active");
    expect(bindings.listActive().map((b) => b.issue_key)).toEqual(["ENG-2", "ENG-3"]);
  });

  it("keeps all bindings and warns when the tracker reconcile query fails", async () => {
    bindings.upsertBinding({
      issue_id: "10001",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_1",
    });
    const warnLogger = new ConsoleLogger({}, () => {});
    const warnSpy = vi.spyOn(warnLogger, "warn").mockImplementation(() => {});
    bridge = makeBridge([{ id: "10001", state: "Done" }], {
      failStates: true,
      logger: warnLogger,
    });
    await expect(bridge.freshStartReset()).resolves.toBe(false);
    expect(bindings.getBinding("10001")?.status).toBe("active");
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("direct session routing", () => {
  let root: string;
  let bindings: BindingStore;
  let bridge: CommentBridge;
  let server: MockServer | null = null;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "tasking-cb-direct-"));
    bindings = new BindingStore(join(root, "b.db"));
  });

  afterEach(async () => {
    bridge?.stop();
    bindings.close();
    rmSync(root, { recursive: true, force: true });
    if (server) {
      await server.close();
      server = null;
    }
  });

  function directPortSpy(handled = true) {
    return {
      intakeCalls: [] as string[],
      threadCalls: [] as string[],
      async handleIntakeMessage(m: { text: string }) {
        this.intakeCalls.push(m.text);
        return handled;
      },
      async handleThreadMessage(m: { text: string }) {
        this.threadCalls.push(m.text);
        return handled;
      },
    };
  }

  it("delegates /chat root messages to the direct port instead of unknown-command ack", async () => {
    const config = baseConfig();
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    const port = directPortSpy(true);
    bridge = new CommentBridge({
      tracker: new JiraTracker(config.tracker),
      feishu,
      bindings,
      config: () => config,
      logger,
      direct: port,
    });
    await bridge.ingestMessage(
      polledMsg({ message_id: "om_chat", text: "/chat tasking 帮我跑测试" }),
    );
    await bridge.whenIdle();
    expect(port.intakeCalls).toHaveLength(1);
    expect(rec.replies).toHaveLength(0);
  });

  it("replies unknown-command for /chat when direct is not wired", async () => {
    const config = baseConfig();
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    bridge = new CommentBridge({
      tracker: new JiraTracker(config.tracker),
      feishu,
      bindings,
      config: () => config,
      logger,
    });
    await bridge.ingestMessage(polledMsg({ message_id: "om_chat2", text: "/chat tasking 你好" }));
    await bridge.whenIdle();
    expect(rec.replies.some((r) => r.text.includes("未知命令"))).toBe(true);
  });

  it("routes direct-thread messages to the port and skips Jira mirroring", async () => {
    const config = baseConfig();
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    const port = directPortSpy(true);
    bridge = new CommentBridge({
      tracker: new JiraTracker(config.tracker),
      feishu,
      bindings,
      config: () => config,
      logger,
      direct: port,
    });
    bindings.upsertBinding({
      issue_id: "d1",
      issue_key: "ENG-9",
      chat_id: "oc_intake",
      root_id: "om_direct_root",
    });
    await bridge.ingestMessage(
      polledMsg({ message_id: "om_dt1", root_id: "om_direct_root", text: "追问内容" }),
    );
    await bridge.whenIdle();
    expect(port.threadCalls).toHaveLength(1);
    expect(rec.replies).toHaveLength(0);
  });

  it("falls through to Jira logic when the port does not handle the thread", async () => {
    const handler: MockHandler = () => ({ status: 200, body: {} });
    server = await createMockJiraServer(handler);
    const config = baseConfig({ tracker: { endpoint: `${server.baseUrl}/rest/api/3` } });
    const tracker = new JiraTracker(config.tracker);
    const postSpy = vi.spyOn(tracker, "postComment").mockResolvedValue({ id: "c1" });
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    const port = directPortSpy(false);
    bridge = new CommentBridge({
      tracker,
      feishu,
      bindings,
      config: () => config,
      logger,
      direct: port,
    });
    bindings.upsertBinding({
      issue_id: "d2",
      issue_key: "ENG-10",
      chat_id: "oc_intake",
      root_id: "om_jira_root",
    });
    await bridge.ingestMessage(
      polledMsg({ message_id: "om_jt1", root_id: "om_jira_root", text: "转给 Jira" }),
    );
    await bridge.whenIdle();
    expect(postSpy).toHaveBeenCalled();
    expect(port.threadCalls).toHaveLength(1);
  });
});

describe("direct vs Jira root precedence", () => {
  it("a root with both a direct session and a Jira binding routes to direct, not Jira", async () => {
    const root = mkdtempSync(join(tmpdir(), "tasking-cb-prec-"));
    const bindings = new BindingStore(join(root, "b.db"));
    const handler: MockHandler = () => ({ status: 200, body: {} });
    const server = await createMockJiraServer(handler);
    const config = baseConfig({
      tracker: { endpoint: `${server.baseUrl}/rest/api/3` },
      feishu: { direct: { projects: { tasking: "/repos/tasking" } } } as never,
    });
    const tracker = new JiraTracker(config.tracker);
    const postSpy = vi.spyOn(tracker, "postComment").mockResolvedValue({ id: "c1" });
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    const spawnCalls: string[][] = [];
    const direct = new DirectSessionManager({
      feishu,
      store: bindings,
      config: () => config,
      logger,
      turnDriver: async (request) => {
        spawnCalls.push(["opencode", "run", "--dir", request.directory, request.prompt]);
        return {
          status: "succeeded",
          sessionId: "ses_prec",
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          error: null,
          postureOpened: request.autoApprove,
        };
      },
    });
    const bridge = new CommentBridge({
      tracker,
      feishu,
      bindings,
      config: () => config,
      logger,
      direct,
    });
    try {
      bindings.upsertDirectSession({
        root_id: "om_prec",
        chat_id: "oc_intake",
        project: "tasking",
        path: "/repos/tasking",
        session_id: "ses_prec",
        status: "idle",
      });
      bindings.upsertBinding({
        issue_id: "prec1",
        issue_key: "ENG-99",
        chat_id: "oc_intake",
        root_id: "om_prec",
      });
      await bridge.ingestMessage(
        polledMsg({ message_id: "om_prec_f1", root_id: "om_prec", text: "走哪条路" }),
      );
      await bridge.whenIdle();
      await direct.whenIdle();
      expect(spawnCalls).toHaveLength(1);
      expect(postSpy).not.toHaveBeenCalled();
    } finally {
      bridge.stop();
      bindings.close();
      rmSync(root, { recursive: true, force: true });
      await server.close();
    }
  });
});

describe("trackerless bridge (tracker.kind: none)", () => {
  function trackerlessConfig(): EffectiveConfig {
    return baseConfig({ tracker: { kind: "none" } as Partial<TrackerConfig> });
  }

  function intakeMsg(text: string): FeishuPolledMessage {
    return {
      message_id: `om_t${text.length}`,
      root_id: null,
      parent_id: null,
      thread_id: null,
      chat_id: "oc_intake",
      sender_type: "user",
      msg_type: "text",
      create_time: "1000",
      text,
    } as unknown as FeishuPolledMessage;
  }

  async function newBridge(config: EffectiveConfig): Promise<{
    bridge: CommentBridge;
    rec: FeishuRecorder;
    bindings: BindingStore;
  }> {
    const bindings = new BindingStore(join(mkdtempSync(join(tmpdir(), "tl-")), "bindings.db"));
    const rec = feishuRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    const bridge = new CommentBridge({
      tracker: null,
      feishu,
      bindings,
      config: () => config,
      logger,
    });
    return { bridge, rec, bindings };
  }

  it("constructs and runs a forward tick without any Jira call", async () => {
    const { bridge } = await newBridge(trackerlessConfig());
    bridge.start();
    await bridge.forwardComments(
      { issue_id: "1", issue_key: "ENG-1", chat_id: "oc_intake", root_id: "om_r" },
      trackerlessConfig(),
    );
    await new Promise((r) => setTimeout(r, 30));
    bridge.stop();
  });

  it("intake /issue falls back to unknown-command with trimmed list", async () => {
    const { bridge, rec } = await newBridge(trackerlessConfig());
    await bridge.ingestMessage(intakeMsg("/issue 修个 bug"));
    expect(rec.replies.some((r) => r.text.includes("未知命令。可用："))).toBe(true);
    expect(rec.replies.some((r) => r.text.includes("/chat"))).toBe(true);
    expect(rec.replies.some((r) => r.text.includes("/issue"))).toBe(false);
  });

  it("intake /state falls back to unknown-command when jira is absent", async () => {
    const { bridge, rec } = await newBridge(trackerlessConfig());
    await bridge.ingestMessage(intakeMsg("/state"));
    expect(rec.replies.some((r) => r.text.includes("未知命令。可用："))).toBe(true);
    expect(rec.replies.some((r) => r.text.includes("issue 话题"))).toBe(false);
  });

  it("intake unknown command lists available commands", async () => {
    const { bridge, rec } = await newBridge(trackerlessConfig());
    await bridge.ingestMessage(intakeMsg("/frobnicate"));
    expect(rec.replies.some((r) => r.text.includes("未知命令。可用：/chat、/agent、/help"))).toBe(
      true,
    );
  });

  it("/help is capability-trimmed (no /issue or /state lines)", async () => {
    const { bridge, rec } = await newBridge(trackerlessConfig());
    await bridge.ingestMessage(intakeMsg("/help"));
    const text = JSON.stringify(rec.cards);
    expect(text).not.toContain("/state");
    expect(text).not.toContain("/issue");
    expect(text).toContain("/chat");
    expect(text).toContain("/agent");
  });

  it("intake /agent still lists the catalog (no tracker dependency)", async () => {
    const { bridge, rec } = await newBridge(trackerlessConfig());
    await bridge.ingestMessage(intakeMsg("/agent"));
    const text = JSON.stringify(rec.cards);
    expect(text).toContain("默认 agent");
  });

  it("bridge card actions degrade to a toast instead of throwing", async () => {
    const { bridge } = await newBridge(trackerlessConfig());
    const gated = [
      "state_open",
      "state_refresh",
      "state_summon",
      "tr",
      "tr_confirm",
      "tr_cancel",
      "agent_set",
      "full",
    ];
    for (const [i, action] of gated.entries()) {
      const reply = await bridge.handleCardAction({
        messageId: `om_gate${i}`,
        chatId: "oc_intake",
        operatorOpenId: "ou_1",
        operatorName: null,
        value: { action, issue_id: "1", comment_id: "9", transition_id: "11" },
      } as unknown as FeishuCardAction);
      expect(reply?.toast?.content, action).toContain("Jira 任务源");
    }
  });

  it("sweep now still runs (intake discovery) without a tracker", async () => {
    const { bridge } = await newBridge(trackerlessConfig());
    await expect(bridge.sweepNow()).resolves.toBeUndefined();
  });
});
