import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeEventPayload } from "../src/adapters/feishu/events.js";
import { FeishuSource, toSecondsStr } from "../src/adapters/feishu/source.js";
import { JiraTracker, flattenAdfText, wrapCommentBody } from "../src/adapters/jira/tracker.js";
import { BindingStore } from "../src/bridge/binding-store.js";
import { CommentBridge } from "../src/bridge/comment-bridge.js";
import type { EffectiveConfig, FeishuConfig, TrackerConfig } from "../src/config/config-types.js";
import { resolveConfig } from "../src/config/resolver.js";
import { DirectSessionManager } from "../src/direct/manager.js";
import { ConsoleLogger } from "../src/observability/logger.js";
import { Scheduler } from "../src/scheduler/scheduler.js";
import type { AttemptResult } from "../src/worker/runner.js";
import { type FeishuMockSeed, createFeishuMock } from "./helpers/feishu-mock.js";
import { type MockServer, createMockJiraServer } from "./helpers/mock-http-server.js";

const logger = new ConsoleLogger({}, () => {});

type HarnessOverrides = Partial<{
  tracker: Partial<TrackerConfig>;
  feishu: Partial<Omit<FeishuConfig, "direct">> & { direct?: Record<string, unknown> };
}>;

function baseConfig(endpoint: string, over: HarnessOverrides = {}): EffectiveConfig {
  return resolveConfig(
    {
      tracker: {
        kind: "jira",
        endpoint,
        api_key: "tok",
        api_user: "agent@example.com",
        auth_mode: "bearer",
        project_key: "TEST",
        active_states: ["待办", "处理中"],
        terminal_states: ["完成", "关闭"],
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

interface StatefulIssue {
  key: string;
  id: string;
  status: string;
  title: string;
  labels: string[];
}

interface StatefulJira {
  server: MockServer;
  comments: Array<{ id: string; author: Record<string, unknown>; body: unknown; created: string }>;
  issues: StatefulIssue[];
  transitions: Array<{ id: string; name: string; to: { name: string } }>;
  postedCommentBodies: string[];
  transitionCalls: string[];
  labelUpdates: Array<{ key: string; labels: string[] }>;
  seedIssue: (over: Partial<StatefulIssue>) => void;
  addComment: (text: string, authorName?: string) => void;
  setStatus: (id: string, status: string) => void;
  getIssue: (id: string) => StatefulIssue | null;
}

async function createStatefulJiraMock(apiUser: string): Promise<StatefulJira> {
  let commentSeq = 1000;
  let issueSeq = 0;
  const state: StatefulJira = {
    server: null as unknown as MockServer,
    comments: [],
    issues: [],
    transitions: [
      { id: "11", name: "To Done", to: { name: "完成" } },
      { id: "21", name: "To Do", to: { name: "待办" } },
      { id: "31", name: "To In Progress", to: { name: "处理中" } },
    ],
    postedCommentBodies: [],
    transitionCalls: [],
    labelUpdates: [],
    seedIssue(over: Partial<StatefulIssue> = {}) {
      issueSeq++;
      state.issues.push({
        key: `TEST-${issueSeq}`,
        id: String(1000 + issueSeq),
        status: "待办",
        title: `task ${issueSeq}`,
        labels: [],
        ...over,
      });
    },
    addComment(text: string, authorName = apiUser) {
      commentSeq++;
      state.comments.push({
        id: String(commentSeq),
        author: { displayName: authorName },
        body: wrapCommentBody(text, false),
        created: `t${commentSeq}`,
      });
    },
    setStatus(id: string, status: string) {
      const issue = state.issues.find((i) => i.id === id);
      if (issue) issue.status = status;
    },
    getIssue(id: string) {
      return state.issues.find((i) => i.id === id) ?? null;
    },
  };

  const server = await createMockJiraServer((req) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url.endsWith("/issue") && !url.includes("/comment")) {
      const fields = (req.body as { fields?: { summary?: string; labels?: string[] } }).fields;
      const seq = state.issues.length + 1;
      const issue: StatefulIssue = {
        key: `TEST-${seq}`,
        id: String(1000 + seq),
        status: "待办",
        title: fields?.summary ?? `task ${seq}`,
        labels: Array.isArray(fields?.labels) ? [...(fields?.labels ?? [])] : [],
      };
      state.issues.push(issue);
      return { status: 201, body: { key: issue.key, id: issue.id } };
    }
    const commentMatch = /\/issue\/([^/]+)\/comment$/.exec(url);
    if (req.method === "GET" && commentMatch) {
      return { status: 200, body: { comments: [...state.comments] } };
    }
    if (req.method === "POST" && commentMatch) {
      const body = (req.body as { body?: unknown }).body;
      const text = flattenAdfText(body);
      state.postedCommentBodies.push(text);
      commentSeq++;
      state.comments.push({
        id: String(commentSeq),
        author: { displayName: apiUser },
        body: wrapCommentBody(text, false),
        created: `t${commentSeq}`,
      });
      return { status: 201, body: { id: String(commentSeq) } };
    }
    const transitionMatch = /\/issue\/([^/]+)\/transitions$/.exec(url);
    if (req.method === "GET" && transitionMatch) {
      return { status: 200, body: { transitions: [...state.transitions] } };
    }
    if (req.method === "POST" && transitionMatch) {
      const t = (req.body as { transition?: { id?: string } }).transition;
      state.transitionCalls.push(t?.id ?? "");
      const target = state.transitions.find((tr) => tr.id === t?.id);
      const key = transitionMatch[1];
      const issue = state.issues.find((i) => i.key === key);
      if (issue && target) issue.status = target.to.name;
      return { status: 204, body: "" };
    }
    const putIssueMatch = /\/issue\/([^/]+)$/.exec(url);
    if (req.method === "PUT" && putIssueMatch) {
      const key = putIssueMatch[1] ?? "";
      const fields = (req.body as { fields?: { labels?: string[] } }).fields;
      const issue = state.issues.find((i) => i.key === key);
      const labels = Array.isArray(fields?.labels) ? [...(fields?.labels ?? [])] : [];
      if (issue) issue.labels = labels;
      state.labelUpdates.push({ key, labels });
      return { status: 204, body: "" };
    }
    if (req.method === "POST" && url.endsWith("/search")) {
      const jql = (req.body as { jql?: string }).jql ?? "";
      const statusMatch = /status in \(([^)]*)\)/.exec(jql);
      let issues = [...state.issues];
      if (statusMatch) {
        const names = statusMatch[1].split(",").map((s) => s.replace(/"/g, "").trim());
        issues = issues.filter((i) => names.includes(i.status));
      }
      return {
        status: 200,
        body: {
          total: issues.length,
          issues: issues.map((i) => ({
            id: i.id,
            key: i.key,
            fields: { summary: i.title, status: { name: i.status }, labels: i.labels },
          })),
        },
      };
    }
    return { status: 200, body: {} };
  });
  state.server = server;
  return state;
}

function getBindingOrFail(bindings: BindingStore, id: string) {
  const b = bindings.getBinding(id);
  if (!b) throw new Error(`binding ${id} missing`);
  return b;
}

function getThreadIdOrFail(b: { thread_id: string | null }): string {
  if (!b.thread_id) throw new Error("binding has no thread_id");
  return b.thread_id;
}

function getLastCommentIdOrFail(state: { comments: Array<{ id: string }> }): string {
  const last = state.comments.at(-1);
  if (!last) throw new Error("no comments");
  return last.id;
}

function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(fn: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

type FeishuMockMessage = ReturnType<ReturnType<typeof createFeishuMock>["seedChatMessage"]>;

interface Harness {
  root: string;
  bindings: BindingStore;
  jira: StatefulJira;
  feishu: ReturnType<typeof createFeishuMock>;
  config: EffectiveConfig;
  tracker: JiraTracker;
  scheduler: Scheduler;
  bridge: CommentBridge;
  directManager: DirectSessionManager | null;
  agentRuns: () => string[];
  close: () => Promise<void>;
  /** Seed a root message in the intake group AND deliver it via the event channel. */
  emitIntake: (seed: FeishuMockSeed) => Promise<FeishuMockMessage>;
  /** Seed a reply inside a thread AND deliver it via the event channel. */
  emitThread: (threadId: string, seed: FeishuMockSeed) => Promise<FeishuMockMessage>;
}

async function createHarness(
  over?: HarnessOverrides & {
    directSpawn?: import("../src/direct/driver.js").DirectTurnDriver;
  },
): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "tasking-flow-"));
  const bindings = new BindingStore(join(root, "b.db"));
  bindings.setMeta("intake_cursor", "1");
  const jira = await createStatefulJiraMock(over?.tracker?.api_user ?? "agent@example.com");
  const feishu = createFeishuMock();
  const config = baseConfig(`${jira.server.baseUrl}/rest/api/2`, over);
  config.workspace.root = root;
  const tracker = new JiraTracker(config.tracker);
  const gate = deferred<void>();
  const agentRuns: string[] = [];
  const scheduler = new Scheduler({
    tracker,
    config: () => config,
    logger,
    runAttemptFn: (async (opts: { task: { identifier: string } }) => {
      agentRuns.push(opts.task.identifier);
      await gate.promise;
      return {
        status: "succeeded",
        error: null,
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        session_id: null,
        started_at: Date.now(),
        ended_at: Date.now(),
      } satisfies AttemptResult;
    }) as never,
  });
  let directManager: DirectSessionManager | null = null;
  if (config.feishu.direct.enabled && over?.directSpawn) {
    directManager = new DirectSessionManager({
      feishu: new FeishuSource(config.feishu, logger, feishu.fetchImpl),
      store: bindings,
      config: () => config,
      logger,
      turnDriver: over.directSpawn,
    });
    directManager.start();
  }
  const bridge = new CommentBridge({
    tracker,
    feishu: new FeishuSource(config.feishu, logger, feishu.fetchImpl),
    bindings,
    config: () => config,
    logger,
    scheduler,
    direct: directManager ?? undefined,
  });
  const emit = async (m: ReturnType<typeof feishu.seedChatMessage>): Promise<void> => {
    const payload = {
      sender: {
        sender_id: { open_id: m.sender.sender_id?.open_id ?? "ou_x" },
        sender_type: m.sender.sender_type,
      },
      message: {
        message_id: m.message_id,
        root_id: m.root_id ?? "",
        parent_id: m.parent_id ?? "",
        thread_id: m.root_id ? `omt_${m.root_id}` : "",
        message_type: m.msg_type,
        create_time: m.create_time,
        chat_id: "oc_intake",
        content: m.body.content,
      },
    };
    const normalized = normalizeEventPayload(payload);
    if (!normalized) throw new Error("emit: unnormalizable payload");
    await bridge.ingestMessage(normalized);
  };
  const emitIntake = async (seed: FeishuMockSeed): Promise<FeishuMockMessage> => {
    const m = feishu.seedChatMessage("oc_intake", seed);
    await emit(m);
    return m;
  };
  const emitThread = async (threadId: string, seed: FeishuMockSeed): Promise<FeishuMockMessage> => {
    const m = feishu.seedThreadMessage(threadId, seed);
    await emit(m);
    return m;
  };
  bridge.start();
  const close = async () => {
    bridge.stop();
    directManager?.stop();
    scheduler.stop();
    gate.resolve();
    bindings.close();
    rmSync(root, { recursive: true, force: true });
    await jira.server.close();
  };
  return {
    root,
    bindings,
    jira,
    feishu,
    config,
    tracker,
    scheduler,
    bridge,
    directManager,
    agentRuns: () => [...agentRuns],
    emitIntake,
    emitThread,
    close,
  };
}

describe("E2E flow: Jira-origin with real Scheduler + agent worker", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
  });

  afterEach(async () => {
    await h.close();
  });

  it("dispatches issue → creates topic → agent comment bridges to feishu → terminal closes binding", async () => {
    h.jira.seedIssue({ key: "TEST-1", id: "1001", title: "Fix bug" });

    await h.scheduler.tick();

    await waitFor(() => h.bindings.getBinding("1001") !== null);
    const binding = getBindingOrFail(h.bindings, "1001");
    expect(binding.issue_key).toBe("TEST-1");
    expect(binding.thread_id).not.toBeNull();
    expect(h.feishu.chatMessages("oc_intake").some((m) => m.body.content.includes("已开始"))).toBe(
      true,
    );

    await waitFor(() => h.agentRuns().includes("TEST-1"));
    expect(h.agentRuns()).toContain("TEST-1");

    const agent = h.jira.getIssue("1001");
    expect(agent?.status).toBe("待办");

    h.jira.addComment("agent 完成的工作说明", "agent@example.com");
    await h.bridge.forwardComments(getBindingOrFail(h.bindings, "1001"), h.config);
    const threadId = getThreadIdOrFail(binding);
    expect(
      h.feishu
        .threadMessages(threadId)
        .some((m) => m.body.content.includes("agent 完成的工作说明")),
    ).toBe(true);
    expect(h.bindings.getBinding("1001")?.last_jira_comment_id).toBe(
      getLastCommentIdOrFail(h.jira),
    );

    const userReply = h.feishu.seedThreadMessage(threadId, {
      text: "请修复这个问题",
      senderName: "Bob",
      senderOpenId: "ou_bob",
    });
    await h.bridge.bridgeMessages(getBindingOrFail(h.bindings, "1001"), h.config);
    expect(h.jira.postedCommentBodies.some((b) => b.includes("请修复这个问题"))).toBe(true);
    expect(h.jira.postedCommentBodies.some((b) => b.includes("via Feishu"))).toBe(true);
    expect(h.bindings.getBinding("1001")?.last_feishu_msg_id).toBe(
      toSecondsStr(userReply.create_time),
    );

    h.jira.setStatus("1001", "完成");
    await h.scheduler.tick();

    await waitFor(() => h.bindings.getBinding("1001")?.status === "terminal");
    expect(h.bindings.getBinding("1001")?.status).toBe("terminal");
    expect(h.feishu.chatMessages("oc_intake").some((m) => m.body.content.includes("已完结"))).toBe(
      true,
    );
  });
});

