import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FeishuEventListener } from "../src/adapters/feishu/events.js";
import { FeishuSource } from "../src/adapters/feishu/source.js";
import { JiraTracker } from "../src/adapters/jira/tracker.js";
import { BindingStore } from "../src/bridge/binding-store.js";
import type { ParsedIssue } from "../src/bridge/commands.js";
import { CommentBridge, type SchedulerPort } from "../src/bridge/comment-bridge.js";
import type { EffectiveConfig } from "../src/config/config-types.js";
import { resolveConfig } from "../src/config/resolver.js";
import { ConsoleLogger } from "../src/observability/logger.js";
import { setLocale } from "../src/translate/locale.js";
import {
  assertE2ECredsComplete,
  loadE2ECredsEnvFile,
  resolveE2ECreds,
} from "./helpers/e2e-creds.js";

const logger = new ConsoleLogger({}, () => {});

loadE2ECredsEnvFile();

const CREDS = resolveE2ECreds(process.env);

const enabled = process.env.INTEGRATION === "1";

if (enabled) assertE2ECredsComplete(CREDS);

function makeConfig(endpoint: string): EffectiveConfig {
  const lang = process.env.TASKING_IT_LANG === "en" ? "en" : "zh";
  return resolveConfig(
    {
      ...(lang === "en" ? { interface_language: "en" as const } : {}),
      tracker: {
        kind: "jira",
        endpoint,
        api_key: CREDS.jiraApiKey,
        api_user: "agent@example.com",
        auth_mode: "bearer",
        project_key: CREDS.jiraProjectKey,
        active_states: ["待办", "处理中"],
        terminal_states: ["完成", "关闭"],
      },
      feishu: {
        enabled: true,
        app_id: CREDS.feishuAppId,
        app_secret: CREDS.feishuAppSecret,
        intake_chat_id: CREDS.feishuIntakeChatId,
        forward_interval_ms: 2000,
        sweep_interval_ms: 60000,
        create_issue_type: "任务",
      },
    },
    "/tmp",
    "prompt",
  );
}

interface Harness {
  root: string;
  bindings: BindingStore;
  config: EffectiveConfig;
  tracker: JiraTracker;
  feishu: FeishuSource;
  bridge: CommentBridge;
  running: Map<string, { task: { identifier: string; title: string } }>;
  close: () => void;
}

