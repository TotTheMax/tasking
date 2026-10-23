import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EffectiveConfig } from "../src/config/config-types.js";
import { resolveConfig } from "../src/config/resolver.js";
import { ConsoleLogger } from "../src/observability/logger.js";
import {
  Scheduler,
  type TrackerPort,
  computeBackoffDelay,
  hasStateSlot,
  isDispatchEligible,
  isRoutable,
  normalizeState,
  sortForDispatch,
} from "../src/scheduler/scheduler.js";
import type { OrchestratorRuntimeState } from "../src/shared/types.js";
import type { Task } from "../src/shared/types.js";
import { resolveWorkspacePath, writeSessionSidecar } from "../src/workspace/manager.js";

const logger = new ConsoleLogger({}, () => {});

function assertClaimedInvariant(state: OrchestratorRuntimeState): void {
  for (const id of state.claimed) {
    if (!state.running.has(id) && !state.retry_attempts.has(id)) {
      throw new Error(
        `claimed invariant violated: "${id}" in claimed but not in running or retry_attempts`,
      );
    }
  }
}

function makeConfig(root: string): EffectiveConfig {
  return resolveConfig(
    {
      tracker: { kind: "jira", api_key: "tok", project_key: "ENG" },
      workspace: { root },
      agent: { max_concurrent_agents: 2, max_turns: 1, max_retry_backoff_ms: 300000 },
    },
    "/tmp",
    "do {{ task.identifier }}",
  );
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "1",
    identifier: "ENG-1",
    title: "Task",
    description: null,
    priority: 2,
    state: "To Do",
    branch_name: null,
    url: null,
    labels: [],
    assignee: null,
    blocked_by: [],
    created_at: 1000,
    updated_at: null,
    source: "jira",
    ...overrides,
  };
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tasking-sched-"));
}

function mockTracker(issues: Task[]): TrackerPort {
  return {
    fetchCandidateIssues: async () => issues,
    fetchIssuesByStates: async () => issues,
    fetchIssueStatesByIds: async (ids: string[]) => issues.filter((i) => ids.includes(i.id)),
  };
}

function makeScheduler(
  tracker: TrackerPort,
  config: EffectiveConfig,
  spawnRunner?: (
    cmd: string[],
    cwd: string,
    timeout: number,
    inactivityTimeout: number,
    signal?: AbortSignal,
  ) => Promise<unknown>,
  runAttemptFn?: () => Promise<unknown>,
): Scheduler {
  const defaultRun = (async () => ({
    status: "succeeded",
    error: null,
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    session_id: null,
    started_at: Date.now(),
    ended_at: Date.now(),
  })) as never;
  return new Scheduler({
    tracker,
    config: () => config,
    logger,
    runAttemptFn: (runAttemptFn ?? defaultRun) as never,
    spawnRunner,
  });
}

describe("computeBackoffDelay", () => {
  it("computes exponential backoff", () => {
    expect(computeBackoffDelay(1, 300000)).toBe(10000);
    expect(computeBackoffDelay(2, 300000)).toBe(20000);
    expect(computeBackoffDelay(3, 300000)).toBe(40000);
  });

  it("caps at maxRetryBackoffMs", () => {
    expect(computeBackoffDelay(10, 300000)).toBe(300000);
  });

  it("caps exponent at 10 to avoid Infinity", () => {
    expect(computeBackoffDelay(50, 300000)).toBe(300000);
  });
});

describe("sortForDispatch", () => {
  it("sorts by priority ascending then oldest created", () => {
    const a = makeTask({ id: "1", identifier: "A", priority: 2, created_at: 2000 });
    const b = makeTask({ id: "2", identifier: "B", priority: 1, created_at: 1000 });
    const c = makeTask({ id: "3", identifier: "C", priority: 1, created_at: 500 });
    const sorted = sortForDispatch([a, b, c]);
    expect(sorted.map((t) => t.id)).toEqual(["3", "2", "1"]);
  });

  it("uses identifier as tie-breaker", () => {
    const a = makeTask({ id: "1", identifier: "B", priority: 1, created_at: 1000 });
    const b = makeTask({ id: "2", identifier: "A", priority: 1, created_at: 1000 });
    const sorted = sortForDispatch([a, b]);
    expect(sorted.map((t) => t.identifier)).toEqual(["A", "B"]);
  });
});

describe("isDispatchEligible", () => {
  it("rejects missing required label", () => {
    const config = makeConfig(tempRoot());
    config.tracker.required_labels = ["urgent"];
    const task = makeTask({ labels: ["bug"] });
    expect(isDispatchEligible(task, schedulerState(), config)).toBe(false);
  });

  it("accepts with required label present", () => {
    const config = makeConfig(tempRoot());
    config.tracker.required_labels = ["urgent"];
    const task = makeTask({ labels: ["urgent"] });
    expect(isDispatchEligible(task, schedulerState(), config)).toBe(true);
  });

  it("rejects Todo with non-terminal blocker", () => {
    const config = makeConfig(tempRoot());
    const task = makeTask({
      state: "To Do",
      blocked_by: [{ id: "2", identifier: "ENG-2", state: "In Progress" }],
    });
    expect(isDispatchEligible(task, schedulerState(), config)).toBe(false);
  });

  it("accepts Todo with terminal blocker", () => {
    const config = makeConfig(tempRoot());
    const task = makeTask({
      state: "To Do",
      blocked_by: [{ id: "2", identifier: "ENG-2", state: "Done" }],
    });
    expect(isDispatchEligible(task, schedulerState(), config)).toBe(true);
  });
});