describe("E2E flow: Feishu-origin with real Scheduler + agent worker", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
  });

  afterEach(async () => {
    await h.close();
  });

  it("creates issue from /issue → agent executes → replies bridge both ways → /state closes binding", async () => {
    await h.emitIntake({
      text: "/issue 测试任务\n多行描述内容",
      senderName: "Alice",
      senderOpenId: "ou_alice",
    });

    expect(h.jira.issues).toHaveLength(1);
    const issue = h.jira.issues[0];
    if (!issue) throw new Error("no issue");
    expect(issue.key).toBe("TEST-1");
    const binding = getBindingOrFail(h.bindings, issue.id);
    expect(binding.issue_key).toBe("TEST-1");
    expect(binding.thread_id).not.toBeNull();
    const threadId = getThreadIdOrFail(binding);

    await h.scheduler.tick();
    await waitFor(() => h.agentRuns().includes("TEST-1"));
    expect(h.agentRuns()).toContain("TEST-1");

    const userReply = await h.emitThread(threadId, {
      text: "请修复这个问题",
      senderName: "Bob",
      senderOpenId: "ou_bob",
    });
    expect(h.jira.postedCommentBodies.some((b) => b.includes("请修复这个问题"))).toBe(true);
    expect(h.jira.postedCommentBodies.some((b) => b.includes("via Feishu"))).toBe(true);
    expect(h.bindings.getBinding(issue.id)?.last_feishu_msg_id).toBe(
      toSecondsStr(userReply.create_time),
    );

    h.jira.addComment("已修复，请验证", "agent@example.com");
    await h.bridge.forwardComments(getBindingOrFail(h.bindings, issue.id), h.config);
    expect(
      h.feishu.threadMessages(threadId).some((m) => m.body.content.includes("已修复，请验证")),
    ).toBe(true);
    expect(h.bindings.getBinding(issue.id)?.last_jira_comment_id).toBe(
      getLastCommentIdOrFail(h.jira),
    );

    h.jira.addComment("💬 Bob via 飞书:\n请修复这个问题");
    const msgsBeforeSentinel = h.feishu.threadMessages(threadId).length;
    await h.bridge.forwardComments(getBindingOrFail(h.bindings, issue.id), h.config);
    expect(h.feishu.threadMessages(threadId).length).toBe(msgsBeforeSentinel);
    expect(h.bindings.getBinding(issue.id)?.last_jira_comment_id).toBe(
      getLastCommentIdOrFail(h.jira),
    );

    await h.emitThread(threadId, {
      text: "/state 1",
      senderName: "Bob",
      senderOpenId: "ou_bob",
    });
    expect(h.jira.transitionCalls).toContain("11");
    expect(h.bindings.getBinding(issue.id)?.status).toBe("terminal");
    const ack = h.feishu
      .chatMessages("oc_intake")
      .filter((m) => m.body.content.includes("已转 完成"));
    expect(ack.length).toBeGreaterThan(0);
  });

  it("sweep backstop: a message that bypassed the event channel is caught by bridgeMessages", async () => {
    await h.emitIntake({
      text: "/issue 兜底任务\n描述",
      senderName: "Alice",
      senderOpenId: "ou_alice",
    });
    expect(h.jira.issues).toHaveLength(1);
    const issue = h.jira.issues[0];
    if (!issue) throw new Error("no issue");
    const threadId = getThreadIdOrFail(getBindingOrFail(h.bindings, issue.id));

    h.feishu.seedThreadMessage(threadId, {
      text: "这条消息绕过了事件通道",
      senderName: "Bob",
      senderOpenId: "ou_bob",
    });
    expect(h.jira.postedCommentBodies.some((b) => b.includes("绕过了事件通道"))).toBe(false);

    await h.bridge.bridgeMessages(getBindingOrFail(h.bindings, issue.id), h.config);
    await h.bridge.whenIdle();
    expect(h.jira.postedCommentBodies.some((b) => b.includes("绕过了事件通道"))).toBe(true);
    const binding = getBindingOrFail(h.bindings, issue.id);
    expect(binding.last_feishu_msg_id).not.toBeNull();
  });
});

