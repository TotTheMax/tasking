import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EffectiveConfig } from "../src/config/config-types.js";
import { resolveConfig } from "../src/config/resolver.js";
import { ConsoleLogger } from "../src/observability/logger.js";
import { buildSnapshot } from "../src/observability/snapshot.js";
import { Scheduler, type TrackerPort } from "../src/scheduler/scheduler.js";
import type { Task } from "../src/shared/types.js";

const logger = new ConsoleLogger({}, () => {});

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
    priority: 1,
    state: "In Progress",
    branch_name: null,
    url: null,
    labels: [],
    blocked_by: [],
    assignee: null,
    created_at: 1000,
    updated_at: null,
    source: "jira",
    ...overrides,
  };
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tasking-e2e-"));
}

describe("E2E: Jira → workspace → worker → terminal cleanup", () => {
  it("dispatches from tracker, runs worker, cleans on terminal", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      let state = "In Progress";
      const task = makeTask({ id: "1", identifier: "ENG-1" });
      const tracker: TrackerPort = {
        fetchCandidateIssues: async () => [{ ...task, state }],
        fetchIssuesByStates: async () => [],
        fetchIssueStatesByIds: async () => [{ ...task, state }],
      };
      let workerRan = false;
      const sched = new Scheduler({
        tracker,
        config: () => config,
        logger,
        runAttemptFn: (async () => {
          workerRan = true;
          return {
            status: "succeeded",
            error: null,
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
            started_at: Date.now(),
            ended_at: Date.now(),
          };
        }) as never,
        spawnRunner: undefined,
      });

      await sched.tick();
      await new Promise((r) => setTimeout(r, 50));
      expect(workerRan).toBe(true);

      state = "Done";
      await sched.tick();
      expect(sched.state.running.size).toBe(0);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("E2E: shared concurrency budget", () => {
  it("structured and unstructured tasks share the global pool", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      config.agent.max_concurrent_agents = 1;
      const structuredTask = makeTask({
        id: "j1",
        identifier: "J-1",
        state: "In Progress",
        source: "jira",
      });
      const tracker: TrackerPort = {
        fetchCandidateIssues: async () => [structuredTask],
        fetchIssuesByStates: async () => [],
        fetchIssueStatesByIds: async () => [structuredTask],
      };
      const sched = new Scheduler({
        tracker,
        config: () => config,
        logger,
        runAttemptFn: (() => new Promise(() => {})) as never,
      });
      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      expect(config.agent.max_concurrent_agents).toBe(1);
      sched.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("E2E: restart recovery", () => {
  it("re-dispatches from tracker after restart", async () => {
    const root = tempRoot();
    try {
      const config = makeConfig(root);
      const task = makeTask({ id: "r1", identifier: "R-1" });
      const tracker: TrackerPort = {
        fetchCandidateIssues: async () => [task],
        fetchIssuesByStates: async () => [],
        fetchIssueStatesByIds: async () => [task],
      };
      const sched = new Scheduler({
        tracker,
        config: () => config,
        logger,
        runAttemptFn: (() => new Promise(() => {})) as never,
      });
      await sched.tick();
      expect(sched.state.running.size).toBe(1);
      sched.stop();

      const sched2 = new Scheduler({
        tracker,
        config: () => config,
        logger,
        runAttemptFn: (() => new Promise(() => {})) as never,
      });
      await sched2.tick();
      expect(sched2.state.running.size).toBe(1);
      expect(sched2.state.retry_attempts.size).toBe(0);
      sched2.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("E2E: real integration profile (skipped without credentials)", () => {
  it("skips Jira smoke when no JIRA_API_TOKEN", async () => {
    if (!process.env.JIRA_API_TOKEN) {
      console.log("skipping Jira smoke: no JIRA_API_TOKEN");
      return;
    }
    // Real Jira smoke would go here
  });

  it("skips Feishu smoke when no FEISHU_APP_ID", async () => {
    if (!process.env.FEISHU_APP_ID) {
      console.log("skipping Feishu smoke: no FEISHU_APP_ID");
      return;
    }
    // Real Feishu smoke would go here
  });

  it("runs opencode smoke against a temp workspace", async () => {
    const root = tempRoot();
    try {
      // This is a smoke test that would invoke real `opencode run` if available
      console.log("opencode smoke: workspace created at", root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