function schedulerState() {
  return new Scheduler({
    tracker: mockTracker([]),
    config: () => makeConfig(tempRoot()),
    logger,
    runAttemptFn: (async () => ({
      status: "succeeded",
      error: null,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      session_id: null,
      started_at: 0,
      ended_at: 0,
    })) as never,
  }).state;
}

describe("Scheduler tick", () => {
  it("dispatches eligible tasks and marks them claimed", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      const task = makeTask({ state: "In Progress" });
      const tracker = mockTracker([task]);
      const neverResolve = () => new Promise(() => {});
      const sched = makeScheduler(tracker, config, undefined, neverResolve as never);
      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      expect(sched.state.claimed.has(task.id)).toBe(true);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not dispatch when slots exhausted", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_concurrent_agents = 1;
      const a = makeTask({ id: "1", identifier: "A", state: "In Progress" });
      const b = makeTask({ id: "2", identifier: "B", state: "In Progress" });
      const tracker = mockTracker([a, b]);
      const neverResolve = () => new Promise(() => {});
      const sched = makeScheduler(tracker, config, undefined, neverResolve as never);
      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      expect(sched.state.claimed.size).toBe(1);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reconciles terminal state by cleaning workspace", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      const task = makeTask({ id: "1", state: "In Progress" });
      let state = "In Progress";
      const tracker: TrackerPort = {
        fetchCandidateIssues: async () => (state === "In Progress" ? [{ ...task, state }] : []),
        fetchIssuesByStates: async () => [],
        fetchIssueStatesByIds: async () => [{ ...task, state }],
      };
      const neverResolve = () => new Promise(() => {});
      const sched = makeScheduler(tracker, config, undefined, neverResolve as never);
      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      state = "Done";
      await sched.tick();
      expect(sched.state.running.size).toBe(0);
      expect(sched.state.claimed.has("1")).toBe(false);
      assertClaimedInvariant(sched.state);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("reconcile terminal workspace cleanup", () => {
  it("deletes workspace dir and runs before_remove hook on terminal transition", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      const sentinel = join(root, "before_remove_ran");
      config.hooks.before_remove = `touch ${sentinel}`;
      const task = makeTask({ id: "1", identifier: "ENG-1", state: "In Progress" });
      const wsPath = resolveWorkspacePath(task.identifier, root);
      mkdirSync(wsPath, { recursive: true });
      writeFileSync(join(wsPath, "marker"), "x");
      let state = "In Progress";
      const tracker: TrackerPort = {
        fetchCandidateIssues: async () => (state === "In Progress" ? [{ ...task, state }] : []),
        fetchIssuesByStates: async () => [],
        fetchIssueStatesByIds: async () => [{ ...task, state }],
      };
      const neverResolve = () => new Promise(() => {});
      const sched = makeScheduler(tracker, config, undefined, neverResolve as never);
      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      expect(existsSync(wsPath)).toBe(true);
      state = "Done";
      await sched.tick();
      expect(sched.state.running.size).toBe(0);
      expect(existsSync(wsPath)).toBe(false);
      expect(existsSync(sentinel)).toBe(true);
      expect(sched.state.claimed.has("1")).toBe(false);
      assertClaimedInvariant(sched.state);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses workspace_path captured at dispatch even after workspace.root changes", async () => {
    const rootA = tempRoot();
    const rootB = tempRoot();
    try {
      const config = makeConfig(rootA);
      const task = makeTask({ id: "1", identifier: "ENG-1", state: "In Progress" });
      const wsPathA = resolveWorkspacePath(task.identifier, rootA);
      mkdirSync(wsPathA, { recursive: true });
      writeFileSync(join(wsPathA, "marker"), "x");
      let state = "In Progress";
      const tracker: TrackerPort = {
        fetchCandidateIssues: async () => (state === "In Progress" ? [{ ...task, state }] : []),
        fetchIssuesByStates: async () => [],
        fetchIssueStatesByIds: async () => [{ ...task, state }],
      };
      const neverResolve = () => new Promise(() => {});
      const sched = makeScheduler(tracker, config, undefined, neverResolve as never);
      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      config.workspace.root = rootB;
      state = "Done";
      await sched.tick();
      expect(sched.state.running.size).toBe(0);
      expect(existsSync(wsPathA)).toBe(false);
      expect(existsSync(resolveWorkspacePath(task.identifier, rootB))).toBe(false);
      expect(sched.state.claimed.has("1")).toBe(false);
      assertClaimedInvariant(sched.state);
      sched.stop();
    } finally {
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
    }
  });

  it("is a safe no-op when workspace_path dir is missing", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      const task = makeTask({ id: "1", identifier: "ENG-1", state: "In Progress" });
      let state = "In Progress";
      const tracker: TrackerPort = {
        fetchCandidateIssues: async () => (state === "In Progress" ? [{ ...task, state }] : []),
        fetchIssuesByStates: async () => [],
        fetchIssueStatesByIds: async () => [{ ...task, state }],
      };
      const neverResolve = () => new Promise(() => {});
      const sched = makeScheduler(tracker, config, undefined, neverResolve as never);
      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      state = "Done";
      await expect(sched.tick()).resolves.not.toThrow();
      expect(sched.state.running.size).toBe(0);
      expect(sched.state.claimed.has("1")).toBe(false);
      assertClaimedInvariant(sched.state);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves workspace for non-active non-terminal state", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      const task = makeTask({ id: "1", identifier: "ENG-1", state: "In Progress" });
      const wsPath = resolveWorkspacePath(task.identifier, root);
      mkdirSync(wsPath, { recursive: true });
      writeFileSync(join(wsPath, "marker"), "x");
      let state = "In Progress";
      const tracker: TrackerPort = {
        fetchCandidateIssues: async () => (state === "In Progress" ? [{ ...task, state }] : []),
        fetchIssuesByStates: async () => [],
        fetchIssueStatesByIds: async () => [{ ...task, state }],
      };
      const neverResolve = () => new Promise(() => {});
      const sched = makeScheduler(tracker, config, undefined, neverResolve as never);
      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      state = "In Review";
      await sched.tick();
      expect(sched.state.running.size).toBe(0);
      expect(existsSync(wsPath)).toBe(true);
      expect(sched.state.claimed.has("1")).toBe(false);
      assertClaimedInvariant(sched.state);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cleans claimed set when task moves to non-active state (review redispatch bug)", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      const task = makeTask({ id: "1", identifier: "ENG-1", state: "In Progress" });
      let state = "In Progress";
      const tracker: TrackerPort = {
        fetchCandidateIssues: async () => (state === "In Progress" ? [{ ...task, state }] : []),
        fetchIssuesByStates: async () => [],
        fetchIssueStatesByIds: async () => [{ ...task, state }],
      };
      const neverResolve = () => new Promise(() => {});
      const sched = makeScheduler(tracker, config, undefined, neverResolve as never);
      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      expect(sched.state.claimed.has("1")).toBe(true);

      state = "In Review";
      await sched.tick();
      expect(sched.state.running.size).toBe(0);
      expect(sched.state.claimed.has("1")).toBe(false);
      assertClaimedInvariant(sched.state);

      state = "In Progress";
      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      expect(sched.state.claimed.has("1")).toBe(true);
      assertClaimedInvariant(sched.state);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("recovers session_id from sidecar when re-dispatching after review", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      const task = makeTask({ id: "1", identifier: "ENG-1", state: "In Progress" });
      const wsPath = resolveWorkspacePath(task.identifier, root);
      mkdirSync(wsPath, { recursive: true });
      writeSessionSidecar(wsPath, "ses_previous_session_abc", 3);

      let state = "In Progress";
      const tracker: TrackerPort = {
        fetchCandidateIssues: async () => (state === "In Progress" ? [{ ...task, state }] : []),
        fetchIssuesByStates: async () => [],
        fetchIssueStatesByIds: async () => [{ ...task, state }],
      };

      const capturedSessions: (string | null)[] = [];
      const capturedStartTurns: (number | undefined)[] = [];
      const runFn = (async (opts: { sessionId?: string | null; startTurn?: number }) => {
        capturedSessions.push(opts.sessionId ?? null);
        capturedStartTurns.push(opts.startTurn);
        return new Promise(() => {});
      }) as never;

      const sched = makeScheduler(tracker, config, undefined, runFn);

      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      expect(capturedSessions).toEqual(["ses_previous_session_abc"]);
      expect(capturedStartTurns).toEqual([4]);
      const entry = sched.state.running.get("1");
      expect(entry?.turn_count).toBe(3);

      state = "In Review";
      await sched.tick();
      expect(sched.state.running.size).toBe(0);
      expect(sched.state.claimed.has("1")).toBe(false);

      state = "In Progress";
      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      expect(capturedSessions).toEqual(["ses_previous_session_abc", "ses_previous_session_abc"]);
      expect(capturedStartTurns).toEqual([4, 4]);
      assertClaimedInvariant(sched.state);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("restores cumulative tokens from sidecar into running entry on dispatch", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      const task = makeTask({ id: "1", identifier: "ENG-1", state: "In Progress" });
      const wsPath = resolveWorkspacePath(task.identifier, root);
      mkdirSync(wsPath, { recursive: true });
      writeSessionSidecar(wsPath, "ses_tok", 2, {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
      });
      const tracker = mockTracker([{ ...task, state: "In Progress" }]);
      const runFn = (async () => new Promise(() => {})) as never;
      const sched = makeScheduler(tracker, config, undefined, runFn);
      await sched.tick();
      const entry = sched.state.running.get("1");
      expect(entry?.input_tokens).toBe(100);
      expect(entry?.output_tokens).toBe(50);
      expect(entry?.total_tokens).toBe(150);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("terminal state lifecycle: active → terminal → stays gone", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      const task = makeTask({ id: "1", state: "In Progress" });
      let state = "In Progress";
      const tracker: TrackerPort = {
        fetchCandidateIssues: async () => (state === "In Progress" ? [{ ...task, state }] : []),
        fetchIssuesByStates: async () => [],
        fetchIssueStatesByIds: async () => [{ ...task, state }],
      };
      const neverResolve = () => new Promise(() => {});
      const sched = makeScheduler(tracker, config, undefined, neverResolve as never);
      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      expect(sched.state.claimed.has("1")).toBe(true);

      state = "Done";
      await sched.tick();
      expect(sched.state.running.size).toBe(0);
      expect(sched.state.claimed.has("1")).toBe(false);

      state = "In Progress";
      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      expect(sched.state.claimed.has("1")).toBe(true);
      assertClaimedInvariant(sched.state);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("missing-from-tracker lifecycle: active → missing → returns → redispatched", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      const task = makeTask({ id: "1", state: "In Progress" });
      let inTracker = true;
      const tracker: TrackerPort = {
        fetchCandidateIssues: async () => (inTracker ? [task] : []),
        fetchIssuesByStates: async () => [],
        fetchIssueStatesByIds: async () => (inTracker ? [task] : []),
      };
      const neverResolve = () => new Promise(() => {});
      const sched = makeScheduler(tracker, config, undefined, neverResolve as never);
      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      expect(sched.state.claimed.has("1")).toBe(true);

      inTracker = false;
      await sched.tick();
      expect(sched.state.running.size).toBe(0);
      expect(sched.state.claimed.has("1")).toBe(false);

      inTracker = true;
      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      expect(sched.state.claimed.has("1")).toBe(true);
      assertClaimedInvariant(sched.state);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("routability lifecycle: active → label removed → label restored → redispatched", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.tracker.required_labels = ["urgent"];
      const task = makeTask({ id: "1", state: "In Progress", labels: ["urgent"] });
      let labels = ["urgent"];
      const tracker: TrackerPort = {
        fetchCandidateIssues: async () => [{ ...task, labels: [...labels] }],
        fetchIssuesByStates: async () => [],
        fetchIssueStatesByIds: async () => [{ ...task, labels: [...labels] }],
      };
      const neverResolve = () => new Promise(() => {});
      const sched = makeScheduler(tracker, config, undefined, neverResolve as never);
      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      expect(sched.state.claimed.has("1")).toBe(true);

      labels = [];
      await sched.tick();
      expect(sched.state.running.size).toBe(0);
      expect(sched.state.claimed.has("1")).toBe(false);

      labels = ["urgent"];
      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      expect(sched.state.claimed.has("1")).toBe(true);
      assertClaimedInvariant(sched.state);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("session ID propagation", () => {
  it("continuation retry preserves session_id from completed run", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 1;
      const task = makeTask({ id: "1", state: "In Progress" });
      const tracker = mockTracker([task]);
      const capturedSessions: (string | null)[] = [];
      const runFn = (async (opts: { sessionId?: string | null }) => {
        capturedSessions.push(opts.sessionId ?? null);
        return {
          status: "succeeded",
          error: null,
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          session_id: "ses_cont123",
          started_at: Date.now(),
          ended_at: Date.now(),
        };
      }) as never;
      const sched = makeScheduler(tracker, config, undefined, runFn);
      await sched.tick();
      expect(capturedSessions).toEqual([null]);
      const retryEntry = sched.state.retry_attempts.get(task.id);
      expect(retryEntry?.session_id).toBe("ses_cont123");
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes null session_id on failure retry", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 1;
      const task = makeTask({ id: "1", state: "In Progress" });
      const tracker = mockTracker([task]);
      const runFn = (async () => ({
        status: "failed",
        error: "boom",
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        session_id: "ses_fail456",
        started_at: Date.now(),
        ended_at: Date.now(),
      })) as never;
      const sched = makeScheduler(tracker, config, undefined, runFn);
      await sched.tick();
      const retryEntry = sched.state.retry_attempts.get(task.id);
      expect(retryEntry?.session_id).toBeNull();
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("drain() on shutdown lets the aborted attempt settle and delete its session", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 1;
      const task = makeTask({ id: "1", state: "In Progress" });
      const tracker = mockTracker([task]);
      const runFn = (async (opts: { signal?: AbortSignal }) => {
        await new Promise<void>((resolve) => {
          opts.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return {
          status: "failed",
          error: "aborted",
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          session_id: "ses_shutdown1",
          started_at: Date.now(),
          ended_at: Date.now(),
        };
      }) as never;
      const calls: string[][] = [];
      const apiExec = (async (args: string[]) => {
        calls.push(args);
        return { exitCode: 0, stdout: "{}", stderr: "", timedOut: false };
      }) as never;
      const sched = new Scheduler({
        tracker,
        config: () => config,
        logger,
        runAttemptFn: runFn,
        apiExec,
      });
      const tickPromise = sched.tick();
      await new Promise((r) => setTimeout(r, 20));
      expect(sched.state.running.size).toBe(1);
      sched.stop();
      await sched.drain(5000);
      await tickPromise;
      expect(sched.state.running.size).toBe(0);
      expect(calls.find((a) => a.includes("session.remove"))?.at(-1)).toBe(
        "sessionID=ses_shutdown1",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sweeps terminal workspaces periodically even if the task left running earlier", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 1;
      const done = makeTask({ id: "9", identifier: "ENG-9", state: "Done" });
      const active: Task[] = [];
      const tracker = mockTracker(active);
      let sweepSeen = 0;
      (tracker as { fetchIssuesByStates: unknown }).fetchIssuesByStates = async () => {
        sweepSeen++;
        return [done];
      };
      const wsPath = resolveWorkspacePath(done.identifier, config.workspace.root);
      mkdirSync(dirname(wsPath), { recursive: true });
      mkdirSync(wsPath, { recursive: true });
      const sched = new Scheduler({
        tracker,
        config: () => config,
        logger,
        runAttemptFn: (async () => ({
          status: "succeeded",
          error: null,
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          session_id: null,
          started_at: Date.now(),
          ended_at: Date.now(),
        })) as never,
      });
      for (let i = 0; i < 9; i++) await sched.tick();
      expect(existsSync(wsPath)).toBe(true);
      expect(sweepSeen).toBe(0);
      await sched.tick();
      expect(sweepSeen).toBe(1);
      expect(existsSync(wsPath)).toBe(false);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("deletes the orphan opencode session when a failed attempt will be retried fresh", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 1;
      const task = makeTask({ id: "1", state: "In Progress" });
      const tracker = mockTracker([task]);
      const runFn = (async () => ({
        status: "failed",
        error: "boom",
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        session_id: "ses_orphan1",
        started_at: Date.now(),
        ended_at: Date.now(),
      })) as never;
      const calls: string[][] = [];
      const apiExec = (async (args: string[]) => {
        calls.push(args);
        return { exitCode: 0, stdout: "{}", stderr: "", timedOut: false };
      }) as never;
      const sched = new Scheduler({
        tracker,
        config: () => config,
        logger,
        runAttemptFn: runFn,
        apiExec,
      });
      await sched.tick();
      await new Promise((r) => setTimeout(r, 30));
      const remove = calls.find((a) => a.includes("session.remove"));
      expect(remove).toBeDefined();
      expect(remove?.[remove.length - 1]).toBe("sessionID=ses_orphan1");
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the session when an attempt succeeds (continuation reuses it)", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 1;
      const task = makeTask({ id: "1", state: "In Progress" });
      const tracker = mockTracker([task]);
      const runFn = (async () => ({
        status: "succeeded",
        error: null,
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        session_id: "ses_keep1",
        started_at: Date.now(),
        ended_at: Date.now(),
      })) as never;
      const calls: string[][] = [];
      const apiExec = (async (args: string[]) => {
        calls.push(args);
        return { exitCode: 0, stdout: "{}", stderr: "", timedOut: false };
      }) as never;
      const sched = new Scheduler({
        tracker,
        config: () => config,
        logger,
        runAttemptFn: runFn,
        apiExec,
      });
      await sched.tick();
      await new Promise((r) => setTimeout(r, 30));
      expect(calls.find((a) => a.includes("session.remove"))).toBeUndefined();
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes null session_id on stalled retry", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 1;
      config.opencode.stall_timeout_ms = 1;
      const task = makeTask({ id: "1", state: "In Progress" });
      const tracker = mockTracker([task]);
      const neverResolve = () => new Promise(() => {});
      const sched = makeScheduler(tracker, config, undefined, neverResolve as never);
      await sched.tick();
      await new Promise((r) => setTimeout(r, 50));
      await sched.reconcileRunningIssues();
      const retryEntry = sched.state.retry_attempts.get(task.id);
      expect(retryEntry?.session_id).toBeNull();
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("shares one seen-message map across a task's attempts (continuation dedup)", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 1;
      const task = makeTask({ id: "dedup-1", state: "In Progress" });
      const tracker = mockTracker([task]);
      const maps: Array<Map<string, string> | undefined> = [];
      const runFn = (async (opts: { seenMessages?: Map<string, string> }) => {
        maps.push(opts.seenMessages);
        return {
          status: "succeeded",
          error: null,
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          session_id: "ses_dedup",
          started_at: Date.now(),
          ended_at: Date.now(),
        };
      }) as never;
      vi.useFakeTimers();
      const sched = new Scheduler({ tracker, config: () => config, logger, runAttemptFn: runFn });
      await sched.tick();
      await vi.advanceTimersByTimeAsync(2000);
      expect(maps.length).toBeGreaterThanOrEqual(2);
      expect(maps[0]).toBeDefined();
      expect(maps[1]).toBe(maps[0]);
      sched.stop();
      vi.useRealTimers();
    } finally {
      vi.useRealTimers();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("approvalEvents carry the task id (binding lookups need issue_id)", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 1;
      config.opencode.permission_timeout_ms = 600000;
      const task = makeTask({ id: "10101", state: "In Progress" });
      const tracker = mockTracker([task]);
      const seen: Array<{ id: string; identifier: string }> = [];
      const runFn = (async (opts: {
        onPendingPermissions?: (p: unknown[]) => void;
      }) => {
        opts.onPendingPermissions?.([
          { id: "per_x", sessionID: "ses_x", action: "shell", resources: ["echo x"] },
        ]);
        return {
          status: "succeeded",
          error: null,
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          session_id: "ses_x",
          started_at: Date.now(),
          ended_at: Date.now(),
        };
      }) as never;
      const sched = new Scheduler({
        tracker,
        config: () => config,
        logger,
        runAttemptFn: runFn,
        approvalEvents: (t, _event) => {
          seen.push(t);
        },
      });
      await sched.tick();
      await new Promise((r) => setTimeout(r, 50));
      expect(seen[0]?.id).toBe("10101");
      expect(seen[0]?.identifier).toBe("ENG-1");
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not terminate a run waiting for approval (stall skips it)", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 1;
      config.opencode.stall_timeout_ms = 1;
      const task = makeTask({ id: "1", state: "In Progress" });
      const tracker = mockTracker([task]);
      const neverResolve = () => new Promise(() => {});
      const sched = makeScheduler(tracker, config, undefined, neverResolve as never);
      await sched.tick();
      const entry = sched.state.running.get(task.id);
      expect(entry).toBeDefined();
      if (entry) {
        entry.waiting_approval = true;
        entry.waiting_since = Date.now();
        entry.last_event_at = Date.now() - 10_000;
      }
      await new Promise((r) => setTimeout(r, 50));
      await sched.reconcileRunningIssues();
      expect(sched.state.running.get(task.id)).toBeDefined();
      expect(sched.state.retry_attempts.get(task.id)).toBeUndefined();
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("full chain — continuation retry propagates session_id to runAttempt", async () => {
    const root = tempRoot();
    vi.useFakeTimers();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 1;
      const task = makeTask({ id: "1", state: "In Progress" });
      const tracker = mockTracker([task]);
      const capturedSessions: (string | null)[] = [];
      const runFn = (async (opts: { sessionId?: string | null }) => {
        capturedSessions.push(opts.sessionId ?? null);
        return {
          status: "succeeded",
          error: null,
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          session_id: "ses_chain_123",
          started_at: Date.now(),
          ended_at: Date.now(),
        };
      }) as never;
      const sched = makeScheduler(tracker, config, undefined, runFn);
      await sched.tick();
      expect(capturedSessions).toEqual([null]);
      const retryEntry = sched.state.retry_attempts.get(task.id);
      expect(retryEntry?.session_id).toBe("ses_chain_123");
      vi.advanceTimersByTime(1100);
      await vi.advanceTimersByTimeAsync(0);
      expect(capturedSessions).toHaveLength(2);
      expect(capturedSessions[1]).toBe("ses_chain_123");
      sched.stop();
    } finally {
      vi.useRealTimers();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("full chain — failure retry propagates null session_id to runAttempt", async () => {
    const root = tempRoot();
    vi.useFakeTimers();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 1;
      const task = makeTask({ id: "1", state: "In Progress" });
      const tracker = mockTracker([task]);
      const capturedSessions: (string | null)[] = [];
      const runFn = (async (opts: { sessionId?: string | null }) => {
        capturedSessions.push(opts.sessionId ?? null);
        return {
          status: "failed",
          error: "boom",
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          session_id: "ses_fail_456",
          started_at: Date.now(),
          ended_at: Date.now(),
        };
      }) as never;
      const sched = makeScheduler(tracker, config, undefined, runFn);
      await sched.tick();
      expect(capturedSessions).toEqual([null]);
      const retryEntry = sched.state.retry_attempts.get(task.id);
      expect(retryEntry?.session_id).toBeNull();
      vi.advanceTimersByTime(10500);
      await vi.advanceTimersByTimeAsync(0);
      expect(capturedSessions).toHaveLength(2);
      expect(capturedSessions[1]).toBeNull();
      sched.stop();
    } finally {
      vi.useRealTimers();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("normalizeState", () => {
  it("trims and lowercases", () => {
    expect(normalizeState("  In Progress ")).toBe("in progress");
  });

  it("handles empty string", () => {
    expect(normalizeState("")).toBe("");
  });
});

describe("P1 bug fixes", () => {
  it("tick validates dispatch config and skips on failure", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.tracker.api_key = null;
      const task = makeTask({ id: "1", state: "In Progress" });
      const tracker = mockTracker([task]);
      const sched = makeScheduler(tracker, config);
      await sched.tick();
      expect(sched.state.running.size).toBe(0);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("turn_count increments on turn_started event", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 3;
      const task = makeTask({ id: "1", state: "In Progress" });
      const tracker = mockTracker([task]);
      const events: { event: string; turn?: number }[] = [];
      const runFn = (async (opts: {
        events?: { onEvent?: (e: { event: string; turn?: number }) => void };
      }) => {
        opts.events?.onEvent?.({ event: "turn_started", turn: 1 });
        opts.events?.onEvent?.({ event: "turn_started", turn: 2 });
        opts.events?.onEvent?.({ event: "turn_started", turn: 3 });
        return new Promise(() => {});
      }) as never;
      const sched = makeScheduler(tracker, config, undefined, runFn);
      await sched.tick();
      const entry = sched.state.running.get("1");
      expect(entry?.turn_count).toBe(3);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accumulates step_usage into the running entry without double counting", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      const task = makeTask({ id: "1", state: "In Progress" });
      const tracker = mockTracker([task]);
      const runFn = (async (opts: {
        events?: {
          onEvent?: (e: {
            event: string;
            usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
          }) => void;
        };
      }) => {
        opts.events?.onEvent?.({
          event: "step_usage",
          usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
        });
        opts.events?.onEvent?.({
          event: "step_usage",
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        });
        opts.events?.onEvent?.({ event: "turn_completed" });
        return new Promise(() => {});
      }) as never;
      const sched = makeScheduler(tracker, config, undefined, runFn);
      await sched.tick();
      const entry = sched.state.running.get("1");
      expect(entry?.input_tokens).toBe(110);
      expect(entry?.output_tokens).toBe(55);
      expect(entry?.total_tokens).toBe(165);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("continuation retry uses backoff for attempt > 1", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 1;
      const task = makeTask({ id: "1", state: "In Progress" });
      const tracker = mockTracker([task]);
      const runFn = (async () => ({
        status: "succeeded",
        error: null,
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        session_id: null,
        started_at: Date.now(),
        ended_at: Date.now(),
      })) as never;
      const sched = makeScheduler(tracker, config, undefined, runFn);
      await sched.tick();
      const entry = sched.state.retry_attempts.get("1");
      expect(entry?.continuation).toBe(true);
      expect(entry?.attempt).toBe(1);
      const delay = entry?.due_at_ms ? entry.due_at_ms - Date.now() : 0;
      expect(delay).toBeLessThanOrEqual(1500);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("hasStateSlot falls back to global when state not in map", () => {
    const config = makeConfig("/tmp");
    const task = makeTask({ state: "Review" });
    const state = {
      running: new Map(),
      claimed: new Set<string>(),
      retry_attempts: new Map(),
      completed: new Set<string>(),
      totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_running: 0 },
      forward_interval_ms: 30000,
      sweep_interval_ms: 60000,
      max_concurrent_agents: 2,
    };
    expect(hasStateSlot(task, state, config)).toBe(true);
  });

  it("requestRefresh sets flag and returns coalesce status", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      let polls = 0;
      const tracker: TrackerPort = {
        fetchCandidateIssues: async () => {
          polls++;
          return [];
        },
        fetchIssuesByStates: async () => [],
        fetchIssueStatesByIds: async () => [],
      };
      const sched = makeScheduler(tracker, config);
      const first = sched.requestRefresh();
      const second = sched.requestRefresh();
      expect(first).toBe(true);
      expect(second).toBe(false);
      await vi.waitFor(() => expect(polls).toBe(1));
      await new Promise((r) => setTimeout(r, 20));
      expect(polls).toBe(1);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("requestRefresh triggers an immediate tick without waiting for the interval", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.polling.interval_ms = 600000;
      let polls = 0;
      const tracker: TrackerPort = {
        fetchCandidateIssues: async () => {
          polls++;
          return [];
        },
        fetchIssuesByStates: async () => [],
        fetchIssueStatesByIds: async () => [],
      };
      const sched = makeScheduler(tracker, config);
      expect(polls).toBe(0);
      expect(sched.requestRefresh()).toBe(true);
      await vi.waitFor(() => expect(polls).toBe(1));
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refresh arriving mid-tick re-runs the tick immediately after it completes", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => {
        release = r;
      });
      let entered = false;
      let polls = 0;
      const tracker: TrackerPort = {
        fetchCandidateIssues: async () => {
          polls++;
          if (polls === 1) {
            entered = true;
            await gate;
          }
          return [];
        },
        fetchIssuesByStates: async () => [],
        fetchIssueStatesByIds: async () => [],
      };
      const sched = makeScheduler(tracker, config);
      const firstTick = sched.tick();
      await vi.waitFor(() => expect(entered).toBe(true));
      sched.requestRefresh();
      release();
      await firstTick;
      await vi.waitFor(() => expect(polls).toBe(2));
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a tick triggered while another tick is in flight is skipped", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => {
        release = r;
      });
      let entered = false;
      let polls = 0;
      const tracker: TrackerPort = {
        fetchCandidateIssues: async () => {
          polls++;
          entered = true;
          await gate;
          return [];
        },
        fetchIssuesByStates: async () => [],
        fetchIssueStatesByIds: async () => [],
      };
      const sched = makeScheduler(tracker, config);
      const firstTick = sched.tick();
      await vi.waitFor(() => expect(entered).toBe(true));
      let secondDone = false;
      const secondTick = sched.tick().then(() => {
        secondDone = true;
      });
      await new Promise((r) => setImmediate(r));
      expect(secondDone).toBe(true);
      expect(polls).toBe(1);
      release();
      await firstTick;
      expect(polls).toBe(1);
      await secondTick;
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reconcile terminates missing issues from tracker", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      const task = makeTask({ id: "1", state: "In Progress" });
      let inTracker = true;
      const tracker: TrackerPort = {
        fetchCandidateIssues: async () => (inTracker ? [task] : []),
        fetchIssuesByStates: async () => [],
        fetchIssueStatesByIds: async () => (inTracker ? [task] : []),
      };
      const neverResolve = () => new Promise(() => {});
      const sched = makeScheduler(tracker, config, undefined, neverResolve as never);
      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      inTracker = false;
      await sched.tick();
      expect(sched.state.running.size).toBe(0);
      expect(sched.state.claimed.has("1")).toBe(false);
      assertClaimedInvariant(sched.state);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("isRoutable", () => {
  it("returns true when no required labels and no assignee configured", () => {
    const config = makeConfig("/tmp");
    const task = makeTask({ labels: ["bug"], assignee: "bob" });
    expect(isRoutable(task, config)).toBe(true);
  });

  it("returns false when required label is missing", () => {
    const config = makeConfig("/tmp");
    config.tracker.required_labels = ["urgent"];
    const task = makeTask({ labels: ["bug"] });
    expect(isRoutable(task, config)).toBe(false);
  });

  it("returns false when assignee configured but task has no assignee", () => {
    const config = makeConfig("/tmp");
    config.tracker.assignee = "bob";
    const task = makeTask({ assignee: null });
    expect(isRoutable(task, config)).toBe(false);
  });

  it("returns true when assignee configured and task has assignee", () => {
    const config = makeConfig("/tmp");
    config.tracker.assignee = "bob";
    const task = makeTask({ assignee: "bob" });
    expect(isRoutable(task, config)).toBe(true);
  });
});

describe("reconcile routability", () => {
  it("stops worker when required label is removed mid-run", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.tracker.required_labels = ["urgent"];
      const task = makeTask({ id: "1", state: "In Progress", labels: ["urgent"] });
      let labels = ["urgent"];
      const tracker: TrackerPort = {
        fetchCandidateIssues: async () => [{ ...task, labels: [...labels] }],
        fetchIssuesByStates: async () => [],
        fetchIssueStatesByIds: async () => [{ ...task, labels: [...labels] }],
      };
      const neverResolve = () => new Promise(() => {});
      const sched = makeScheduler(tracker, config, undefined, neverResolve as never);
      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      labels = [];
      await sched.tick();
      expect(sched.state.running.size).toBe(0);
      expect(sched.state.claimed.has("1")).toBe(false);
      assertClaimedInvariant(sched.state);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stops worker when assignee is changed mid-run", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.tracker.assignee = "bob";
      const task = makeTask({ id: "1", state: "In Progress", assignee: "bob" });
      let currentAssignee: string | null = "bob";
      const tracker: TrackerPort = {
        fetchCandidateIssues: async () => [{ ...task, assignee: currentAssignee }],
        fetchIssuesByStates: async () => [],
        fetchIssueStatesByIds: async () => [{ ...task, assignee: currentAssignee }],
      };
      const neverResolve = () => new Promise(() => {});
      const sched = makeScheduler(tracker, config, undefined, neverResolve as never);
      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      currentAssignee = "charlie";
      await sched.tick();
      expect(sched.state.running.size).toBe(0);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("activity + model writeback", () => {
  it("writes agent/model/variant to entry on turn_started and wires onActivity", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_turns = 1;
      const task = makeTask({ id: "1", state: "In Progress" });
      const tracker = mockTracker([task]);
      let onActivityWired: ((e: { ts: number; turn: number; type: string }) => void) | null = null;
      let modelAfterEvent: string | null | undefined = undefined;
      const holder: { sched?: Scheduler } = {};
      const runFn = (async (opts: {
        events?: { onEvent?: (e: Record<string, unknown>) => void };
        onActivity?: (e: { ts: number; turn: number; type: string }) => void;
      }) => {
        onActivityWired = opts.onActivity ?? null;
        opts.events?.onEvent?.({
          event: "turn_started",
          timestamp: Date.now(),
          message: "turn 1 of 1",
          agent: "build",
          model: "anthropic/claude-sonnet-4-5",
          variant: "high",
        });
        const entry = holder.sched?.state.running.get(task.id);
        modelAfterEvent = entry?.model;
        opts.onActivity?.({ ts: Date.now(), turn: 1, type: "text", text: "hi" });
        return {
          status: "succeeded",
          error: null,
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          session_id: null,
          started_at: Date.now(),
          ended_at: Date.now(),
        };
      }) as never;
      const sched = new Scheduler({ tracker, config: () => config, logger, runAttemptFn: runFn });
      holder.sched = sched;
      await sched.tick();
      expect(modelAfterEvent).toBe("anthropic/claude-sonnet-4-5");
      expect(onActivityWired).not.toBeNull();
      expect(sched.activityStore.recent(task.id)).toEqual([]);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