describe("E2E flow: /agent command (multi-agent per-task selection)", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
    h.bridge.stop();
    h.config.opencode.agent = "build";
    h.config.opencode.agents = ["Build", "Review"];
  });

  afterEach(async () => {
    await h.close();
  });

  it("/issue --agent tags the issue; /agent lists, switches, and resets the agent label", async () => {
    await h.emitIntake({
      text: "/issue --agent review 测试任务\n多行描述",
      senderName: "Alice",
      senderOpenId: "ou_alice",
    });

    expect(h.jira.issues).toHaveLength(1);
    const issue = h.jira.issues[0];
    if (!issue) throw new Error("no issue");
    expect(issue.labels).toEqual(["agent:review"]);

    const binding = getBindingOrFail(h.bindings, issue.id);
    const threadId = getThreadIdOrFail(binding);

    await h.emitThread(threadId, {
      text: "/agent",
      senderName: "Bob",
      senderOpenId: "ou_bob",
    });
    expect(
      h.feishu.chatMessages("oc_intake").some((m) => m.body.content.includes("当前 agent: Review")),
    ).toBe(true);

    await h.emitThread(threadId, {
      text: "/agent build",
      senderName: "Bob",
      senderOpenId: "ou_bob",
    });
    expect(h.jira.labelUpdates.at(-1)?.labels).toEqual(["agent:build"]);
    expect(h.jira.getIssue(issue.id)?.labels).toEqual(["agent:build"]);

    await h.emitThread(threadId, {
      text: "/agent default",
      senderName: "Bob",
      senderOpenId: "ou_bob",
    });
    expect(h.jira.labelUpdates.at(-1)?.labels).toEqual([]);
    expect(h.jira.getIssue(issue.id)?.labels).toEqual([]);
  });

  it("/agent <name> in the intake group is rejected with a use-in-thread hint", async () => {
    await h.emitIntake({
      text: "/agent review",
      senderName: "Alice",
      senderOpenId: "ou_alice",
    });
    expect(h.feishu.chatMessages("oc_intake").some((m) => m.body.content.includes("话题"))).toBe(
      true,
    );
  });
});

