import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JiraTracker, isActiveState, isTerminalState } from "../src/adapters/jira/tracker.js";
import { Daemon } from "../src/cli/daemon.js";
import type { TrackerConfig } from "../src/config/config-types.js";
import { parseWorkflowContent } from "../src/config/loader.js";
import { ConfigManager } from "../src/config/manager.js";
import { resolveConfig } from "../src/config/resolver.js";
import { ConsoleLogger } from "../src/observability/logger.js";
import { Scheduler, type TrackerPort } from "../src/scheduler/scheduler.js";

const logger = new ConsoleLogger({}, () => {});

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "tasking-reg-"));
}

function makeTrackerConfig(overrides: Partial<TrackerConfig> = {}): TrackerConfig {
  return {
    kind: "jira",
    endpoint: "https://example.atlassian.net/rest/api/3",
    api_key: "tok",
    api_user: "user@example.com",
    auth_mode: "basic",
    review_state: null,
    project_key: "ENG",
    project_slug: null,
    assignee: null,
    required_labels: [],
    active_states: ["To Do", "In Progress"],
    terminal_states: ["Done", "Closed"],
    ...overrides,
  };
}

function makeMockFetch(
  capture: (url: string, headers: Record<string, string>) => void,
  body: unknown = { total: 0, issues: [] },
): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h instanceof Headers) {
      for (const [k, v] of h.entries()) headers[k] = v;
    } else if (typeof h === "object" && h !== null) {
      for (const [k, v] of Object.entries(h)) headers[k] = String(v);
    }
    capture(String(url), headers);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

describe("A1: YAML parser nested blocks regression", () => {
  it("nested list does not destroy sibling scalars", () => {
    const content = [
      "---",
      "tracker:",
      "  kind: jira",
      "  required_labels:",
      "    - foo",
      "  active_states:",
      "    - To Do",
      "  endpoint: https://example.net",
      "---",
      "body",
    ].join("\n");
    const wf = parseWorkflowContent(content, "/tmp/WF.md");
    const cfg = resolveConfig(wf.config, "/tmp", wf.prompt_template);
    expect(cfg.tracker.kind).toBe("jira");
    expect(cfg.tracker.required_labels).toEqual(["foo"]);
    expect(cfg.tracker.active_states).toEqual(["To Do"]);
    expect(cfg.tracker.endpoint).toBe("https://example.net");
  });
});

describe("A3: auth_mode bearer/basic regression", () => {
  it("bearer mode sends Bearer header", async () => {
    let capturedHeader = "";
    const fetchImpl = makeMockFetch((_url, headers) => {
      capturedHeader = headers.Authorization ?? "";
    });
    const tracker = new JiraTracker(
      makeTrackerConfig({ auth_mode: "bearer", api_key: "mytoken", api_user: null }),
      fetchImpl,
    );
    await tracker.fetchCandidateIssues();
    expect(capturedHeader).toBe("Bearer mytoken");
  });

  it("basic mode sends Basic header", async () => {
    let capturedHeader = "";
    const fetchImpl = makeMockFetch((_url, headers) => {
      capturedHeader = headers.Authorization ?? "";
    });
    const tracker = new JiraTracker(
      makeTrackerConfig({ auth_mode: "basic", api_key: "tok", api_user: "user@example.com" }),
      fetchImpl,
    );
    await tracker.fetchCandidateIssues();
    expect(capturedHeader).toMatch(/^Basic /);
    expect(capturedHeader).not.toContain("tok");
  });
});

describe("A4: endpoint trailing slash regression", () => {
  it("trims single trailing slash", async () => {
    let capturedUrl = "";
    const fetchImpl = makeMockFetch((url) => {
      capturedUrl = url;
    });
    const tracker = new JiraTracker(
      makeTrackerConfig({ endpoint: "http://host/rest/api/2/" }),
      fetchImpl,
    );
    await tracker.fetchCandidateIssues();
    expect(capturedUrl).toBe("http://host/rest/api/2/search");
    expect(capturedUrl).not.toContain("//search");
  });

  it("trims multiple trailing slashes", async () => {
    let capturedUrl = "";
    const fetchImpl = makeMockFetch((url) => {
      capturedUrl = url;
    });
    const tracker = new JiraTracker(
      makeTrackerConfig({ endpoint: "http://host/rest/api/2//" }),
      fetchImpl,
    );
    await tracker.fetchCandidateIssues();
    expect(capturedUrl).toBe("http://host/rest/api/2/search");
  });
});

