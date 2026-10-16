import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FeishuSource } from "../src/adapters/feishu/source.js";
import { JiraTracker } from "../src/adapters/jira/tracker.js";
import { type Binding, BindingStore } from "../src/bridge/binding-store.js";
import { CommentBridge } from "../src/bridge/comment-bridge.js";
import { buildApprovalCard, buildTurnCard } from "../src/direct/card.js";
import { DirectSessionManager } from "../src/direct/manager.js";
import { ApprovalCoordinator } from "../src/driver/approval.js";
import { ConsoleLogger } from "../src/observability/logger.js";
import { buildInfoCard } from "../src/shared/info-card.js";
import { setLocale } from "../src/translate/locale.js";
import {
  cardActionEvent,
  createRoundTripRecorder,
  extractButtons,
  startRoundTrip,
} from "./helpers/card-roundtrip.js";
import {
  type MockHandler,
  type MockServer,
  createMockJiraServer,
} from "./helpers/mock-http-server.js";
import {
  makeIssue,
  makeRoundTripConfig,
  searchResponse,
  trackerFor,
} from "./helpers/roundtrip-setup.js";

const logger = new ConsoleLogger({}, () => {});

describe("round-trip helper", () => {
  it("extractButtons digs callback buttons out of a rendered card", () => {
    const card = buildInfoCard({
      title: "t",
      lines: ["a"],
      rootId: "om_root",
      kind: "bridge",
      buttons: [
        { label: "🔄 刷新", action: "state_refresh", value: { issue_id: "1" } },
        { label: "打开 Jira", url: "http://jira/browse/ENG-1" },
      ],
    });
    const buttons = extractButtons(card);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.label).toBe("🔄 刷新");
    expect(buttons[0]?.action).toBe("state_refresh");
    expect(buttons[0]?.value.kind).toBe("bridge");
    expect(buttons[0]?.value.root_id).toBe("om_root");
    expect(typeof buttons[0]?.value.seq).toBe("number");
  });

  it("extractButtons returns [] for a card without buttons", () => {
    expect(extractButtons(buildInfoCard({ title: "t", lines: ["a"] }))).toEqual([]);
  });

  it("a fixture-faithful event dispatched through the real router reaches the bridge", async () => {
    const root = mkdtempSync(join(tmpdir(), "rt-"));
    const store = new BindingStore(join(root, "b.db"));
    const server = await createMockJiraServer(() => ({
      status: 200,
      body: searchResponse([makeIssue("1", "ENG-1")]),
    }));
    const rec = createRoundTripRecorder();
    const feishu = new FeishuSource(makeRoundTripConfig().feishu, logger, rec.fetchImpl);
    store.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    const bridge = new CommentBridge({
      tracker: trackerFor(server),
      feishu,
      bindings: store,
      config: () => makeRoundTripConfig(server),
      logger,
    });
    const harness = startRoundTrip({
      config: makeRoundTripConfig(server),
      bridge,
      logger,
    });
    expect(harness).not.toBeNull();

    const card = await bridge.handleCardAction({
      messageId: "om_state",
      chatId: "oc_intake",
      operatorOpenId: "ou_op",
      operatorName: "Bob",
      value: { action: "state_refresh", kind: "bridge", issue_id: "1" },
    });
    const refresh = extractButtons(card?.card).find((b) => b.action === "state_refresh");
    expect(refresh).toBeDefined();

    const result = (await harness?.dispatch(cardActionEvent("om_state", refresh?.value ?? {}))) as {
      toast: { type: string; content: string };
      card?: unknown;
    };
    expect(result.toast.type).toBe("success");
    expect(JSON.stringify(result.card)).toContain("状态：");

    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("en locale round-trip: english toast + card labels, routing values unchanged", async () => {
    setLocale("en");
    try {
      const root = mkdtempSync(join(tmpdir(), "rt-en-"));
      const store = new BindingStore(join(root, "b.db"));
      const server = await createMockJiraServer(() => ({
        status: 200,
        body: searchResponse([makeIssue("1", "ENG-1")]),
      }));
      const rec = createRoundTripRecorder();
      const feishu = new FeishuSource(makeRoundTripConfig().feishu, logger, rec.fetchImpl);
      store.upsertBinding({
        issue_id: "1",
        issue_key: "ENG-1",
        chat_id: "oc_intake",
        root_id: "om_root",
      });
      const bridge = new CommentBridge({
        tracker: trackerFor(server),
        feishu,
        bindings: store,
        config: () => makeRoundTripConfig(server),
        logger,
      });
      const harness = startRoundTrip({
        config: makeRoundTripConfig(server),
        bridge,
        logger,
      });
      expect(harness).not.toBeNull();

      const card = await bridge.handleCardAction({
        messageId: "om_state",
        chatId: "oc_intake",
        operatorOpenId: "ou_op",
        operatorName: "Bob",
        value: { action: "state_refresh", kind: "bridge", issue_id: "1" },
      });
      const refresh = extractButtons(card?.card).find((b) => b.action === "state_refresh");
      expect(refresh).toBeDefined();
      expect(refresh?.value.kind).toBe("bridge");

      const result = (await harness?.dispatch(
        cardActionEvent("om_state", refresh?.value ?? {}),
      )) as {
        toast: { type: string; content: string };
        card?: unknown;
      };
      expect(result.toast.type).toBe("success");
      expect(result.toast.content).toBe("Refreshed");
      const resultJson = JSON.stringify(result.card);
      expect(resultJson).toContain("State:");
      expect(resultJson).not.toContain("状态：");

      store.close();
      rmSync(root, { recursive: true, force: true });
    } finally {
      setLocale("zh");
    }
  });
});

describe("bridge round-trip guard", () => {
  let root: string;
  let store: BindingStore;
  let server: MockServer;
  let rec: ReturnType<typeof createRoundTripRecorder>;
  let bridge: CommentBridge;
  let harness: ReturnType<typeof startRoundTrip>;
  let config: ReturnType<typeof makeRoundTripConfig>;
  let handler: MockHandler;
  let transitionPosts: number;
  let labelUpdates: Array<{ labels: string[] }>;

  const binding = () => {
    const b = store.getBinding("1");
    if (!b) throw new Error("binding missing");
    return b;
  };
  const dispatch = async (messageId: string, value: Record<string, unknown>) =>
    (await harness?.dispatch(cardActionEvent(messageId, value))) as {
      toast: { type: string; content: string };
      card?: unknown;
    };
  const unwrapped = (reply: { card?: unknown }) =>
    (reply.card as { data?: unknown } | undefined)?.data ?? reply.card ?? {};
  const settle = () => new Promise((r) => setTimeout(r, 60));
  const transitionsHandler = () => {
    handler = (req) => {
      if (req.url.endsWith("/transitions") && req.method === "POST") {
        transitionPosts++;
        return { status: 204, body: "" };
      }
      if (req.url.endsWith("/transitions") && req.method === "GET") {
        return {
          status: 200,
          body: { transitions: [{ id: "11", name: "To Done", to: { name: "Done" } }] },
        };
      }
      if (req.method === "PUT" && req.url.includes("/issue/")) {
        labelUpdates.push({
          labels: ((req.body as { fields?: { labels?: string[] } }).fields?.labels ?? []).map(
            String,
          ),
        });
        return { status: 204, body: "" };
      }
      return { status: 200, body: searchResponse([makeIssue("1", "ENG-1")]) };
    };
  };
  const renderStateCard = async () => {
    await bridge.executeState({ kind: "list", target: null }, binding(), config);
    return rec.cards.at(-1)?.card;
  };

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "rtb-"));
    store = new BindingStore(join(root, "b.db"));
    transitionPosts = 0;
    labelUpdates = [];
    handler = () => ({ status: 200, body: searchResponse([makeIssue("1", "ENG-1")]) });
    server = await createMockJiraServer((req) => handler(req));
    config = makeRoundTripConfig(server);
    rec = createRoundTripRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    store.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    bridge = new CommentBridge({
      tracker: trackerFor(server),
      feishu,
      bindings: store,
      config: () => config,
      logger,
    });
    harness = startRoundTrip({ config, bridge, logger });
    expect(harness).not.toBeNull();
  });

  afterEach(async () => {
    harness?.stop();
    bridge.stop();
    store.close();
    await server.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("state card: open → pick → confirm applies and names the operator", async () => {
    transitionsHandler();
    const openBtn = extractButtons(await renderStateCard()).find((b) => b.action === "state_open");
    expect(openBtn).toBeDefined();
    const pick = await dispatch("om_state", openBtn?.value ?? {});
    expect(pick.toast.type).toBe("info");
    const trBtn = extractButtons(unwrapped(pick)).find((b) => b.action === "tr");
    expect(trBtn).toBeDefined();
    const confirm = await dispatch("om_state", trBtn?.value ?? {});
    expect(confirm.toast.type).toBe("warning");
    const okBtn = extractButtons(unwrapped(confirm)).find((b) => b.action === "tr_confirm");
    expect(okBtn).toBeDefined();
    const applied = await dispatch("om_state", okBtn?.value ?? {});
    expect(applied.toast.content).toBe("正在转换…");
    await settle();
    expect(transitionPosts).toBe(1);
    expect(rec.replies.some((r) => r.text.includes("已转 Done") && r.text.includes("张三"))).toBe(
      true,
    );
    expect(rec.updates.length).toBeGreaterThanOrEqual(1);
  });

  it("state card: cancel writes nothing", async () => {
    transitionsHandler();
    const openBtn = extractButtons(await renderStateCard()).find((b) => b.action === "state_open");
    const pick = await dispatch("om_state", openBtn?.value ?? {});
    const cancelBtn = extractButtons(unwrapped(pick)).find((b) => b.action === "tr_cancel");
    expect(cancelBtn).toBeDefined();
    const cancelled = await dispatch("om_state", cancelBtn?.value ?? {});
    expect(cancelled.toast.content).toBe("已取消");
    await settle();
    expect(transitionPosts).toBe(0);
  });

  it("state card: refresh is repeatable within the dedup window", async () => {
    const refreshBtn = extractButtons(await renderStateCard()).find(
      (b) => b.action === "state_refresh",
    );
    expect(refreshBtn).toBeDefined();
    const first = await dispatch("om_state", refreshBtn?.value ?? {});
    const second = await dispatch("om_state", refreshBtn?.value ?? {});
    expect(first.toast.type).toBe("success");
    expect(second.toast.type).toBe("success");
    expect(second.toast.content).not.toBe("该操作已处理");
  });

  it("comment card: 📋 summon recalls the tracked state card; truncated 📄 delivers a file", async () => {
    const long = `头部\n${"x".repeat(30000)}`;
    handler = () => ({
      status: 200,
      body: {
        comments: [{ id: "501", author: { displayName: "Zhang" }, body: long, created: "t1" }],
      },
    });
    await renderStateCard();
    const trackedBefore = store.getBinding("1")?.card_message_id;
    expect(trackedBefore).toBeTruthy();

    await bridge.forwardComments(binding(), config);
    const commentCard = rec.cards.at(-1)?.card;
    const commentJson = JSON.stringify(commentCard);
    expect(commentJson).toContain("已截断");
    const summonBtn = extractButtons(commentCard).find((b) => b.action === "state_summon");
    const fullBtn = extractButtons(commentCard).find((b) => b.action === "full");
    expect(summonBtn).toBeDefined();
    expect(fullBtn).toBeDefined();

    const summoned = await dispatch("om_comment", summonBtn?.value ?? {});
    expect(summoned.toast.type).toBe("info");
    await settle();
    expect(rec.deleted).toContain(trackedBefore);
    expect(JSON.stringify(rec.cards.at(-1)?.card)).toContain("状态：");

    const full = await dispatch("om_comment", fullBtn?.value ?? {});
    expect(full.toast.type).toBe("info");
    await settle();
    expect(rec.files).toHaveLength(1);
    expect(rec.files[0]?.fileName).toContain(".md");
    expect(rec.fileMessages).toHaveLength(1);
  });

  it("/agent card: switching via buttons reaches the bridge (kind regression anchor)", async () => {
    config.opencode.agents = ["build", "review"];
    handler = (req) => {
      if (req.method === "PUT" && req.url.includes("/issue/")) {
        labelUpdates.push({
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
    await bridge.executeAgent({ kind: "list", name: null }, binding(), "om_root", config);
    const agentCard = rec.cards.at(-1)?.card;
    const setBtn = extractButtons(agentCard).find((b) => b.label === "build");
    expect(setBtn).toBeDefined();
    expect(setBtn?.value.kind).toBe("bridge");

    const switched = await dispatch("om_agent", setBtn?.value ?? {});
    expect(switched.toast.type).toBe("info");
    await settle();
    expect(labelUpdates).toHaveLength(1);
    expect(labelUpdates[0]?.labels).toContain("agent:build");
    expect(labelUpdates[0]?.labels).not.toContain("agent:review");
    expect(rec.replies.some((r) => r.text.includes("agent:build"))).toBe(true);
    expect(rec.updates.some((u) => JSON.stringify(u.card).includes("🧠 Agent"))).toBe(true);
  });

  it("redelivery: a write executes once, an idempotent action repeats", async () => {
    transitionsHandler();
    const openBtn = extractButtons(await renderStateCard()).find((b) => b.action === "state_open");
    const pick = await dispatch("om_state", openBtn?.value ?? {});
    const trBtn = extractButtons(unwrapped(pick)).find((b) => b.action === "tr");
    const confirm = await dispatch("om_state", trBtn?.value ?? {});
    const okValue =
      extractButtons(unwrapped(confirm)).find((b) => b.action === "tr_confirm")?.value ?? {};
    const first = await dispatch("om_state", okValue);
    expect(first.toast.content).toBe("正在转换…");
    const redelivered = await dispatch("om_state", okValue);
    expect(redelivered.toast.content).toBe("该操作已处理");
    await settle();
    expect(transitionPosts).toBe(1);

    const refreshBtn = extractButtons(await renderStateCard()).find(
      (b) => b.action === "state_refresh",
    );
    await dispatch("om_state", refreshBtn?.value ?? {});
    const refreshAgain = await dispatch("om_state", refreshBtn?.value ?? {});
    expect(refreshAgain.toast.type).toBe("success");
  });
});

describe("direct round-trip guard", () => {
  let root: string;
  let store: BindingStore;
  let rec: ReturnType<typeof createRoundTripRecorder>;
  let manager: DirectSessionManager;
  let harness: ReturnType<typeof startRoundTrip>;
  let config: ReturnType<typeof makeRoundTripConfig>;

  const threadMsg = (text: string, n: number) =>
    ({
      message_id: `om_d${n}`,
      root_id: "om_d1",
      parent_id: "om_d1",
      msg_type: "text",
      text,
      sender_open_id: "ou_op",
      sender_name: "张三",
      sender_type: "user",
      create_time: String(100 + n),
      chat_id: "oc_intake",
    }) as never;
  const dispatch = async (messageId: string, value: Record<string, unknown>) =>
    (await harness?.dispatch(cardActionEvent(messageId, value))) as {
      toast: { type: string; content: string };
      card?: unknown;
    };
  const unwrapped = (reply: { card?: unknown }) =>
    (reply.card as { data?: unknown } | undefined)?.data ?? reply.card ?? {};
  const turnCard = (phase: "running" | "completed") =>
    buildTurnCard({
      rootId: "om_d1",
      sessionName: "会话",
      sessionStatus: "idle",
      turns: 1,
      totalTokens: 0,
      queued: 0,
      turn: 1,
      phase,
      toolCalls: 0,
      durationSec: 1,
      turnTokens: 0,
      texts: [],
      tools: [],
    });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rtd-"));
    store = new BindingStore(join(root, "b.db"));
    config = makeRoundTripConfig(undefined, true);
    rec = createRoundTripRecorder();
    const feishu = new FeishuSource(config.feishu, logger, rec.fetchImpl);
    store.upsertDirectSession({
      root_id: "om_d1",
      chat_id: "oc_intake",
      project: "tasking",
      name: "会话",
      path: "/tmp",
      session_id: null,
      status: "idle",
    });
    manager = new DirectSessionManager({ feishu, store, config: () => config, logger });
    const dummyBridge = new CommentBridge({
      tracker: trackerFor(),
      feishu,
      bindings: store,
      config: () => config,
      logger,
    });
    harness = startRoundTrip({ config, bridge: dummyBridge, direct: manager, logger });
    expect(harness).not.toBeNull();
  });

  afterEach(() => {
    harness?.stop();
    manager.stop();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("/auto card buttons flip the real override and refresh the card", async () => {
    await manager.handleThreadMessage(threadMsg("/auto", 2) as never);
    const buttons = extractButtons(rec.cards.at(-1)?.card);
    const on = buttons.find((b) => b.action === "auto_on");
    expect(on).toBeDefined();
    const turned = await dispatch("om_auto", on?.value ?? {});
    expect(turned.toast.type).toBe("success");
    expect(store.getDirectSession("om_d1")?.auto_approve_override).toBe("on");
    await new Promise((r) => setTimeout(r, 60));
    expect(rec.updates.some((u) => JSON.stringify(u.card).includes("🔓 本会话放开"))).toBe(true);
    const off = buttons.find((b) => b.action === "auto_off");
    const reverted = await dispatch("om_auto", off?.value ?? {});
    expect(reverted.toast.type).toBe("success");
    expect(store.getDirectSession("om_d1")?.auto_approve_override).toBeNull();
  });

  it("/collect card buttons start, submit and cancel through the real manager", async () => {
    await manager.handleThreadMessage(threadMsg("/send", 2) as never);
    const startBtn = extractButtons(rec.cards.at(-1)?.card).find(
      (b) => b.action === "collect_start",
    );
    expect(startBtn).toBeDefined();
    const started = await dispatch("om_collect", startBtn?.value ?? {});
    expect(started.toast.type).toBe("success");
    expect(started.toast.content).toContain("收集");

    await manager.handleThreadMessage(threadMsg("攒一条", 3) as never);
    await manager.handleThreadMessage(threadMsg("/collect", 4) as never);
    const buttons = extractButtons(rec.cards.at(-1)?.card);
    const send = buttons.find((b) => b.action === "collect_send");
    const cancel = buttons.find((b) => b.action === "collect_cancel");
    expect(send).toBeDefined();
    expect(cancel).toBeDefined();
    const cancelled = await dispatch("om_collect", cancel?.value ?? {});
    expect(cancelled.toast.type).toBe("success");
    expect(cancelled.toast.content).toContain("退出收集模式");
  });

  it("turn-card buttons route via the default branch to the real manager", async () => {
    const doneBtn = extractButtons(turnCard("completed")).find((b) => b.action === "done");
    expect(doneBtn).toBeDefined();
    const confirming = await dispatch("om_turn", doneBtn?.value ?? {});
    expect(confirming.toast.type).toBe("warning");
    expect(confirming.toast.content).toContain("确认是否结束");

    const permBtn = extractButtons(turnCard("completed")).find((b) => b.action === "perm");
    expect(permBtn).toBeDefined();
    const perm = await dispatch("om_turn", permBtn?.value ?? {});
    expect(perm.toast.type).toBe("warning");
    expect(perm.toast.content).toContain("确认是否放开");

    const stopBtn = extractButtons(turnCard("running")).find((b) => b.action === "stop");
    expect(stopBtn).toBeDefined();
    const stopped = await dispatch("om_turn", stopBtn?.value ?? {});
    expect(stopped.toast.content).toBe("该轮已结束");
  });
});

describe("turn card waiting marker", () => {
  it("renders the waiting-for-approval countdown in the header", () => {
    const card = buildTurnCard({
      rootId: "om_r",
      sessionName: "s",
      sessionStatus: "running",
      turns: 1,
      totalTokens: 0,
      queued: 0,
      turn: 1,
      phase: "running",
      toolCalls: 0,
      durationSec: 0,
      turnTokens: 0,
      texts: [],
      tools: [],
      waitingRemainingMs: 12 * 60_000,
    }) as { header?: { title?: { content?: string } } };
    expect(card.header?.title?.content ?? "").toContain("等待审批");
    expect(card.header?.title?.content ?? "").toContain("12m");
  });

  it("omits the marker when not waiting", () => {
    const card = buildTurnCard({
      rootId: "om_r",
      sessionName: "s",
      sessionStatus: "running",
      turns: 1,
      totalTokens: 0,
      queued: 0,
      turn: 1,
      phase: "running",
      toolCalls: 0,
      durationSec: 0,
      turnTokens: 0,
      texts: [],
      tools: [],
    }) as { header?: { title?: { content?: string } } };
    expect(card.header?.title?.content ?? "").not.toContain("等待审批");
  });
});

describe("approval card round-trip", () => {
  let root: string;
  let store: BindingStore;
  let server: MockServer;
  let bridge: CommentBridge;
  let replies: Array<{ sessionId: string; requestID: string; decision: string }>;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "rt-approve-"));
    store = new BindingStore(join(root, "b.db"));
    server = await createMockJiraServer(() => ({
      status: 200,
      body: searchResponse([makeIssue("1", "ENG-1")]),
    }));
    store.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
    });
    replies = [];
    const coordinator = new ApprovalCoordinator({
      replyPermission: async (sessionId, requestID, decision) => {
        replies.push({ sessionId, requestID, decision });
      },
    });
    const rec = createRoundTripRecorder();
    const feishu = new FeishuSource(makeRoundTripConfig().feishu, logger, rec.fetchImpl);
    bridge = new CommentBridge({
      tracker: trackerFor(server),
      feishu,
      bindings: store,
      config: () => makeRoundTripConfig(server),
      logger,
      approvals: { reply: (requestID, decision) => coordinator.reply(requestID, decision) },
    });
    startRoundTrip({ config: makeRoundTripConfig(server), bridge, logger });
    coordinator.ingest("ses_1", [
      {
        id: "per_1",
        sessionID: "ses_1",
        action: "shell",
        resources: ["echo x"],
        save: ["echo *"],
      },
    ]);
  });

  afterEach(() => {
    bridge.stop();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  function approvalCard() {
    return buildApprovalCard({
      rootId: "om_root",
      turn: 0,
      requestID: "per_1",
      action: "shell",
      resources: ["echo x"],
      save: ["echo *"],
      kind: "bridge",
    });
  }

  it("is card JSON 2.0 (schema 2.0, else Feishu drops body.elements)", () => {
    const card = approvalCard() as { schema?: string; body?: unknown };
    expect(card.schema).toBe("2.0");
    expect(card.body).toBeDefined();
  });

  it("dispatches an allow-once button through the real router and replies once", async () => {
    const harness = startRoundTrip({
      config: makeRoundTripConfig(server),
      bridge,
      logger,
    });
    const btn = extractButtons(approvalCard()).find((b) => b.action === "approve_once");
    expect(btn).toBeDefined();
    const result = (await harness?.dispatch(cardActionEvent("om_appr", btn?.value ?? {}))) as {
      toast: { type: string; content: string };
    };
    expect(result?.toast.type).toBe("success");
    expect(replies).toEqual([{ sessionId: "ses_1", requestID: "per_1", decision: "once" }]);
  });

  it("second click on the same rendered button is deduplicated", async () => {
    const harness = startRoundTrip({
      config: makeRoundTripConfig(server),
      bridge,
      logger,
    });
    const btn = extractButtons(approvalCard()).find((b) => b.action === "approve_always");
    const first = (await harness?.dispatch(cardActionEvent("om_appr2", btn?.value ?? {}))) as {
      toast: { type: string; content: string };
    };
    const second = (await harness?.dispatch(cardActionEvent("om_appr2", btn?.value ?? {}))) as {
      toast: { type: string; content: string };
    };
    expect(first?.toast.type).toBe("success");
    expect(second?.toast.content).toContain("已处理");
    expect(replies).toHaveLength(1);
  });

  it("clicking a stale re-rendered button still answers by current state", async () => {
    const harness = startRoundTrip({
      config: makeRoundTripConfig(server),
      bridge,
      logger,
    });
    const first = extractButtons(approvalCard()).find((b) => b.action === "approve_once");
    await harness?.dispatch(cardActionEvent("om_appr3", first?.value ?? {}));
    const rerendered = extractButtons(approvalCard()).find((b) => b.action === "approve_reject");
    const result = (await harness?.dispatch(
      cardActionEvent("om_appr3", rerendered?.value ?? {}),
    )) as { toast: { type: string; content: string } };
    expect(result?.toast.content).toContain("已处理");
    expect(replies).toHaveLength(1);
  });

  it("missing request_id payload is answered with an error and no reply", async () => {
    const harness = startRoundTrip({
      config: makeRoundTripConfig(server),
      bridge,
      logger,
    });
    const result = (await harness?.dispatch(
      cardActionEvent("om_appr4", {
        action: "approve_once",
        root_id: "om_root",
        kind: "bridge",
      }),
    )) as { toast: { type: string; content: string } };
    expect(result?.toast.type).toBe("error");
    expect(replies).toHaveLength(0);
  });
});