describe("E2E flow: Feishu /chat direct session", () => {
  interface DirectSpawnRecord {
    cmd: string[];
    cwd: string;
  }

  function makeDirectHarness(projectDir: string) {
    const spawnCalls: DirectSpawnRecord[] = [];
    const directSpawn: import("../src/direct/driver.js").DirectTurnDriver = async (request) => {
      const cmd = [
        "opencode",
        "run",
        "--dir",
        request.directory,
        ...(request.sessionId ? ["-s", request.sessionId] : []),
        ...(request.autoApprove ? ["--auto"] : []),
        request.prompt,
      ];
      const cwd = request.directory;
      spawnCalls.push({ cmd, cwd });
      request.onEvent?.({
        type: "text",
        text: `回执 ${spawnCalls.length}`,
      });
      return {
        status: "succeeded",
        sessionId: `ses_direct${spawnCalls.length}`,
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        error: null,
        postureOpened: request.autoApprove,
      };
    };
    return createHarness({
      feishu: {
        direct: {
          projects: { tasking: { path: projectDir, auto_approve: null } },
          verbosity: "summary",
        },
      },
      directSpawn,
    }).then((h) => ({ h, spawnCalls }));
  }

  let ctx: Awaited<ReturnType<typeof makeDirectHarness>>;
  let directProjectDir: string;

  beforeEach(async () => {
    directProjectDir = mkdtempSync(join(tmpdir(), "tasking-direct-proj-"));
    ctx = await makeDirectHarness(directProjectDir);
  });

  afterEach(async () => {
    await ctx.h.close();
    rmSync(directProjectDir, { recursive: true, force: true });
  });

  it("/chat project → ack+summary in thread → follow-up continues same session → /done ends", async () => {
    const { h, spawnCalls } = ctx;
    const root = await h.emitIntake({ text: "/chat tasking 帮我跑下测试" });
    const threadId = h.feishu.threadIdFor(root.message_id);

    await waitFor(() =>
      h.feishu.threadMessages(threadId).some((m) => m.body.content.includes("会话已创建")),
    );
    await waitFor(() => h.bindings.getDirectSession(root.message_id) !== null);
    await waitFor(() => spawnCalls.length >= 1);
    await waitFor(() =>
      h.feishu.threadMessages(threadId).some((m) => m.body.content.includes("回执 1")),
    );
    const first = spawnCalls[0];
    expect(first?.cmd).toContain("--dir");
    expect(first?.cmd[first.cmd.indexOf("--dir") + 1]).toBe(realpathSync(directProjectDir));
    expect(first?.cwd).toBe(realpathSync(directProjectDir));
    expect(first?.cmd).not.toContain("--title");
    expect(first?.cmd).not.toContain("--auto");

    const session = h.bindings.getDirectSession(root.message_id);
    expect(session?.status).toBe("idle");
    expect(session?.session_id).toBe("ses_direct1");

    await h.emitThread(threadId, { text: "第二问，继续看" });
    await waitFor(() => spawnCalls.length >= 2);
    const second = spawnCalls[1];
    expect(second?.cmd).toContain("-s");
    expect(second?.cmd[second.cmd.indexOf("-s") + 1]).toBe("ses_direct1");
    expect(second?.cmd[second.cmd.length - 1]).toBe("第二问，继续看");
    await waitFor(() =>
      h.feishu.threadMessages(threadId).some((m) => m.body.content.includes("回执 2")),
    );

    await h.emitThread(threadId, { text: "/done" });
    await waitFor(() => h.bindings.getDirectSession(root.message_id)?.status === "done");
    expect(h.feishu.threadMessages(threadId).some((m) => m.body.content.includes("已结束"))).toBe(
      true,
    );

    await h.emitThread(threadId, { text: "结束后的追问" });
    await new Promise((r) => setTimeout(r, 50));
    expect(spawnCalls.length).toBe(2);
    expect(h.feishu.threadMessages(threadId).some((m) => m.body.content.includes("已结束"))).toBe(
      true,
    );
  });

  it("unknown project replies with the project list and creates no session", async () => {
    const { h, spawnCalls } = ctx;
    const root = await h.emitIntake({ text: "/chat nope 你好" });
    expect(
      h.feishu.chatMessages("oc_intake").some((m) => m.body.content.includes("未找到项目")),
    ).toBe(true);
    expect(h.bindings.getDirectSession(root.message_id)).toBeNull();
    expect(spawnCalls).toHaveLength(0);
  });

  it("/chat with no direct config falls through to unknown command", async () => {
    const h = await createHarness();
    try {
      const root = await h.emitIntake({ text: "/chat tasking 你好" });
      expect(
        h.feishu.chatMessages("oc_intake").some((m) => m.body.content.includes("未知命令")),
      ).toBe(true);
      expect(h.bindings.getDirectSession(root.message_id)).toBeNull();
    } finally {
      await h.close();
    }
  });
});