function createHarness(endpoint: string): Harness {
  const root = mkdtempSync(join(tmpdir(), "tasking-real-"));
  const bindings = new BindingStore(join(root, "b.db"));
  const config = makeConfig(endpoint);
  setLocale(config.interface_language);
  const tracker = new JiraTracker(config.tracker);
  const feishu = new FeishuSource(config.feishu, logger);
  const running = new Map<string, { task: { identifier: string; title: string } }>();
  const scheduler: SchedulerPort = {
    on: ((e: string, l: (...a: unknown[]) => void) => {
      return;
    }) as SchedulerPort["on"],
    state: { running },
  };
  const bridge = new CommentBridge({
    tracker,
    feishu,
    bindings,
    config: () => config,
    logger,
    scheduler,
  });
  return {
    root,
    bindings,
    config,
    tracker,
    feishu,
    bridge,
    running,
    close: () => {
      setLocale("zh");
      bindings.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function dispatch(bridge: CommentBridge, id: string): Promise<void> {
  const fn = (
    bridge as unknown as {
      onDispatch: (this: CommentBridge, id: string) => Promise<void>;
    }
  ).onDispatch;
  return fn.call(bridge, id);
}

function terminate(bridge: CommentBridge, id: string): Promise<void> {
  const fn = (
    bridge as unknown as {
      onTerminate: (this: CommentBridge, id: string, reason: string) => Promise<void>;
    }
  ).onTerminate;
  return fn.call(bridge, id, "terminal");
}

function getBindingOrFail(bindings: BindingStore, id: string) {
  const b = bindings.getBinding(id);
  if (!b) throw new Error(`binding ${id} missing`);
  return b;
}

async function waitFor(fn: () => boolean | Promise<boolean>, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function deleteJiraIssue(key: string): Promise<void> {
  const base = CREDS.jiraEndpoint.replace(/\/+$/, "");
  await fetch(`${base}/issue/${key}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${CREDS.jiraApiKey}` },
  }).catch(() => {});
}

async function findTransition(
  tracker: JiraTracker,
  issueKey: string,
  wantToName: string,
): Promise<string | null> {
  const ts = await tracker.fetchTransitions(issueKey);
  const hit = ts.find((t) => t.toName.toLowerCase() === wantToName.toLowerCase());
  return hit?.id ?? null;
}

async function assertIssueState(
  tracker: JiraTracker,
  issueId: string,
  expected: string,
): Promise<void> {
  const tasks = await tracker.fetchIssueStatesByIds([issueId]);
  const state = tasks[0]?.state ?? "";
  if (state.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`issue state expected "${expected}" got "${state}"`);
  }
}

const skipMsg =
  "skipping real integration: set INTEGRATION=1 to run (credentials have built-in defaults)";

describe("REAL integration (INTEGRATION=1 to run; skipped otherwise)", () => {
  it("runs Jira-origin full flow against real Feishu + real Jira TEST project", async () => {
    if (!enabled) {
      console.log(skipMsg);
      return;
    }
    const h = createHarness(CREDS.jiraEndpoint);
    let createdKey: string | null = null;
    try {
      const created = await h.tracker.createIssue({
        project: { key: CREDS.jiraProjectKey },
        summary: `TAS-11 jira-origin ${Date.now()}`,
        description: "real e2e jira-origin probe",
        issuetype: { name: "任务" },
      });
      createdKey = created.key;
      h.running.set(created.id, { task: { identifier: created.key, title: "jira-origin e2e" } });

      await dispatch(h.bridge, created.id);
      const binding = getBindingOrFail(h.bindings, created.id);
      expect(binding.issue_key).toBe(created.key);
      expect(binding.thread_id).not.toBeNull();
      expect(binding.root_id).not.toBe("");

      await waitFor(async () => {
        try {
          const msgs = await h.feishu.listMessages(CREDS.feishuIntakeChatId, "");
          return msgs.some(
            (m) =>
              (m.text.includes("已开始") || m.text.includes("started")) &&
              m.text.includes(created.key),
          );
        } catch {
          return false;
        }
      });

      const tProgress = await findTransition(h.tracker, created.key, "处理中");
      if (tProgress) {
        await h.tracker.transitionIssue(created.key, tProgress);
        await assertIssueState(h.tracker, created.id, "处理中");
      }
      await h.tracker.postComment(created.key, "agent 已完成实现，请评审");

      await h.bridge.forwardComments(getBindingOrFail(h.bindings, created.id), h.config);
      const threadId = binding.thread_id;
      if (!threadId) throw new Error("binding has no thread_id");
      await waitFor(async () => {
        try {
          const reps = await h.feishu.listThreadReplies(threadId, null);
          // Comments are mirrored as interactive cards; the polled message shape
          // does not expose the card body, so assert the card arrived.
          return reps.some((m) => m.msg_type === "interactive");
        } catch {
          return false;
        }
      });

      const tDone =
        (await findTransition(h.tracker, created.key, "完成")) ??
        (await findTransition(h.tracker, created.key, "关闭"));
      if (tDone) await h.tracker.transitionIssue(created.key, tDone);

      await terminate(h.bridge, created.id);
      expect(h.bindings.getBinding(created.id)?.status).toBe("terminal");
    } finally {
      h.close();
      if (createdKey) await deleteJiraIssue(createdKey);
    }
  });

  it("runs Feishu-origin full flow via executeIssue against real Feishu + real Jira TEST project", async () => {
    if (!enabled) {
      console.log(skipMsg);
      return;
    }
    const h = createHarness(CREDS.jiraEndpoint);
    let createdKey: string | null = null;
    try {
      const rootMsgId = await h.feishu.postMessage(
        CREDS.feishuIntakeChatId,
        `e2e feishu-origin root ${Date.now()}`,
      );
      if (!rootMsgId) throw new Error("postMessage root failed");

      const parsed: ParsedIssue = {
        kind: "create",
        title: `飞书入口 e2e ${Date.now()}`,
        description: "real e2e feishu-origin probe",
        typeOverride: null,
      };
      await h.bridge.executeIssue(parsed, rootMsgId, h.config);

      const active = h.bindings.listActive();
      expect(active).toHaveLength(1);
      const binding = active[0];
      if (!binding) throw new Error("no binding after executeIssue");
      createdKey = binding.issue_key;
      expect(binding.issue_key).toMatch(/^TEST-\d+$/);
      expect(binding.thread_id).not.toBeNull();

      const tProgress = await findTransition(h.tracker, binding.issue_key, "处理中");
      if (tProgress) {
        await h.tracker.transitionIssue(binding.issue_key, tProgress);
        await assertIssueState(h.tracker, binding.issue_id, "处理中");
      }
      await h.tracker.postComment(binding.issue_key, "agent 已通过飞书入口完成，请评审");

      await h.bridge.forwardComments(binding, h.config);
      const threadId = binding.thread_id;
      if (!threadId) throw new Error("binding has no thread_id");
      await waitFor(async () => {
        try {
          const reps = await h.feishu.listThreadReplies(threadId, null);
          return (
            reps.some(
              (m) =>
                (m.text.includes("已创建") || m.text.includes("Created")) &&
                m.text.includes(binding.issue_key),
            ) &&
            // The mirrored comment is an interactive card now (body not in m.text).
            reps.some((m) => m.msg_type === "interactive")
          );
        } catch {
          return false;
        }
      });

      const tDone =
        (await findTransition(h.tracker, binding.issue_key, "完成")) ??
        (await findTransition(h.tracker, binding.issue_key, "关闭"));
      if (tDone) await h.tracker.transitionIssue(binding.issue_key, tDone);

      await terminate(h.bridge, binding.issue_id);
      expect(h.bindings.getBinding(binding.issue_id)?.status).toBe("terminal");
    } finally {
      h.close();
      if (createdKey) await deleteJiraIssue(createdKey);
    }
  });
});

describe("real Feishu event channel smoke", () => {
  it("connects the WS event channel with real credentials", async () => {
    if (!enabled) return;
    let connected = false;
    const listener = new FeishuEventListener({
      appId: CREDS.feishuAppId,
      appSecret: CREDS.feishuAppSecret,
      onMessage: () => {},
      onConnected: () => {
        connected = true;
      },
      logger,
    });
    listener.start();
    const start = Date.now();
    while (!connected && Date.now() - start < 12000) {
      await new Promise((r) => setTimeout(r, 200));
    }
    listener.stop();
    expect(connected).toBe(true);
  });
});
