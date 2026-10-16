import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ActivityStore } from "../src/observability/activity-store.js";
import { HttpDashboard } from "../src/observability/http-dashboard.js";
import { LogRingBuffer } from "../src/observability/log-buffer.js";
import { ConsoleLogger } from "../src/observability/logger.js";
import { buildSnapshot } from "../src/observability/snapshot.js";
import { createInitialState } from "../src/shared/types.js";
import type { RunningEntry, RuntimeDirectSession } from "../src/shared/types.js";

function makeRunningEntry(id: string, identifier: string): RunningEntry {
  return {
    task: {
      id,
      identifier,
      title: "t",
      description: null,
      priority: 1,
      state: "In Progress",
      branch_name: null,
      url: null,
      labels: [],
      blocked_by: [],
      assignee: null,
      created_at: null,
      updated_at: null,
      source: "jira",
    },
    task_identifier: identifier,
    workspace_path: `/tmp/${identifier}`,
    session_id: "s1",
    last_event: "turn_completed",
    last_message: "working",
    last_event_at: Date.now(),
    started_at: Date.now() - 5000,
    turn_count: 1,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    last_reported_input_tokens: 0,
    last_reported_output_tokens: 0,
    last_reported_total_tokens: 0,
    retry_attempt: null,
    abort: null,
    agent: "build",
    model: "anthropic/claude-sonnet-4-5",
    variant: null,
  };
}

describe("ConsoleLogger", () => {
  it("includes task context fields", () => {
    const lines: string[] = [];
    const logger = new ConsoleLogger({}, (line) => lines.push(line));
    logger.info("test", { task_id: "1", task_identifier: "ABC-1" });
    const entry = JSON.parse(lines[0] ?? "{}");
    expect(entry.task_id).toBe("1");
    expect(entry.task_identifier).toBe("ABC-1");
    expect(entry.level).toBe("info");
  });

  it("child logger inherits and adds fields", () => {
    const lines: string[] = [];
    const logger = new ConsoleLogger({ session_id: "s1" }, (line) => lines.push(line));
    const child = logger.child({ task_identifier: "T-1" });
    child.error("failed");
    const entry = JSON.parse(lines[0] ?? "{}");
    expect(entry.session_id).toBe("s1");
    expect(entry.task_identifier).toBe("T-1");
    expect(entry.level).toBe("error");
  });
});

describe("buildSnapshot", () => {
  it("reflects running and retrying with token totals", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", {
      task: {
        id: "1",
        identifier: "ABC-1",
        title: "t",
        description: null,
        priority: 1,
        state: "In Progress",
        branch_name: null,
        url: null,
        labels: [],
        blocked_by: [],
        assignee: null,
        created_at: null,
        updated_at: null,
        source: "jira",
      },
      task_identifier: "ABC-1",
      workspace_path: "/tmp/ABC-1",
      session_id: "s1",
      last_event: "turn_completed",
      last_message: "working",
      last_event_at: Date.now(),
      started_at: Date.now() - 5000,
      turn_count: 3,
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      last_reported_input_tokens: 0,
      last_reported_output_tokens: 0,
      last_reported_total_tokens: 0,
      retry_attempt: null,
      abort: null,
      agent: "build",
      model: "anthropic/claude-sonnet-4-5",
      variant: null,
    });
    state.retry_attempts.set("2", {
      task_id: "2",
      identifier: "ABC-2",
      attempt: 3,
      due_at_ms: Date.now() + 10000,
      timer: null,
      error: "no slots",
      continuation: false,
      session_id: null,
    });
    state.totals.input_tokens = 500;
    state.totals.output_tokens = 250;
    state.totals.total_tokens = 750;
    state.totals.seconds_running = 100;

    const snap = buildSnapshot(state);
    expect(snap.counts.running).toBe(1);
    expect(snap.counts.retrying).toBe(1);
    expect(snap.running[0]?.turn_count).toBe(3);
    expect(snap.running[0]?.tokens.total_tokens).toBe(150);
    expect(snap.running[0]?.agent).toBe("build");
    expect(snap.running[0]?.model).toBe("anthropic/claude-sonnet-4-5");
    expect(snap.running[0]?.variant).toBeNull();
    expect(snap.retrying[0]?.error).toBe("no slots");
    expect(snap.totals.total_tokens).toBe(750);
    expect(snap.totals.seconds_running).toBeGreaterThan(100);
  });

  it("surfaces empty state", () => {
    const state = createInitialState(30000, 10);
    const snap = buildSnapshot(state);
    expect(snap.counts.running).toBe(0);
    expect(snap.counts.retrying).toBe(0);
  });
});