describe("E2E flow: /chat direct session turn cards", () => {
  function makeCardHarness(projectDir: string) {
    let spawnCount = 0;
    const directSpawn: import("../src/direct/driver.js").DirectTurnDriver = async (request) => {
      spawnCount++;
      request.onEvent?.({
        type: "tool_use",
        tool: "bash",
        title: "npm test",
        status: "completed",
        exit: 0,
        input: { command: "npm test" },
        output: "PASS tests/card.test.ts",
        durationMs: 42,
      });
      request.onEvent?.({ type: "text", text: `跑完了 ${spawnCount}` });
      return {
        status: "succeeded",
        sessionId: `ses_card${spawnCount}`,
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        error: null,
        postureOpened: request.autoApprove,
      };
    };
    return createHarness({
      feishu: {
        direct: {
          projects: { tasking: { path: projectDir, auto_approve: null } },
          verbosity: "detailed",
        },
      },
      directSpawn,
    });
  }

  let projectDir: string;
  let h: Awaited<ReturnType<typeof makeCardHarness>>;

  beforeEach(async () => {
    projectDir = mkdtempSync(join(tmpdir(), "tasking-card-proj-"));
    h = await makeCardHarness(projectDir);
  });

  afterEach(async () => {
    await h.close();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("evolves one card per turn, seals the previous, and applies a card action", async () => {
    const root = await h.emitIntake({ text: "/chat tasking 干活" });
    await waitFor(() => h.feishu.cardMessages(root.message_id).length >= 1);
    const turnCard = JSON.stringify(h.feishu.cardMessages(root.message_id)[0]?.card);
    expect(turnCard).toContain('"schema":"2.0"');
    expect(turnCard).toContain("干活");
    await waitFor(() =>
      h.feishu.cardUpdates().some((u) => JSON.stringify(u.card).includes("npm test")),
    );
    await waitFor(() => h.feishu.cardMessages(root.message_id).length === 2);
    const resultCard = JSON.stringify(h.feishu.cardMessages(root.message_id)[1]?.card);
    expect(resultCard).toContain("跑完了 1");
    expect(resultCard).not.toContain("npm test");

    const threadId = h.feishu.threadIdFor(root.message_id);
    await h.emitThread(threadId, { text: "再来一次" });
    await waitFor(() =>
      h.feishu.cardUpdates().some((u) => JSON.stringify(u.card).includes("该轮已结束")),
    );

    const reply = await h.directManager?.handleCardAction({
      messageId: "om_card_x",
      chatId: "oc_intake",
      operatorOpenId: "ou_x",
      operatorName: "张三",
      value: { action: "done_confirm", root_id: root.message_id, turn: 2 },
    });
    expect(reply?.toast.content).toContain("已结束");
    await waitFor(() => h.bindings.getDirectSession(root.message_id)?.status === "done");
  });
});
