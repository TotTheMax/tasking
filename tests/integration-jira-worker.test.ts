/**
 * Jira-path real end-to-end (INTEGRATION=1 JIRA_WORKER=1).
 *
 * The structured path against real infrastructure:
 *   create a real issue in the Jira TEST project -> the scheduler polls it
 *   as a candidate -> dispatches -> the worker creates a workspace, injects
 *   the Jira MCP config and drives a REAL opencode v2 turn -> the agent
 *   creates a file in the workspace -> the attempt succeeds and the session
 *   sidecar is written -> the issue is transitioned to a terminal state ->
 *   the next tick reconciles and removes the workspace (and deletes the
 *   session).
 *
 * The issue is deleted in a finally block (create-then-delete, ADR 0015).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JiraTracker } from "../src/adapters/jira/tracker.js";
import type { EffectiveConfig } from "../src/config/config-types.js";
import { resolveConfig } from "../src/config/resolver.js";
import { ConsoleLogger } from "../src/observability/logger.js";
import { Scheduler } from "../src/scheduler/scheduler.js";
import { runAttempt } from "../src/worker/runner.js";
import { resolveWorkspacePath } from "../src/workspace/manager.js";
import {
  assertE2ECredsComplete,
  loadE2ECredsEnvFile,
  resolveE2ECreds,
} from "./helpers/e2e-creds.js";

const logger = new ConsoleLogger({});
loadE2ECredsEnvFile();
const CREDS = resolveE2ECreds(process.env);
const enabled = process.env.INTEGRATION === "1" && process.env.JIRA_WORKER === "1";
if (enabled) assertE2ECredsComplete(CREDS);

const MODEL = process.env.OPENCODE_SMOKE_MODEL ?? "opencode/deepseek-v4.1-flash-free";

async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

describe.skipIf(!enabled)("Jira path real E2E (scheduler -> worker -> opencode)", () => {
  it("dispatches a real issue, runs a real opencode turn, and cleans up on terminal", async () => {
    const suffix = Date.now().toString(36);
    const label = `tasking-e2e-${suffix}`;
    const root = mkdtempSync(join(tmpdir(), "tasking-jira-worker-"));
    const tracker = new JiraTracker({
      kind: "jira",
      endpoint: CREDS.jiraEndpoint,
      api_key: CREDS.jiraApiKey,
      api_user: "agent@example.com",
      auth_mode: "bearer",
      review_state: null,
      project_key: CREDS.jiraProjectKey,
      project_slug: null,
      assignee: null,
      required_labels: [],
      active_states: ["待办", "处理中"],
      terminal_states: ["完成", "关闭"],
    } as EffectiveConfig["tracker"]);
    const config: EffectiveConfig = resolveConfig(
      {
        tracker: {
          kind: "jira",
          endpoint: CREDS.jiraEndpoint,
          api_key: CREDS.jiraApiKey,
          api_user: "agent@example.com",
          auth_mode: "bearer",
          project_key: CREDS.jiraProjectKey,
          required_labels: [label],
          active_states: ["待办", "处理中"],
          terminal_states: ["完成", "关闭"],
        },
        workspace: { root },
        agent: { max_turns: 1, max_concurrent_agents: 1, max_retry_backoff_ms: 5000 },
        opencode: {
          command: "opencode",
          model: MODEL,
          auto_approve: true,
          turn_timeout_ms: 300_000,
        },
        feishu: { enabled: false },
      },
      "/tmp",
      "在当前目录创建文件 jira_e2e.txt，内容为 hi。完成后停止，不要做其他事情。",
    );

    let issueKey: string | null = null;
    let issueId: string | null = null;
    let sched: Scheduler | null = null;
    try {
      const created = await tracker.createIssue({
        project: { key: CREDS.jiraProjectKey },
        summary: `tasking jira-worker e2e ${suffix}`,
        description: "scheduler -> worker -> real opencode probe",
        issuetype: { name: "任务" },
        labels: [label],
      });
      issueKey = created.key;
      issueId = created.id;
      logger.info(`>>> created ${issueKey}`);

      const fetched = await tracker.fetchIssueStatesByIds([issueId]);
      logger.info(`>>> created state: ${fetched[0]?.state ?? "unknown"}`);
      if (!config.tracker.active_states.includes(fetched[0]?.state ?? "")) {
        const transitions = await tracker.fetchTransitions(issueKey);
        const toActive = transitions.find((t) => config.tracker.active_states.includes(t.toName));
        if (toActive) {
          await tracker.transitionIssue(issueKey, toActive.id);
          logger.info(`>>> transitioned to active via ${toActive.name}`);
        }
      }

      sched = new Scheduler({
        tracker,
        config: () => config,
        logger,
        runAttemptFn: runAttempt,
      });

      const wsPath = resolveWorkspacePath(issueKey, root);
      await sched.tick();
      logger.info(">>> dispatched; waiting for the real turn");
      await waitFor(() => existsSync(join(wsPath, ".tasking-session.json")), 300_000);
      await waitFor(() => existsSync(join(wsPath, "jira_e2e.txt")), 60_000);
      const sidecar = JSON.parse(readFileSync(join(wsPath, ".tasking-session.json"), "utf8")) as {
        session_id?: string;
      };
      const fileContent = readFileSync(join(wsPath, "jira_e2e.txt"), "utf8");
      logger.info(`>>> turn done: session=${sidecar.session_id ?? "?"} file=${fileContent.trim()}`);
      expect(sidecar.session_id).toBeTruthy();
      expect(fileContent).toContain("hi");

      let reachedTerminal = false;
      const statusOrder = ["待办", "处理中", "代码评审中", "合并中"];
      for (let hop = 0; hop < 6 && !reachedTerminal; hop++) {
        const transitions = await tracker.fetchTransitions(issueKey);
        const toTerminal = transitions.find((t) =>
          config.tracker.terminal_states.includes(t.toName),
        );
        if (toTerminal) {
          await tracker.transitionIssue(issueKey, toTerminal.id);
          reachedTerminal = true;
          logger.info(`>>> transitioned to terminal via ${toTerminal.name}`);
          break;
        }
        const current = (await tracker.fetchIssueStatesByIds([issueId]))[0]?.state ?? "";
        const currentIdx = statusOrder.indexOf(current);
        const next = statusOrder
          .slice(currentIdx + 1)
          .find((s) => transitions.some((t) => t.toName === s));
        if (!next) break;
        const hopTransition = transitions.find((t) => t.toName === next);
        if (!hopTransition) break;
        await tracker.transitionIssue(issueKey, hopTransition.id);
        logger.info(`>>> workflow hop ${current} -> ${next}`);
      }
      expect(reachedTerminal, "could not reach a terminal state").toBe(true);
      logger.info(">>> transitioned to terminal; waiting for cleanup");
      await waitFor(() => !existsSync(wsPath), 120_000);
      logger.info("jira worker E2E verified end to end");
    } finally {
      sched?.stop();
      if (issueKey) {
        await fetch(`${CREDS.jiraEndpoint.replace(/\/+$/, "")}/issue/${issueKey}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${CREDS.jiraApiKey}` },
        }).catch(() => {});
      }
      rmSync(root, { recursive: true, force: true });
    }
  }, 600_000);
});
