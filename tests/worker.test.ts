import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  AgentConfig,
  HooksConfig,
  OpencodeConfig,
  TrackerConfig,
  WorkspaceConfig,
} from "../src/config/config-types.js";
import type { ActivityEvent } from "../src/observability/activity-store.js";
import { ConsoleLogger } from "../src/observability/logger.js";
import type { Task } from "../src/shared/types.js";
import { type WorkerEvent, runAttempt } from "../src/worker/runner.js";
import { readSessionSidecar, resolveWorkspacePath } from "../src/workspace/manager.js";

const logger = new ConsoleLogger({}, () => {});

function makeConfig(root: string): {
  opencode: OpencodeConfig;
  hooks: HooksConfig;
  agent: AgentConfig;
  workspace: WorkspaceConfig;
  tracker: TrackerConfig;
  env: Record<string, string>;
} {
  return {
    opencode: {
      command: "opencode",
      agent: "build",
      agents: [],
      model: null,
      variant: null,
      turn_timeout_ms: 60000,
      stall_timeout_ms: 300000,
      inactivity_timeout_ms: 600000,
      auto_approve: false,
      poll_interval_ms: 1,
      permission_timeout_ms: 600000,
      server_url: null,
    } satisfies OpencodeConfig,
    hooks: {
      after_create: null,
      before_run: null,
      after_run: null,
      before_remove: null,
      timeout_ms: 60000,
    } as HooksConfig,
    agent: {
      max_concurrent_agents: 10,
      max_turns: 20,
      max_retry_backoff_ms: 300000,
      max_concurrent_agents_by_state: {},
    } satisfies AgentConfig,
    workspace: { root } satisfies WorkspaceConfig,
    tracker: {
      kind: "jira",
      endpoint: "https://example.atlassian.net/rest/api/3",
      api_key: "tok",
      api_user: "user@e.com",
      auth_mode: "basic" as const,
      review_state: null,
      project_key: "ENG",
      project_slug: null,
      assignee: null,
      required_labels: [],
      active_states: ["To Do", "In Progress"],
      terminal_states: ["Done"],
    },
    env: {} as Record<string, string>,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "1",
    identifier: "ABC-123",
    title: "Fix bug",
    description: "the bug",
    priority: 2,
    state: "In Progress",
    branch_name: null,
    url: null,
    labels: ["bug"],
    blocked_by: [],
    assignee: null,
    created_at: null,
    updated_at: null,
    source: "jira",
    ...overrides,
  };
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tasking-worker-"));
}

interface ApiScriptOptions {
  sessionId?: string;
  tokens?: { input: number; output: number; reasoning: number } | null;
  outcome?: string | null;
  messages?: Array<{
    content?: Array<Record<string, unknown>>;
    tokens?: { input: number; output: number; reasoning: number } | null;
  }>;
}

function apiScript(opts: ApiScriptOptions = {}) {
  const sessionId = opts.sessionId ?? "ses_test123";
  const tokens = opts.tokens === undefined ? { input: 10, output: 5, reasoning: 0 } : opts.tokens;
  const outcome = opts.outcome === undefined ? "succeeded" : opts.outcome;
  const messages = opts.messages ?? [{ content: [], tokens }];
  const state = {
    prompts: [] as string[],
    createBodies: [] as Array<Record<string, unknown>>,
    switchAgents: [] as Array<Record<string, unknown>>,
    interrupts: 0,
  };
  const ok = (stdout: string): Promise<import("../src/driver/api-client.js").ApiExecResult> =>
    Promise.resolve({ exitCode: 0, stdout, stderr: "", timedOut: false });
  const exec = (async (args: string[]) => {
    const op = args[2] ?? "";
    const dataIdx = args.indexOf("--data");
    if (op === "session.create") {
      state.createBodies.push(JSON.parse(args[dataIdx + 1] ?? "{}") as Record<string, unknown>);
      return ok(`{"data":{"id":"${sessionId}"}}`);
    }
    if (op === "session.prompt") {
      const body = JSON.parse(args[dataIdx + 1] ?? "{}") as { text?: string };
      state.prompts.push(body.text ?? "");
      return ok('{"data":{"id":"msg_0"}}');
    }
    if (op === "session.switchAgent") {
      state.switchAgents.push(JSON.parse(args[dataIdx + 1] ?? "{}") as Record<string, unknown>);
      return ok("");
    }
    if (op === "session.interrupt") {
      state.interrupts += 1;
      return ok('{"interrupted":true}');
    }
    if (op === "session.get") {
      return ok(`{"data":{"id":"${sessionId}","outcome":"${outcome}"}}`);
    }
    if (op === "session.permission.list") return ok('{"data":[]}');
    if (op === "session.message.list") {
      const data = messages.map((m, i) => ({
        id: `msg_${i + 1}`,
        type: "assistant",
        content: m.content ?? [],
        ...(m.tokens
          ? {
              tokens: {
                input: m.tokens.input,
                output: m.tokens.output,
                reasoning: m.tokens.reasoning,
                cache: { read: 0, write: 0 },
              },
            }
          : {}),
        time: { completed: i + 1 },
      }));
      return ok(JSON.stringify({ data }));
    }
    return ok("{}");
  }) as import("../src/driver/api-client.js").ApiExecFn;
  return { exec, state };
}