describe("HttpDashboard", () => {
  const logger = new ConsoleLogger({}, () => {});

  it("serves /api/v1/logs from logBuffer, respecting ?lines", async () => {
    const state = createInitialState(30000, 10);
    const logBuffer = new LogRingBuffer(10);
    logBuffer.push(JSON.stringify({ ts: "2026-01-01T00:00:00.000Z", level: "info", msg: "first" }));
    logBuffer.push(
      JSON.stringify({ ts: "2026-01-01T00:00:01.000Z", level: "warn", msg: "second" }),
    );
    logBuffer.push(JSON.stringify({ ts: "2026-01-01T00:00:02.000Z", level: "info", msg: "third" }));
    const dashboard = new HttpDashboard({
      port: 0,
      host: "127.0.0.1",
      state: () => state,
      logger,
      logBuffer,
    });
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/logs?lines=2`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        logs: Array<{ ts: string; level: string; msg: string }>;
      };
      expect(body.logs).toHaveLength(2);
      expect(body.logs[0]?.msg).toBe("second");
      expect(body.logs[1]?.msg).toBe("third");
    } finally {
      await dashboard.stop();
    }
  });

  it("returns 404 for /api/v1/logs when no logBuffer configured", async () => {
    const state = createInitialState(30000, 10);
    const dashboard = new HttpDashboard({ port: 0, host: "127.0.0.1", state: () => state, logger });
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/logs`);
      expect(res.status).toBe(404);
    } finally {
      await dashboard.stop();
    }
  });

  it("serves /api/v1/state", async () => {
    const state = createInitialState(30000, 10);
    const dashboard = new HttpDashboard({ port: 0, host: "127.0.0.1", state: () => state, logger });
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/state`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        counts: { running: number };
        codex_totals: { total_tokens: number };
      };
      expect(body.counts.running).toBe(0);
      expect(body.codex_totals).toBeDefined();
    } finally {
      await dashboard.stop();
    }
  });

  it("serves /api/v1/state with query string", async () => {
    const state = createInitialState(30000, 10);
    const dashboard = new HttpDashboard({ port: 0, host: "127.0.0.1", state: () => state, logger });
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/state?x=1`);
      expect(res.status).toBe(200);
    } finally {
      await dashboard.stop();
    }
  });

  it("serves dashboard html at /", async () => {
    const state = createInitialState(30000, 10);
    const dashboard = new HttpDashboard({ port: 0, host: "127.0.0.1", state: () => state, logger });
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Tasking");
    } finally {
      await dashboard.stop();
    }
  });

  it("returns 404 for unknown route", async () => {
    const state = createInitialState(30000, 10);
    const dashboard = new HttpDashboard({ port: 0, host: "127.0.0.1", state: () => state, logger });
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/unknown`);
      expect(res.status).toBe(404);
    } finally {
      await dashboard.stop();
    }
  });

  it("serves /api/v1/<id>/activity from activityStore", async () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1", "ABC-1"));
    const activityStore = new ActivityStore();
    activityStore.record("1", { ts: 1, turn: 1, type: "text", text: "hello" });
    activityStore.record("1", { ts: 2, turn: 1, type: "tool_use", tool: "read" });
    const dashboard = new HttpDashboard({
      port: 0,
      host: "127.0.0.1",
      state: () => state,
      logger,
      activityStore,
    });
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/ABC-1/activity`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { activity: Array<{ type: string }> };
      expect(body.activity).toHaveLength(2);
      expect(body.activity.map((a) => a.type)).toEqual(["text", "tool_use"]);
    } finally {
      await dashboard.stop();
    }
  });

  it("includes direct sessions in /api/v1/state from the provider", async () => {
    const state = createInitialState(30000, 10);
    state.totals.total_tokens = 700;
    const direct: RuntimeDirectSession[] = [
      {
        id: "direct:om_x",
        root_id: "om_x",
        name: "会话一",
        project: "tasking",
        path: "/repos/tasking",
        status: "running",
        session_id: "ses_d",
        queued: 1,
        updated_at: 123,
        agent: "build",
        model: "deepseek/deepseek-v4-flash",
        variant: null,
        turns: 2,
        input_tokens: 1000,
        output_tokens: 200,
        total_tokens: 1200,
      },
    ];
    const dashboard = new HttpDashboard({
      port: 0,
      host: "127.0.0.1",
      state: () => state,
      logger,
      directSessions: () => direct,
      directTotals: () => ({ input_tokens: 1000, output_tokens: 200, total_tokens: 1200 }),
    });
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/state`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        direct: Array<{ id: string; name: string; project: string; status: string }>;
        counts: { running: number };
        codex_totals: { total_tokens: number };
      };
      expect(body.direct).toHaveLength(1);
      expect(body.direct[0]?.id).toBe("direct:om_x");
      expect(body.direct[0]?.name).toBe("会话一");
      expect(body.direct[0]?.status).toBe("running");
      expect(body.counts.running).toBe(0);
      expect(body.codex_totals.total_tokens).toBe(1900);
    } finally {
      await dashboard.stop();
    }
  });

  it("serves /api/v1/direct:<root>/activity from activityStore", async () => {
    const state = createInitialState(30000, 10);
    const activityStore = new ActivityStore();
    activityStore.record("direct:om_x", { ts: 1, turn: 1, type: "text", text: "hi" });
    const dashboard = new HttpDashboard({
      port: 0,
      host: "127.0.0.1",
      state: () => state,
      logger,
      activityStore,
      directSessions: () => [
        {
          id: "direct:om_x",
          root_id: "om_x",
          name: "会话一",
          project: "tasking",
          path: "/repos/tasking",
          status: "idle",
          session_id: null,
          queued: 0,
          updated_at: 0,
          agent: "build",
          model: null,
          variant: null,
          turns: 0,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
        },
      ],
    });
    const port = await dashboard.start();
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/v1/${encodeURIComponent("direct:om_x")}/activity`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { activity: Array<{ text?: string }> };
      expect(body.activity[0]?.text).toBe("hi");
    } finally {
      await dashboard.stop();
    }
  });

  it("exposes tool execution detail through the activity endpoint", async () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1", "ABC-1"));
    const activityStore = new ActivityStore();
    activityStore.record("1", {
      ts: 2,
      turn: 1,
      type: "tool_use",
      tool: "bash",
      title: "echo hi",
      input: { command: "echo hi" },
      output: "hi\n",
      exit: 0,
      status: "completed",
      durationMs: 500,
      truncated: false,
    });
    const dashboard = new HttpDashboard({
      port: 0,
      host: "127.0.0.1",
      state: () => state,
      logger,
      activityStore,
    });
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/ABC-1/activity`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { activity: Array<Record<string, unknown>> };
      const tool = body.activity[0];
      expect(tool?.type).toBe("tool_use");
      expect(tool?.tool).toBe("bash");
      expect(tool?.title).toBe("echo hi");
      expect(tool?.input).toEqual({ command: "echo hi" });
      expect(tool?.output).toBe("hi\n");
      expect(tool?.exit).toBe(0);
      expect(tool?.status).toBe("completed");
      expect(tool?.durationMs).toBe(500);
      expect(tool?.truncated).toBe(false);
    } finally {
      await dashboard.stop();
    }
  });

  it("respects ?limit on activity endpoint", async () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1", "ABC-1"));
    const activityStore = new ActivityStore();
    for (let i = 0; i < 10; i++) activityStore.record("1", { ts: i, turn: 1, type: "text" });
    const dashboard = new HttpDashboard({
      port: 0,
      host: "127.0.0.1",
      state: () => state,
      logger,
      activityStore,
    });
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/ABC-1/activity?limit=3`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { activity: unknown[] };
      expect(body.activity).toHaveLength(3);
    } finally {
      await dashboard.stop();
    }
  });

  it("returns 404 issue_not_found for unknown activity id", async () => {
    const state = createInitialState(30000, 10);
    const activityStore = new ActivityStore();
    const dashboard = new HttpDashboard({
      port: 0,
      host: "127.0.0.1",
      state: () => state,
      logger,
      activityStore,
    });
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/NOPE/activity`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("issue_not_found");
    } finally {
      await dashboard.stop();
    }
  });

  it("returns 404 activity_not_available without activityStore", async () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1", "ABC-1"));
    const dashboard = new HttpDashboard({ port: 0, host: "127.0.0.1", state: () => state, logger });
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/ABC-1/activity`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("activity_not_available");
    } finally {
      await dashboard.stop();
    }
  });

  it("per-issue detail includes model/agent/variant and is not shadowed by activity route", async () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1", "ABC-1"));
    const dashboard = new HttpDashboard({ port: 0, host: "127.0.0.1", state: () => state, logger });
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/ABC-1`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        running: { agent: string; model: string; variant: string | null };
      };
      expect(body.running.agent).toBe("build");
      expect(body.running.model).toBe("anthropic/claude-sonnet-4-5");
      expect(body.running.variant).toBeNull();
    } finally {
      await dashboard.stop();
    }
  });

  it("returns 405 for POST on /api/v1/state", async () => {
    const state = createInitialState(30000, 10);
    const dashboard = new HttpDashboard({ port: 0, host: "127.0.0.1", state: () => state, logger });
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/state`, { method: "POST" });
      expect(res.status).toBe(405);
    } finally {
      await dashboard.stop();
    }
  });

  it("returns 405 for GET on /api/v1/refresh", async () => {
    const state = createInitialState(30000, 10);
    const dashboard = new HttpDashboard({ port: 0, host: "127.0.0.1", state: () => state, logger });
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/refresh`);
      expect(res.status).toBe(405);
    } finally {
      await dashboard.stop();
    }
  });

  it("POST /api/v1/refresh triggers requestRefresh and returns 202", async () => {
    const state = createInitialState(30000, 10);
    let refreshCalled = false;
    const dashboard = new HttpDashboard({
      port: 0,
      host: "127.0.0.1",
      state: () => state,
      logger,
      requestRefresh: () => {
        refreshCalled = true;
        return true;
      },
    });
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/refresh`, { method: "POST" });
      expect(res.status).toBe(202);
      expect(refreshCalled).toBe(true);
      const body = (await res.json()) as {
        queued: boolean;
        coalesced: boolean;
        operations: string[];
      };
      expect(body.queued).toBe(true);
      expect(body.operations).toContain("poll");
    } finally {
      await dashboard.stop();
    }
  });

  it("GET /api/v1/:identifier returns 404 for unknown issue", async () => {
    const state = createInitialState(30000, 10);
    const dashboard = new HttpDashboard({ port: 0, host: "127.0.0.1", state: () => state, logger });
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/UNKNOWN-1`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("issue_not_found");
    } finally {
      await dashboard.stop();
    }
  });

  it("GET /api/v1/:identifier returns 200 with detail for running issue", async () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", {
      task: {
        id: "1",
        identifier: "ENG-1",
        title: "test",
        description: null,
        priority: 1,
        state: "In Progress",
        branch_name: null,
        url: null,
        labels: [],
        assignee: null,
        blocked_by: [],
        created_at: null,
        updated_at: null,
        source: "jira",
      },
      task_identifier: "ENG-1",
      workspace_path: "/tmp/ENG-1",
      session_id: "ses_abc",
      last_event: "turn_completed",
      last_message: "working",
      last_event_at: Date.now(),
      started_at: Date.now() - 5000,
      turn_count: 2,
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      last_reported_input_tokens: 100,
      last_reported_output_tokens: 50,
      last_reported_total_tokens: 150,
      retry_attempt: null,
      abort: null,
    });
    const dashboard = new HttpDashboard({ port: 0, host: "127.0.0.1", state: () => state, logger });
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/ENG-1`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        running: { turn_count: number; session_id: string };
        workspace: { path: string };
      };
      expect(body.status).toBe("running");
      expect(body.running.turn_count).toBe(2);
      expect(body.running.session_id).toBe("ses_abc");
      expect(body.workspace.path).toBe("/tmp/ENG-1");
    } finally {
      await dashboard.stop();
    }
  });

  it("GET /api/v1/:identifier returns 200 with retry detail", async () => {
    const state = createInitialState(30000, 10);
    state.retry_attempts.set("2", {
      task_id: "2",
      identifier: "ENG-2",
      attempt: 3,
      due_at_ms: Date.now() + 5000,
      timer: null,
      error: "no slots",
      continuation: false,
      session_id: null,
    });
    const dashboard = new HttpDashboard({ port: 0, host: "127.0.0.1", state: () => state, logger });
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/ENG-2`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        retry: { attempt: number; error: string };
      };
      expect(body.status).toBe("retrying");
      expect(body.retry.attempt).toBe(3);
      expect(body.retry.error).toBe("no slots");
    } finally {
      await dashboard.stop();
    }
  });
});

describe("HttpDashboard config endpoint", () => {
  const logger = new ConsoleLogger({}, () => {});

  function makeDashboard() {
    const state = createInitialState(30000, 10);
    const configView = () => ({
      config: {
        tracker: { api_key: "****", endpoint: "http://jira.example" },
        env: { GITLAB_TOKEN: "****" },
      },
      runtime: {
        pid: 42,
        started_at: 1700000000000,
        workflow_path: "/repo/WORKFLOW.md",
        workspace_root: "/repo/tasking_workspaces",
        log_path: "/repo/tasking.log",
        host: "0.0.0.0",
        port: 8080,
      },
    });
    const dashboard = new HttpDashboard({
      port: 0,
      host: "127.0.0.1",
      state: () => state,
      logger,
      configView,
    });
    return dashboard;
  }

  it("serves /api/v1/config with masked config and runtime", async () => {
    const dashboard = makeDashboard();
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/config`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        config: { tracker: { api_key: string }; env: { GITLAB_TOKEN: string } };
        runtime: { pid: number; started_at: string; workflow_path: string; port: number };
      };
      expect(body.config.tracker.api_key).toBe("****");
      expect(body.config.tracker.endpoint).toBe("http://jira.example");
      expect(body.config.env.GITLAB_TOKEN).toBe("****");
      expect(body.runtime.pid).toBe(42);
      expect(body.runtime.workflow_path).toBe("/repo/WORKFLOW.md");
      expect(body.runtime.port).toBe(8080);
      expect(typeof body.runtime.started_at).toBe("string");
    } finally {
      await dashboard.stop();
    }
  });

  it("returns 405 for POST on /api/v1/config", async () => {
    const dashboard = makeDashboard();
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/config`, { method: "POST" });
      expect(res.status).toBe(405);
    } finally {
      await dashboard.stop();
    }
  });

  it("returns 404 when dashboard has no configView source", async () => {
    const state = createInitialState(30000, 10);
    const dashboard = new HttpDashboard({ port: 0, host: "127.0.0.1", state: () => state, logger });
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/config`);
      expect(res.status).toBe(404);
    } finally {
      await dashboard.stop();
    }
  });
});