describe("A5: fetchIssueStatesByIds numeric id JQL regression", () => {
  it("numeric ids without quotes", async () => {
    let capturedBody = "";
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body ? String(init.body) : "";
      return new Response(JSON.stringify({ total: 0, issues: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const tracker = new JiraTracker(makeTrackerConfig(), fetchImpl);
    await tracker.fetchIssueStatesByIds(["10334", "10335"]);
    expect(capturedBody).toContain("id in (10334, 10335)");
    expect(capturedBody).not.toContain('"10334"');
  });

  it("non-numeric ids with quotes", async () => {
    let capturedBody = "";
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body ? String(init.body) : "";
      return new Response(JSON.stringify({ total: 0, issues: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const tracker = new JiraTracker(makeTrackerConfig(), fetchImpl);
    await tracker.fetchIssueStatesByIds(["OS-222"]);
    expect(capturedBody).toContain("id in");
    expect(capturedBody).toContain("OS-222");
  });
});

describe("A6: daemon→scheduler wiring integration", () => {
  it("daemon tick triggers scheduler.tick → fetchCandidateIssues", async () => {
    const dir = tempDir();
    try {
      const wfPath = join(dir, "WORKFLOW.md");
      writeFileSync(
        wfPath,
        "---\ntracker:\n  kind: jira\n  api_key: tok\n  api_user: u@e.com\n  project_key: ENG\npolling:\n  interval_ms: 1000\n---\nbody",
      );
      const mgr = ConfigManager.fromFile(wfPath);

      let tickCalled = false;
      const daemon = new Daemon({
        configManager: mgr,
        logger,
        onTick: async () => {
          tickCalled = true;
        },
      });

      const code = await daemon.start();
      expect(code).toBe(0);

      await new Promise((r) => setTimeout(r, 50));
      expect(tickCalled).toBe(true);

      await daemon.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("C1: inline YAML array parsing", () => {
  it("parses [bug, urgent]", () => {
    const content = "---\ntracker:\n  required_labels: [bug, urgent]\n---\nbody";
    const wf = parseWorkflowContent(content, "/tmp/WF.md");
    const cfg = resolveConfig(wf.config, "/tmp", wf.prompt_template);
    expect(cfg.tracker.required_labels).toEqual(["bug", "urgent"]);
  });
});

describe("C9-C10: Todo blocker gating + state helpers", () => {
  it("isActiveState case-insensitive", () => {
    expect(isActiveState("IN PROGRESS", ["In Progress"])).toBe(true);
  });

  it("isTerminalState case-insensitive", () => {
    expect(isTerminalState("done", ["Done"])).toBe(true);
  });
});

describe("C12: HTTP dashboard /api/v1/state reflects running tasks", () => {
  it("returns running count from scheduler state", async () => {
    const { HttpDashboard } = await import("../src/observability/http-dashboard.js");
    const { createInitialState } = await import("../src/shared/types.js");
    const state = createInitialState(30000, 10);
    state.counts = { running: 0, retrying: 0 };
    state.running.set("1", {
      task: {
        id: "1",
        identifier: "T-1",
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
      task_identifier: "T-1",
      workspace_path: "/tmp/T-1",
      session_id: "s1",
      last_event: null,
      last_message: null,
      last_event_at: null,
      started_at: Date.now(),
      turn_count: 2,
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      last_reported_input_tokens: 0,
      last_reported_output_tokens: 0,
      last_reported_total_tokens: 0,
      retry_attempt: null,
      abort: null,
    });

    const dashboard = new HttpDashboard({ port: 0, state: () => state, logger });
    const port = await dashboard.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/state`);
      const body = (await res.json()) as { counts: { running: number } };
      expect(body.counts.running).toBe(1);
    } finally {
      await dashboard.stop();
    }
  });
});

describe("B5: scheduler stop clears retry timers", () => {
  it("no onRetry after stop", async () => {
    let fetchCalls = 0;
    const task = {
      id: "1",
      identifier: "T-1",
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
    };
    const tracker: TrackerPort = {
      fetchCandidateIssues: async () => {
        fetchCalls++;
        return [task];
      },
      fetchIssuesByStates: async () => [],
      fetchIssueStatesByIds: async () => [task],
    };

    const root = tempDir();
    try {
      const config = resolveConfig(
        {
          tracker: { kind: "jira", api_key: "tok", project_key: "ENG" },
          workspace: { root },
          agent: { max_retry_backoff_ms: 100 },
        },
        "/tmp",
        "p",
      );
      const sched = new Scheduler({
        tracker,
        config: () => config,
        logger,
        runAttemptFn: (async () => ({
          status: "failed" as const,
          error: "test failure",
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          started_at: Date.now(),
          ended_at: Date.now(),
        })) as never,
      });

      await sched.tick();
      expect(sched.state.retry_attempts.size).toBeGreaterThan(0);

      const callsBefore = fetchCalls;
      sched.stop();

      await new Promise((r) => setTimeout(r, 200));
      expect(fetchCalls).toBe(callsBefore);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