function clockSleep() {
  let clock = 0;
  const sleep = (ms: number) => {
    clock += ms;
    return Promise.resolve();
  };
  return { sleep, now: () => clock };
}

describe("runAttempt", () => {
  it("succeeds with one turn when no state checker", async () => {
    const root = tempRoot();
    try {
      const { exec } = apiScript();
      const result = await runAttempt({
        task: makeTask(),
        attempt: null,
        config: makeConfig(root),
        promptTemplate: "do {{ task.identifier }}",
        logger,
        apiExec: exec,
        sleep: () => Promise.resolve(),
      });
      expect(result.status).toBe("succeeded");
      expect(result.usage.total_tokens).toBe(15);
      expect(result.session_id).toBe("ses_test123");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("classifies turn timeout as timed_out via interrupt ladder", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.opencode.turn_timeout_ms = 1;
      const { exec, state } = apiScript({ outcome: null, tokens: null });
      const clock = clockSleep();
      const result = await runAttempt({
        task: makeTask(),
        attempt: null,
        config,
        promptTemplate: "do it",
        logger,
        apiExec: exec,
        sleep: clock.sleep,
        now: clock.now,
        interruptGraceMs: 5,
      });
      expect(result.status).toBe("timed_out");
      expect(result.error).toContain("turn_timeout");
      expect(state.interrupts).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("classifies failed outcome as failed", async () => {
    const root = tempRoot();
    try {
      const { exec } = apiScript({ outcome: "failed" });
      const result = await runAttempt({
        task: makeTask(),
        attempt: null,
        config: makeConfig(root),
        promptTemplate: "do it",
        logger,
        apiExec: exec,
        sleep: () => Promise.resolve(),
      });
      expect(result.status).toBe("failed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("aborts when before_run hook fails", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.hooks.before_run = "exit 1";
      const { exec } = apiScript();
      const result = await runAttempt({
        task: makeTask(),
        attempt: null,
        config,
        promptTemplate: "do it",
        logger,
        apiExec: exec,
        sleep: () => Promise.resolve(),
      });
      expect(result.status).toBe("failed");
      expect(result.error).toContain("before_run");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("caps at max_turns with continuation", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 2;
      const { exec, state } = apiScript();
      const result = await runAttempt({
        task: makeTask(),
        attempt: null,
        config,
        promptTemplate: "do it",
        logger,
        trackerStateChecker: async (t) => t,
        apiExec: exec,
        sleep: () => Promise.resolve(),
      });
      expect(result.status).toBe("succeeded");
      expect(state.prompts).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stops when state checker returns null", async () => {
    const root = tempRoot();
    try {
      let calls = 0;
      const { exec, state } = apiScript();
      const result = await runAttempt({
        task: makeTask(),
        attempt: null,
        config: makeConfig(root),
        promptTemplate: "do it",
        logger,
        trackerStateChecker: async () => {
          calls++;
          return calls <= 1 ? makeTask() : null;
        },
        apiExec: exec,
        sleep: () => Promise.resolve(),
      });
      expect(result.status).toBe("succeeded");
      expect(calls).toBe(2);
      expect(state.prompts).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accumulates usage from polled messages", async () => {
    const root = tempRoot();
    try {
      const { exec } = apiScript({
        sessionId: "ses_abc",
        tokens: { input: 100, output: 50, reasoning: 5 },
      });
      const result = await runAttempt({
        task: makeTask(),
        attempt: null,
        config: makeConfig(root),
        promptTemplate: "do it",
        logger,
        apiExec: exec,
        sleep: () => Promise.resolve(),
      });
      expect(result.usage.input_tokens).toBe(100);
      expect(result.usage.total_tokens).toBe(155);
      expect(result.session_id).toBe("ses_abc");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports zero usage when no token data", async () => {
    const root = tempRoot();
    try {
      const { exec } = apiScript({ tokens: null });
      const result = await runAttempt({
        task: makeTask(),
        attempt: null,
        config: makeConfig(root),
        promptTemplate: "do it",
        logger,
        apiExec: exec,
        sleep: () => Promise.resolve(),
      });
      expect(result.status).toBe("succeeded");
      expect(result.usage.total_tokens).toBe(0);
      expect(result.ended_at).toBeGreaterThanOrEqual(result.started_at);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("emits turn_started event for each turn", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 2;
      const events: string[] = [];
      const result = await runAttempt({
        task: makeTask(),
        attempt: null,
        config,
        promptTemplate: "do it",
        logger,
        trackerStateChecker: async (t) => t,
        events: {
          onEvent: (e) => {
            events.push(e.event);
          },
        },
        apiExec: apiScript().exec,
        sleep: () => Promise.resolve(),
      });
      expect(result.status).toBe("succeeded");
      expect(events).toContain("turn_started");
      expect(events).toContain("turn_completed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs after_run hook even when turn fails", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 1;
      const sentinel = join(root, "after_run_ran");
      config.hooks.after_run = `touch ${sentinel}`;
      const result = await runAttempt({
        task: makeTask(),
        attempt: null,
        config,
        promptTemplate: "do it",
        logger,
        apiExec: apiScript({ outcome: "failed" }).exec,
        sleep: () => Promise.resolve(),
      });
      expect(result.status).toBe("failed");
      expect(existsSync(sentinel)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses continuation guidance when startTurn > 1", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 1;
      const { exec, state } = apiScript();
      const result = await runAttempt({
        task: makeTask({ identifier: "HEIH-7" }),
        attempt: 1,
        config,
        promptTemplate: "original task prompt {{ task.identifier }}",
        logger,
        startTurn: 3,
        apiExec: exec,
        sleep: () => Promise.resolve(),
      });
      expect(result.status).toBe("succeeded");
      expect(state.prompts).toHaveLength(1);
      expect(state.prompts[0]).toContain("Continue working on HEIH-7");
      expect(state.prompts[0]).toContain("turn 3");
      expect(state.prompts[0]).not.toContain("original task prompt");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes turn_count to sidecar after each turn", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 2;
      const result = await runAttempt({
        task: makeTask(),
        attempt: null,
        config,
        promptTemplate: "do it",
        logger,
        startTurn: 2,
        trackerStateChecker: async (t) => t,
        apiExec: apiScript({ sessionId: "ses_turntest" }).exec,
        sleep: () => Promise.resolve(),
      });
      expect(result.status).toBe("succeeded");
      const wsPath = resolveWorkspacePath("ABC-123", root);
      const sidecar = readSessionSidecar(wsPath);
      expect(sidecar?.sessionId).toBe("ses_turntest");
      expect(sidecar?.turnCount).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists cumulative tokens (base + usage) into sidecar", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 2;
      const result = await runAttempt({
        task: makeTask(),
        attempt: null,
        config,
        promptTemplate: "do it",
        logger,
        baseTokens: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
        trackerStateChecker: async (t) => t,
        apiExec: apiScript({ sessionId: "ses_toktest" }).exec,
        sleep: () => Promise.resolve(),
      });
      expect(result.status).toBe("succeeded");
      expect(result.usage).toEqual({ input_tokens: 20, output_tokens: 10, total_tokens: 30 });
      const wsPath = resolveWorkspacePath("ABC-123", root);
      const sidecar = readSessionSidecar(wsPath);
      expect(sidecar?.inputTokens).toBe(120);
      expect(sidecar?.outputTokens).toBe(60);
      expect(sidecar?.totalTokens).toBe(180);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists single-turn tokens into sidecar (not one turn behind)", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 1;
      await runAttempt({
        task: makeTask(),
        attempt: null,
        config,
        promptTemplate: "do it",
        logger,
        baseTokens: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
        apiExec: apiScript({ sessionId: "ses_oneshot" }).exec,
        sleep: () => Promise.resolve(),
      });
      const wsPath = resolveWorkspacePath("ABC-123", root);
      const sidecar = readSessionSidecar(wsPath);
      expect(sidecar?.inputTokens).toBe(110);
      expect(sidecar?.outputTokens).toBe(55);
      expect(sidecar?.totalTokens).toBe(165);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("agent resolution per turn", () => {
  it("uses the task's agent label on turn 1 (session.create body)", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.opencode.agents = ["Build", "Review"];
      const { exec, state } = apiScript();
      const result = await runAttempt({
        task: makeTask({ labels: ["agent:review"] }),
        attempt: null,
        config,
        promptTemplate: "do it",
        logger,
        apiExec: exec,
        sleep: () => Promise.resolve(),
      });
      expect(result.status).toBe("succeeded");
      expect(state.createBodies[0]?.agent).toBe("Review");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("re-resolves the agent each turn so a mid-run label switch applies next turn", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.opencode.agents = ["Build", "Review"];
      config.agent.max_turns = 2;
      let check = 0;
      const { exec, state } = apiScript();
      const result = await runAttempt({
        task: makeTask({ labels: ["agent:review"] }),
        attempt: null,
        config,
        promptTemplate: "do it",
        logger,
        trackerStateChecker: async () => {
          check++;
          return check === 1 ? makeTask({ labels: ["agent:build"] }) : null;
        },
        apiExec: exec,
        sleep: () => Promise.resolve(),
      });
      expect(result.status).toBe("succeeded");
      expect(state.createBodies[0]?.agent).toBe("Review");
      expect(state.switchAgents).toEqual([{ agent: "Build" }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses the default agent when there is no agent label", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 2;
      const { exec, state } = apiScript();
      const result = await runAttempt({
        task: makeTask({ labels: ["bug"] }),
        attempt: null,
        config,
        promptTemplate: "do it",
        logger,
        trackerStateChecker: async (t) => t,
        apiExec: exec,
        sleep: () => Promise.resolve(),
      });
      expect(result.status).toBe("succeeded");
      expect(state.createBodies[0]?.agent).toBe("build");
      expect(state.switchAgents).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("inactivity timeout", () => {
  it("does not start inactivity timer when inactivity_timeout_ms = 0", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.opencode.inactivity_timeout_ms = 0;
      config.opencode.turn_timeout_ms = 0;
      config.agent.max_turns = 1;
      const { exec } = apiScript();
      const result = await runAttempt({
        task: makeTask(),
        attempt: null,
        config,
        promptTemplate: "do it",
        logger,
        apiExec: exec,
        sleep: () => Promise.resolve(),
      });
      expect(result.status).toBe("succeeded");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("classifies inactivity timeout as inactivity_timeout", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.opencode.inactivity_timeout_ms = 1;
      const { exec } = apiScript({ outcome: null, tokens: null });
      const clock = clockSleep();
      const result = await runAttempt({
        task: makeTask(),
        attempt: null,
        config,
        promptTemplate: "do it",
        logger,
        apiExec: exec,
        sleep: clock.sleep,
        now: clock.now,
        interruptGraceMs: 5,
      });
      expect(result.status).toBe("timed_out");
      expect(result.error).toContain("inactivity_timeout");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
describe("runAttempt activity capture", () => {
  it("wires onActivity with turn and turn_started agent/model/variant", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.opencode.model = "anthropic/claude-sonnet-4-5";
      config.opencode.variant = "high";
      config.agent.max_turns = 1;
      const { exec } = apiScript({
        tokens: null,
        messages: [
          {
            content: [
              { type: "text", text: "working" },
              { type: "tool", tool: "read" },
            ],
            tokens: null,
          },
        ],
      });
      const activity: ActivityEvent[] = [];
      const workerEvents: WorkerEvent[] = [];
      const result = await runAttempt({
        task: makeTask(),
        attempt: null,
        config,
        promptTemplate: "do it",
        logger,
        events: { onEvent: (e) => workerEvents.push(e) },
        onActivity: (e) => activity.push(e),
        apiExec: exec,
        sleep: () => Promise.resolve(),
      });
      expect(result.status).toBe("succeeded");
      expect(activity.map((a) => a.type)).toEqual(["text", "tool_use"]);
      expect(activity[0]?.turn).toBe(1);
      expect(activity[0]?.text).toBe("working");
      expect(activity[1]?.tool).toBe("read");
      const started = workerEvents.find((e) => e.event === "turn_started");
      expect(started?.agent).toBe("build");
      expect(started?.model).toBe("anthropic/claude-sonnet-4-5");
      expect(started?.variant).toBe("high");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes tool execution detail through to activity events", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 1;
      const { exec } = apiScript({
        messages: [
          {
            content: [
              {
                type: "tool",
                tool: "bash",
                state: {
                  status: "completed",
                  input: { command: "false" },
                  output: "",
                  metadata: { exit: 1, truncated: false },
                  time: { created: 1000, ran: 1050, completed: 1300 },
                },
              },
            ],
            tokens: null,
          },
        ],
      });
      const activity: ActivityEvent[] = [];
      const result = await runAttempt({
        task: makeTask(),
        attempt: null,
        config,
        promptTemplate: "do it",
        logger,
        onActivity: (e) => activity.push(e),
        apiExec: exec,
        sleep: () => Promise.resolve(),
      });
      expect(result.status).toBe("succeeded");
      const tool = activity.find((a) => a.type === "tool_use");
      expect(tool?.tool).toBe("bash");
      expect(tool?.input).toEqual({ command: "false" });
      expect(tool?.output).toBe("");
      expect(tool?.exit).toBe(1);
      expect(tool?.status).toBe("completed");
      expect(tool?.durationMs).toBe(300);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports null model when unset but still carries agent/variant", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.opencode.variant = "low";
      config.agent.max_turns = 1;
      const workerEvents: WorkerEvent[] = [];
      await runAttempt({
        task: makeTask(),
        attempt: null,
        config,
        promptTemplate: "do it",
        logger,
        events: { onEvent: (e) => workerEvents.push(e) },
        apiExec: apiScript().exec,
        sleep: () => Promise.resolve(),
      });
      const started = workerEvents.find((e) => e.event === "turn_started");
      expect(started?.model).toBeNull();
      expect(started?.variant).toBe("low");
      expect(started?.agent).toBe("build");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("step_usage events", () => {
  it("emits step_usage for each token-bearing message and turn_completed carries no usage", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 1;
      const { exec } = apiScript({
        messages: [
          { content: [], tokens: { input: 100, output: 50, reasoning: 0 } },
          { content: [], tokens: { input: 10, output: 5, reasoning: 0 } },
        ],
      });
      const workerEvents: WorkerEvent[] = [];
      await runAttempt({
        task: makeTask(),
        attempt: null,
        config,
        promptTemplate: "do it",
        logger,
        events: { onEvent: (e) => workerEvents.push(e) },
        apiExec: exec,
        sleep: () => Promise.resolve(),
      });
      const stepUsages = workerEvents.filter((e) => e.event === "step_usage");
      expect(stepUsages).toHaveLength(2);
      expect(stepUsages[0]?.usage).toEqual({
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
      });
      expect(stepUsages[1]?.usage).toEqual({
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      });
      const completed = workerEvents.find((e) => e.event === "turn_completed");
      expect(completed?.usage).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
