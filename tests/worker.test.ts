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
import {
  type OpencodeEvent,
  type SubprocessResult,
  type WorkerEvent,
  buildOpencodeCommand,
  extractSessionAndUsage,
  parseOpencodeLine,
  runAttempt,
  runDefaultSubprocess,
} from "../src/worker/runner.js";
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

function successResult(
  tokens = { input: 10, output: 5, total: 15 },
  sessionId = "ses_test123",
): SubprocessResult {
  const events = [
    JSON.stringify({ type: "step_start", sessionID: sessionId }),
    JSON.stringify({
      type: "step_finish",
      sessionID: sessionId,
      part: { tokens, reason: "stop" },
    }),
  ].join("\n");
  return {
    exitCode: 0,
    stdout: events,
    stderr: "",
    timedOut: false,
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

describe("buildOpencodeCommand", () => {
  it("builds command with --format json, --dir and --agent", () => {
    const oc: OpencodeConfig = {
      command: "opencode run",
      agent: "build",
      agents: [],
      model: null,
      variant: null,
      turn_timeout_ms: 60000,
      stall_timeout_ms: 300000,
      inactivity_timeout_ms: 600000,
      auto_approve: false,
      poll_interval_ms: 1,
      permission_timeout_ms: 1,
      server_url: null,
    };
    const cmd = buildOpencodeCommand(oc, "/ws/ABC-123", "do the work");
    expect(cmd).toEqual([
      "opencode",
      "run",
      "--format",
      "json",
      "--dir",
      "/ws/ABC-123",
      "--agent",
      "build",
      "do the work",
    ]);
  });

  it("uses custom command prefix", () => {
    const oc: OpencodeConfig = {
      command: "opencode run --foo",
      agent: "build",
      agents: [],
      model: null,
      variant: null,
      turn_timeout_ms: 60000,
      stall_timeout_ms: 300000,
      inactivity_timeout_ms: 600000,
      auto_approve: false,
      poll_interval_ms: 1,
      permission_timeout_ms: 1,
      server_url: null,
    };
    const cmd = buildOpencodeCommand(oc, "/ws", "prompt");
    expect(cmd.slice(0, 4)).toEqual(["opencode", "run", "--foo", "--format"]);
  });

  it("includes -s when sessionId provided", () => {
    const oc: OpencodeConfig = {
      command: "opencode run",
      agent: "build",
      agents: [],
      model: null,
      variant: null,
      turn_timeout_ms: 60000,
      stall_timeout_ms: 300000,
      inactivity_timeout_ms: 600000,
      auto_approve: false,
      poll_interval_ms: 1,
      permission_timeout_ms: 1,
      server_url: null,
    };
    const cmd = buildOpencodeCommand(oc, "/ws", "prompt", "ses_abc");
    expect(cmd).toContain("-s");
    expect(cmd).toContain("ses_abc");
    expect(cmd).toContain("--format");
    expect(cmd).toContain("json");
  });

  it("omits -s when sessionId is null", () => {
    const oc: OpencodeConfig = {
      command: "opencode run",
      agent: "build",
      agents: [],
      model: null,
      variant: null,
      turn_timeout_ms: 60000,
      stall_timeout_ms: 300000,
      inactivity_timeout_ms: 600000,
      auto_approve: false,
      poll_interval_ms: 1,
      permission_timeout_ms: 1,
      server_url: null,
    };
    const cmd = buildOpencodeCommand(oc, "/ws", "prompt", null);
    expect(cmd).not.toContain("-s");
    expect(cmd).toContain("--format");
    expect(cmd).toContain("json");
  });

  it("includes --auto when auto_approve is true", () => {
    const oc: OpencodeConfig = {
      command: "opencode run",
      agent: "build",
      agents: [],
      model: null,
      variant: null,
      turn_timeout_ms: 60000,
      stall_timeout_ms: 300000,
      inactivity_timeout_ms: 600000,
      auto_approve: true,
      poll_interval_ms: 1,
      permission_timeout_ms: 1,
      server_url: null,
    };
    const cmd = buildOpencodeCommand(oc, "/ws", "prompt");
    expect(cmd).toContain("--auto");
  });

  it("omits --auto when auto_approve is false", () => {
    const oc: OpencodeConfig = {
      command: "opencode run",
      agent: "build",
      agents: [],
      model: null,
      variant: null,
      turn_timeout_ms: 60000,
      stall_timeout_ms: 300000,
      inactivity_timeout_ms: 600000,
      auto_approve: false,
      poll_interval_ms: 1,
      permission_timeout_ms: 1,
      server_url: null,
    };
    const cmd = buildOpencodeCommand(oc, "/ws", "prompt");
    expect(cmd).not.toContain("--auto");
  });

  it("omits --model and --variant when both are null", () => {
    const oc: OpencodeConfig = {
      command: "opencode run",
      agent: "build",
      agents: [],
      model: null,
      variant: null,
      turn_timeout_ms: 60000,
      stall_timeout_ms: 300000,
      inactivity_timeout_ms: 600000,
      auto_approve: false,
      poll_interval_ms: 1,
      permission_timeout_ms: 1,
      server_url: null,
    };
    const cmd = buildOpencodeCommand(oc, "/ws/ABC-123", "do the work");
    expect(cmd).not.toContain("--model");
    expect(cmd).not.toContain("--variant");
  });

  it("appends --model only when model is set", () => {
    const oc: OpencodeConfig = {
      command: "opencode run",
      agent: "build",
      agents: [],
      model: "anthropic/claude-sonnet-4-5",
      variant: null,
      turn_timeout_ms: 60000,
      stall_timeout_ms: 300000,
      inactivity_timeout_ms: 600000,
      auto_approve: false,
      poll_interval_ms: 1,
      permission_timeout_ms: 1,
      server_url: null,
    };
    const cmd = buildOpencodeCommand(oc, "/ws/ABC-123", "do the work");
    expect(cmd).toEqual([
      "opencode",
      "run",
      "--format",
      "json",
      "--dir",
      "/ws/ABC-123",
      "--agent",
      "build",
      "--model",
      "anthropic/claude-sonnet-4-5",
      "do the work",
    ]);
    expect(cmd).not.toContain("--variant");
  });

  it("appends --variant only when variant is set", () => {
    const oc: OpencodeConfig = {
      command: "opencode run",
      agent: "build",
      agents: [],
      model: null,
      variant: "high",
      turn_timeout_ms: 60000,
      stall_timeout_ms: 300000,
      inactivity_timeout_ms: 600000,
      auto_approve: false,
      poll_interval_ms: 1,
      permission_timeout_ms: 1,
      server_url: null,
    };
    const cmd = buildOpencodeCommand(oc, "/ws/ABC-123", "do the work");
    expect(cmd).toEqual([
      "opencode",
      "run",
      "--format",
      "json",
      "--dir",
      "/ws/ABC-123",
      "--agent",
      "build",
      "--variant",
      "high",
      "do the work",
    ]);
    expect(cmd).not.toContain("--model");
  });

  it("appends both --model and --variant after --agent, before prompt", () => {
    const oc: OpencodeConfig = {
      command: "opencode run",
      agent: "build",
      agents: [],
      model: "anthropic/claude-sonnet-4-5",
      variant: "high",
      turn_timeout_ms: 60000,
      stall_timeout_ms: 300000,
      inactivity_timeout_ms: 600000,
      auto_approve: false,
      poll_interval_ms: 1,
      permission_timeout_ms: 1,
      server_url: null,
    };
    const cmd = buildOpencodeCommand(oc, "/ws/ABC-123", "do the work");
    expect(cmd).toEqual([
      "opencode",
      "run",
      "--format",
      "json",
      "--dir",
      "/ws/ABC-123",
      "--agent",
      "build",
      "--model",
      "anthropic/claude-sonnet-4-5",
      "--variant",
      "high",
      "do the work",
    ]);
  });
});

describe("extractSessionAndUsage", () => {
  it("sums all step_finish tokens", () => {
    const stdout = [
      JSON.stringify({ type: "step_start", sessionID: "ses_x" }),
      JSON.stringify({
        type: "step_finish",
        sessionID: "ses_x",
        part: { tokens: { input: 100, output: 10, total: 110 } },
      }),
      JSON.stringify({ type: "step_start", sessionID: "ses_x" }),
      JSON.stringify({
        type: "step_finish",
        sessionID: "ses_x",
        part: { tokens: { input: 150, output: 15, total: 165 } },
      }),
    ].join("\n");
    const { session_id, usage } = extractSessionAndUsage(stdout);
    expect(session_id).toBe("ses_x");
    expect(usage.input_tokens).toBe(250);
    expect(usage.output_tokens).toBe(25);
    expect(usage.total_tokens).toBe(275);
  });

  it("sums all step_finish values across multiple steps", () => {
    const stdout = [
      JSON.stringify({ type: "step_start", sessionID: "ses_cum" }),
      JSON.stringify({
        type: "step_finish",
        sessionID: "ses_cum",
        part: { tokens: { input: 100, output: 10, total: 110 } },
      }),
      JSON.stringify({ type: "step_start", sessionID: "ses_cum" }),
      JSON.stringify({
        type: "step_finish",
        sessionID: "ses_cum",
        part: { tokens: { input: 150, output: 15, total: 165 } },
      }),
      JSON.stringify({ type: "step_start", sessionID: "ses_cum" }),
      JSON.stringify({
        type: "step_finish",
        sessionID: "ses_cum",
        part: { tokens: { input: 200, output: 20, total: 220 } },
      }),
    ].join("\n");
    const { session_id, usage } = extractSessionAndUsage(stdout);
    expect(session_id).toBe("ses_cum");
    expect(usage.input_tokens).toBe(450);
    expect(usage.output_tokens).toBe(45);
    expect(usage.total_tokens).toBe(495);
  });

  it("returns single step_finish tokens directly", () => {
    const stdout = JSON.stringify({
      type: "step_finish",
      sessionID: "ses_single",
      part: { tokens: { input: 42, output: 7, total: 49 } },
    });
    const { session_id, usage } = extractSessionAndUsage(stdout);
    expect(session_id).toBe("ses_single");
    expect(usage.input_tokens).toBe(42);
    expect(usage.output_tokens).toBe(7);
    expect(usage.total_tokens).toBe(49);
  });

  it("extracts session_id from first event that has it", () => {
    const stdout = JSON.stringify({ type: "text", sessionID: "ses_abc", part: { text: "hello" } });
    const { session_id } = extractSessionAndUsage(stdout);
    expect(session_id).toBe("ses_abc");
  });

  it("returns null session_id and zero usage for non-JSON output", () => {
    const { session_id, usage } = extractSessionAndUsage("no json here\njust text");
    expect(session_id).toBeNull();
    expect(usage.total_tokens).toBe(0);
  });

  it("handles mixed event types", () => {
    const stdout = [
      "not json",
      JSON.stringify({ type: "step_start", sessionID: "ses_mixed" }),
      JSON.stringify({ type: "tool_use", sessionID: "ses_mixed", part: { tool: "read" } }),
      JSON.stringify({ type: "text", sessionID: "ses_mixed", part: { text: "done" } }),
      JSON.stringify({
        type: "step_finish",
        sessionID: "ses_mixed",
        part: { tokens: { input: 200, output: 20, total: 220 } },
      }),
    ].join("\n");
    const { session_id, usage } = extractSessionAndUsage(stdout);
    expect(session_id).toBe("ses_mixed");
    expect(usage.total_tokens).toBe(220);
  });
});

describe("runAttempt", () => {
  it("merges config.env into subprocess environment via default runner", async () => {
    const result = await runDefaultSubprocess(
      ["node", "-e", "process.env.TEST_INJECTED_VAR ? process.exit(0) : process.exit(1)"],
      "/tmp",
      5000,
      0,
      undefined,
      { TEST_INJECTED_VAR: "injected-value" },
    );
    expect(result.exitCode).toBe(0);
  });

  it("escalates to group SIGKILL after grace when child ignores SIGTERM", async () => {
    const start = Date.now();
    const result = await runDefaultSubprocess(
      ["node", "-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
      "/tmp",
      200,
      0,
      undefined,
      undefined,
      undefined,
      150,
    );
    expect(result.timedOut).toBe(true);
    expect(result.timedOutReason).toBe("wall_clock");
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it("group-kills grandchild processes on escalation", async () => {
    const marker = join(tmpdir(), `tasking-gk-${process.pid}-${Date.now()}`);
    const script = `
      const { spawn } = require('child_process');
      const fs = require('fs');
      const g = spawn(process.execPath, ['-e', ${JSON.stringify(
        `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); fs.writeFileSync(${JSON.stringify(marker)}, String(process.pid));`,
      )}]);
      g.unref();
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
    `;
    const result = await runDefaultSubprocess(
      ["node", "-e", script],
      "/tmp",
      200,
      0,
      undefined,
      undefined,
      undefined,
      150,
    );
    expect(result.timedOut).toBe(true);
    const grandchildPid = Number(readFileSync(marker, "utf8"));
    rmSync(marker, { force: true });
    await new Promise((r) => setTimeout(r, 100));
    expect(() => process.kill(grandchildPid, 0)).toThrow();
  });

  it("does not escalate when child exits gracefully within grace", async () => {
    const result = await runDefaultSubprocess(
      [
        "node",
        "-e",
        "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 30)); setInterval(() => {}, 1000);",
      ],
      "/tmp",
      200,
      0,
      undefined,
      undefined,
      undefined,
      5000,
    );
    expect(result.timedOut).toBe(true);
    expect(result.timedOutReason).toBe("wall_clock");
    expect(result.exitCode).toBe(0);
  });

  it("abort signal group-kills the whole process tree immediately", async () => {
    const marker = join(tmpdir(), `tasking-abort-${process.pid}-${Date.now()}`);
    const script = `
      const { spawn } = require('child_process');
      const fs = require('fs');
      const g = spawn(process.execPath, ['-e', ${JSON.stringify(
        `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); fs.writeFileSync(${JSON.stringify(marker)}, String(process.pid));`,
      )}]);
      g.unref();
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
    `;
    const ctl = new AbortController();
    const pending = runDefaultSubprocess(
      ["node", "-e", script],
      "/tmp",
      60000,
      0,
      ctl.signal,
      undefined,
      undefined,
      10000,
    );
    const deadline = Date.now() + 5000;
    while (!existsSync(marker) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const grandchildPid = Number(readFileSync(marker, "utf8"));
    rmSync(marker, { force: true });
    ctl.abort();
    const result = await pending;
    expect(result.exitCode).toBe(-1);
    await new Promise((r) => setTimeout(r, 100));
    expect(() => process.kill(grandchildPid, 0)).toThrow();
  });

  it("accumulates sessionAndUsage in one pass and caps retained stdout", async () => {
    const lines = [
      JSON.stringify({ type: "step_start", sessionID: "ses_onepass" }),
      JSON.stringify({
        type: "step_finish",
        sessionID: "ses_onepass",
        part: { tokens: { input: 100, output: 10, total: 110 } },
      }),
      JSON.stringify({
        type: "step_finish",
        sessionID: "ses_onepass",
        part: { tokens: { input: 50, output: 5, total: 55 } },
      }),
    ].join("\n");
    const filler = "x".repeat(70000);
    const full = `${filler}\n${lines}\n`;
    const result = await runDefaultSubprocess(
      ["node", "-e", `process.stdout.write(${JSON.stringify(full)})`],
      "/tmp",
      5000,
      0,
    );
    expect(result.sessionAndUsage?.session_id).toBe("ses_onepass");
    expect(result.sessionAndUsage?.usage).toEqual({
      input_tokens: 150,
      output_tokens: 15,
      total_tokens: 165,
    });
    expect(extractSessionAndUsage(full).usage).toEqual(result.sessionAndUsage?.usage);
    expect(result.stdout.length).toBeLessThanOrEqual(65536);
  });

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
describe("parseOpencodeLine", () => {
  it("parses text event", () => {
    const e = parseOpencodeLine(
      JSON.stringify({ type: "text", sessionID: "ses_x", part: { text: "hello" } }),
    );
    expect(e).not.toBeNull();
    expect(e?.type).toBe("text");
    expect(e?.text).toBe("hello");
    expect(e?.sessionId).toBe("ses_x");
  });

  it("parses tool_use event", () => {
    const e = parseOpencodeLine(
      JSON.stringify({ type: "tool_use", sessionID: "ses_x", part: { tool: "read" } }),
    );
    expect(e?.type).toBe("tool_use");
    expect(e?.tool).toBe("read");
  });

  it("captures tool_use execution detail from part.state", () => {
    const e = parseOpencodeLine(
      JSON.stringify({
        type: "tool_use",
        sessionID: "ses_x",
        part: {
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "echo hi" },
            output: "hi\n",
            metadata: { exit: 0, truncated: false },
            title: "echo hi",
            time: { start: 1000, end: 1500 },
          },
        },
      }),
    );
    expect(e?.type).toBe("tool_use");
    expect(e?.tool).toBe("bash");
    expect(e?.input).toEqual({ command: "echo hi" });
    expect(e?.output).toBe("hi\n");
    expect(e?.exit).toBe(0);
    expect(e?.title).toBe("echo hi");
    expect(e?.status).toBe("completed");
    expect(e?.durationMs).toBe(500);
    expect(e?.truncated).toBe(false);
  });

  it("captures non-zero exit code from state.metadata", () => {
    const e = parseOpencodeLine(
      JSON.stringify({
        type: "tool_use",
        sessionID: "ses_x",
        part: {
          tool: "bash",
          state: { status: "completed", metadata: { exit: 127, truncated: false } },
        },
      }),
    );
    expect(e?.exit).toBe(127);
  });

  it("tolerates partial state on tool_use without throwing", () => {
    const e = parseOpencodeLine(
      JSON.stringify({
        type: "tool_use",
        sessionID: "ses_x",
        part: { tool: "bash", state: { status: "pending" } },
      }),
    );
    expect(e?.type).toBe("tool_use");
    expect(e?.tool).toBe("bash");
    expect(e?.status).toBe("pending");
    expect(e?.title).toBeUndefined();
    expect(e?.durationMs).toBeUndefined();
  });

  it("treats non-tool events without tool detail as before", () => {
    const e = parseOpencodeLine(
      JSON.stringify({
        type: "tool_use",
        sessionID: "ses_x",
        part: { tool: "read" },
      }),
    );
    expect(e?.tool).toBe("read");
    expect(e?.input).toBeUndefined();
    expect(e?.output).toBeUndefined();
    expect(e?.exit).toBeUndefined();
  });

  it("parses step_finish tokens", () => {
    const e = parseOpencodeLine(
      JSON.stringify({
        type: "step_finish",
        sessionID: "ses_x",
        part: { tokens: { input: 100, output: 10, total: 110 } },
      }),
    );
    expect(e?.type).toBe("step_finish");
    expect(e?.tokens).toEqual({ input: 100, output: 10, total: 110 });
  });

  it("parses step_start", () => {
    const e = parseOpencodeLine(JSON.stringify({ type: "step_start", sessionID: "ses_x" }));
    expect(e?.type).toBe("step_start");
    expect(e?.sessionId).toBe("ses_x");
  });

  it("returns null for non-JSON line", () => {
    expect(parseOpencodeLine("not json here")).toBeNull();
    expect(parseOpencodeLine("")).toBeNull();
  });

  it("keeps unknown type without throwing", () => {
    const e = parseOpencodeLine(
      JSON.stringify({ type: "some_new_type", sessionID: "ses_x", part: { foo: "bar" } }),
    );
    expect(e?.type).toBe("some_new_type");
    expect(e?.sessionId).toBe("ses_x");
  });

  it("returns null for JSON without type", () => {
    expect(parseOpencodeLine(JSON.stringify({ sessionID: "ses_x" }))).toBeNull();
  });
});

describe("runDefaultSubprocess onOpencodeEvent", () => {
  it("streams parsed events in order, skipping non-JSON, joining split lines", async () => {
    const script = `
      const w = (s) => process.stdout.write(s);
      w(JSON.stringify({ type: "step_start", sessionID: "ses_x" }) + "\\n");
      w('{"type":"text","sessionID":"ses_x","part":{"text":"hel');
      setTimeout(() => {
        w('lo"}}\\n');
        w('not json\\n');
        w(JSON.stringify({ type: "tool_use", sessionID: "ses_x", part: { tool: "read" } }) + "\\n");
        w(JSON.stringify({ type: "step_finish", sessionID: "ses_x", part: { tokens: { input: 1, output: 2, total: 3 } } }) + "\\n");
        process.exit(0);
      }, 20);
    `;
    const events: OpencodeEvent[] = [];
    const result = await runDefaultSubprocess(
      ["node", "-e", script],
      "/tmp",
      5000,
      0,
      undefined,
      undefined,
      (e) => events.push(e),
    );
    expect(events.map((e) => e.type)).toEqual(["step_start", "text", "tool_use", "step_finish"]);
    expect(events[1]?.text).toBe("hello");
    expect(events[2]?.tool).toBe("read");
    expect(events[3]?.tokens).toEqual({ input: 1, output: 2, total: 3 });
    const extracted = extractSessionAndUsage(result.stdout);
    expect(extracted.session_id).toBe("ses_x");
    expect(extracted.usage.total_tokens).toBe(3);
  });

  it("works without onOpencodeEvent (backward compatible)", async () => {
    const result = await runDefaultSubprocess(
      [
        "node",
        "-e",
        'process.stdout.write(JSON.stringify({type:"text",sessionID:"ses_x",part:{text:"hi"}})+"\\n");process.exit(0)',
      ],
      "/tmp",
      5000,
      0,
    );
    expect(result.exitCode).toBe(0);
    expect(extractSessionAndUsage(result.stdout).session_id).toBe("ses_x");
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