describe("ConsoleLogger file sink", () => {
  it("writes to file with rotation", () => {
    const dir = mkdtempSync(join(tmpdir(), "tasking-log-"));
    try {
      const logPath = join(dir, "test.log");
      const logger = ConsoleLogger.withFileSink(
        {},
        {
          path: logPath,
          maxBytes: 200,
          maxFiles: 3,
        },
      );
      logger.info("short line 1");
      logger.info("short line 2");
      logger.info("short line 3");
      const content = readFileSync(logPath, "utf8");
      expect(content).toContain("short line");
      expect(existsSync(`${logPath}.1`)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rotates by byte length so multibyte lines cannot exceed maxBytes", () => {
    const dir = mkdtempSync(join(tmpdir(), "tasking-log-bytes-"));
    try {
      const logPath = join(dir, "test.log");
      const logger = ConsoleLogger.withFileSink(
        {},
        {
          path: logPath,
          maxBytes: 300,
          maxFiles: 2,
        },
      );
      const cjk = "测".repeat(15);
      logger.info(cjk);
      logger.info(cjk);
      logger.info(cjk);
      logger.info(cjk);
      const stat = statSync(logPath);
      expect(stat.size).toBeLessThanOrEqual(300);
      expect(existsSync(`${logPath}.1`)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("suppressStderr prevents stderr output but file still gets logs", () => {
    const dir = mkdtempSync(join(tmpdir(), "tasking-log-suppress-"));
    try {
      const logPath = join(dir, "test.log");
      const stderrLines: string[] = [];
      const logger = ConsoleLogger.withFileSink(
        {},
        {
          path: logPath,
          maxBytes: 10485760,
          maxFiles: 5,
        },
        (line) => stderrLines.push(line),
      );
      logger.suppressStderr();
      logger.info("tui test message");
      const content = readFileSync(logPath, "utf8");
      expect(content).toContain("tui test message");
      expect(stderrLines).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("child logger inherits stderr suppression", () => {
    const dir = mkdtempSync(join(tmpdir(), "tasking-log-child-suppress-"));
    try {
      const logPath = join(dir, "test.log");
      const stderrLines: string[] = [];
      const logger = ConsoleLogger.withFileSink(
        {},
        {
          path: logPath,
          maxBytes: 10485760,
          maxFiles: 5,
        },
        (line) => stderrLines.push(line),
      );
      logger.suppressStderr();
      const child = logger.child({ task_id: "T-1" });
      child.info("child message");
      const content = readFileSync(logPath, "utf8");
      expect(content).toContain("child message");
      expect(stderrLines).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("buildSnapshot waiting approval", () => {
  function baseEntry() {
    return {
      task: {
        id: "1",
        identifier: "ABC-1",
        title: "t",
        description: null,
        priority: 1,
        state: "In Progress",
        branch_name: null,
        url: null,
        labels: [],
        blocked_by: [],
        assignee: null,
        created_at: null,
        updated_at: null,
        source: "jira" as const,
      },
      task_identifier: "ABC-1",
      workspace_path: "/tmp/ABC-1",
      session_id: "s1",
      last_event: "turn_started",
      last_message: null,
      last_event_at: Date.now(),
      started_at: Date.now() - 5000,
      turn_count: 1,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      last_reported_input_tokens: 0,
      last_reported_output_tokens: 0,
      last_reported_total_tokens: 0,
      retry_attempt: null,
      abort: null,
      agent: "build",
      model: null,
      variant: null,
    };
  }

  it("exposes waiting approval with remaining budget", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", {
      ...baseEntry(),
      waiting_approval: true,
      waiting_since: Date.now() - 60_000,
    });
    const snap = buildSnapshot(state, { permissionTimeoutMs: 600_000 });
    expect(snap.running[0]?.waiting_approval).toBe(true);
    expect(snap.running[0]?.waiting_remaining_ms).toBeGreaterThan(500_000);
    expect(snap.running[0]?.waiting_remaining_ms).toBeLessThanOrEqual(600_000);
  });

  it("omits waiting fields when not waiting", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", baseEntry());
    const snap = buildSnapshot(state);
    expect(snap.running[0]?.waiting_approval).toBeUndefined();
  });
});
