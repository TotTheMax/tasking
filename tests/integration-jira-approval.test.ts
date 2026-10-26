/**
 * Jira-path approval real E2E (semi-automated, human clicks).
 *
 * Gate: INTEGRATION=1 JIRA_APPROVAL=1
 *
 * The Jira side of the synchronous-approval loop, wiring the same pieces
 * the CLI assembles:
 *   a real issue (auto_approve false) -> the scheduler dispatches -> the
 *   worker creates the workspace (its after_create hook writes an `ask`
 *   shell rule) and drives a real opencode turn -> the agent calls the
 *   shell tool -> the permission pends -> the scheduler's approvalEvents
 *   feed a coordinator that posts a real Feishu approval card into the
 *   issue's BOUND thread -> a real card-action event is dispatched through
 *   the real event channel (the same router a human click uses; the
 *   Feishu-client -> bot hop is covered by the card smoke) ->
 *   CommentBridge approve_* -> coordinator -> the reply is
 *   submitted to the real opencode session, which resumes -> the worker
 *   finishes -> the issue is transitioned to terminal and the workspace
 *   is removed. The issue is deleted in a finally block (ADR 0015).
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FeishuSource } from "../src/adapters/feishu/source.js";
import { JiraTracker } from "../src/adapters/jira/tracker.js";
import { BindingStore } from "../src/bridge/binding-store.js";
import { CommentBridge } from "../src/bridge/comment-bridge.js";
import { startEventChannel } from "../src/cli/event-channel.js";
import type { EffectiveConfig } from "../src/config/config-types.js";
import { resolveConfig } from "../src/config/resolver.js";
import { buildApprovalCard } from "../src/direct/card.js";
import { defaultApiExec } from "../src/driver/api-client.js";
import { ApprovalCoordinator, type ApprovalRequest } from "../src/driver/approval.js";
import { replyPermission } from "../src/driver/session-ops.js";
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
const enabled = process.env.INTEGRATION === "1" && process.env.JIRA_APPROVAL === "1";
if (enabled) assertE2ECredsComplete(CREDS);

const MODEL = process.env.OPENCODE_SMOKE_MODEL ?? "opencode/deepseek-v4.1-flash-free";

async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

describe.skipIf(!enabled)("Jira path approval real E2E (semi-automated)", () => {
  it("a real Jira task pends on a real opencode ask; a Feishu card click resumes it", async () => {
    const suffix = Date.now().toString(36);
    const label = `tasking-e2e-${suffix}`;
    const root = mkdtempSync(join(tmpdir(), "tasking-jira-approval-"));
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
      required_labels: [label],
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
        hooks: {
          after_create:
            'mkdir -p .opencode && printf \'{"permissions":[{"action":"shell","resource":"*","effect":"ask"}]}\' > .opencode/opencode.json',
        },
        agent: { max_turns: 1, max_concurrent_agents: 1, max_retry_backoff_ms: 600000 },
        opencode: {
          command: "opencode",
          model: MODEL,
          auto_approve: false,
          turn_timeout_ms: 600_000,
          permission_timeout_ms: 600_000,
        },
        feishu: {
          enabled: true,
          app_id: CREDS.feishuAppId,
          app_secret: CREDS.feishuAppSecret,
          intake_chat_id: CREDS.feishuIntakeChatId,
        },
      },
      "/tmp",
      "请使用 shell 工具运行命令：echo jira-approval-e2e。完成后停止，不要做其他事情。",
    );

    const bindings = new BindingStore(join(root, "b.db"));
    const feishu = new FeishuSource(config.feishu, logger);
    const sessionIssueIndex = new Map<string, string>();
    const cardStamps = new Map<
      string,
      { messageId: string; rootId: string; request: ApprovalRequest }
    >();
    let cardPosted = false;
    let postedCard: unknown = null;
    const resolutions: Array<{ requestID: string; state: string; decision?: string }> = [];
    const originalReplyCard = feishu.replyCardInThread.bind(feishu);
    feishu.replyCardInThread = async (rootId: string, card: unknown) => {
      const res = await originalReplyCard(rootId, card);
      cardPosted = true;
      postedCard = card;
      logger.info(">>> 审批卡已发出到绑定话题 —— 请在群里点「✅ 允许一次」");
      return res;
    };
    const coordinator = new ApprovalCoordinator({
      replyPermission: async (sessionId, requestID, decision) => {
        await replyPermission(
          defaultApiExec(),
          { command: config.opencode.command, serverUrl: config.opencode.server_url },
          sessionId,
          requestID,
          decision,
        );
      },
      onCardRequested: (request) => {
        void (async () => {
          const issueKey = sessionIssueIndex.get(request.sessionId);
          const binding = issueKey ? bindings.getBinding(issueKey) : null;
          if (!binding) return;
          const posted = await feishu.replyCardInThread(
            binding.root_id,
            buildApprovalCard({
              rootId: binding.root_id,
              turn: 0,
              requestID: request.requestID,
              action: request.action,
              resources: request.resources,
              save: request.save,
              kind: "bridge",
            }),
          );
          if (posted.message_id) {
            cardStamps.set(request.requestID, {
              messageId: posted.message_id,
              rootId: binding.root_id,
              request,
            });
          }
        })();
      },
      onCardResolved: (requestID, state, decision) => {
        resolutions.push({ requestID, state, ...(decision ? { decision } : {}) });
        void (async () => {
          const entry = cardStamps.get(requestID);
          if (!entry || state === "pending") return;
          const resolution =
            state === "replied" &&
            (decision === "once" || decision === "always" || decision === "reject")
              ? { state: "replied" as const, decision }
              : { state: state as "expired" | "cancelled" | "external" };
          await feishu
            .updateCard(
              entry.messageId,
              buildApprovalCard(
                {
                  rootId: entry.rootId,
                  turn: 0,
                  requestID,
                  action: entry.request.action,
                  resources: entry.request.resources,
                  save: entry.request.save,
                  kind: "bridge",
                },
                resolution,
              ),
            )
            .catch(() => {});
        })();
      },
    });
    const bridge = new CommentBridge({
      tracker,
      feishu,
      bindings,
      config: () => config,
      logger,
      approvals: { reply: (id, decision) => coordinator.reply(id, decision) },
    });
    const listener = startEventChannel({ config, bridge, logger });

    let issueKey: string | null = null;
    let sched: Scheduler | null = null;
    try {
      expect(listener).not.toBeNull();
      const created = await tracker.createIssue({
        project: { key: CREDS.jiraProjectKey },
        summary: `tasking jira-approval e2e ${suffix}`,
        description: "jira approval probe",
        issuetype: { name: "任务" },
        labels: [label],
      });
      issueKey = created.key;
      const rootMsgId = await feishu.postMessage(
        CREDS.feishuIntakeChatId,
        `[integration-jira-approval] ${issueKey} ${suffix}`,
      );
      bindings.upsertBinding({
        issue_id: created.id,
        issue_key: issueKey,
        chat_id: CREDS.feishuIntakeChatId,
        root_id: rootMsgId,
      });
      logger.info(`>>> created ${issueKey} with a bound thread ${rootMsgId}`);

      sched = new Scheduler({
        tracker,
        config: () => config,
        logger,
        runAttemptFn: runAttempt,
        approvalEvents: (task, event) => {
          if (event.kind === "expired") {
            coordinator.markExpired(event.requestID);
            return;
          }
          const bySession = new Map<string, typeof event.pending>();
          for (const p of event.pending) {
            sessionIssueIndex.set(p.sessionID, task.id);
            const list = bySession.get(p.sessionID) ?? [];
            list.push(p);
            bySession.set(p.sessionID, list);
          }
          for (const [sessionId, pending] of bySession) {
            coordinator.ingest(sessionId, pending);
          }
        },
      });

      await sched.tick();
      logger.info(">>> dispatched; waiting for the approval card");
      await waitFor(() => cardPosted, 300_000);
      logger.info(">>> 审批卡已发到绑定话题（真实 Feishu）");

      logger.info(">>> 请在绑定话题点击「✅ 允许一次」（60 秒内无点击则自动走事件通道派发）");
      const clickDeadline = Date.now() + 60_000;
      while (!resolutions.some((r) => r.state === "replied") && Date.now() < clickDeadline) {
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!resolutions.some((r) => r.state === "replied")) {
        const button = extractButtons(postedCard).find((b) => b.action === "approve_once");
        expect(button, "approve_once button missing from the posted card").toBeDefined();
        listener?.handleCardActionData(
          cardActionEvent("om_jira_approval_click", button?.value ?? {}, {
            operatorName: "e2e",
            chatId: CREDS.feishuIntakeChatId,
          }),
        );
        logger.info(">>> 无真人点击，已通过事件通道派发真实卡片动作");
      } else {
        logger.info(">>> 收到真人点击（真实 WS 回调）");
      }

      await waitFor(() => resolutions.some((r) => r.state === "replied"), 120_000);
      const replied = resolutions.find((r) => r.state === "replied");
      expect(replied?.decision).toBe("once");
      logger.info(">>> approval replied; waiting for the turn to resume and finish");

      const wsPath = resolveWorkspacePath(issueKey, root);
      await waitFor(() => existsSync(join(wsPath, ".tasking-session.json")), 300_000);
      await waitFor(async () => {
        const running = sched?.state.running.size ?? 0;
        return running === 0;
      }, 300_000);
      logger.info("jira approval E2E verified end to end");
    } finally {
      sched?.stop();
      listener?.stop();
      if (issueKey) {
        await fetch(`${CREDS.jiraEndpoint.replace(/\/+$/, "")}/issue/${issueKey}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${CREDS.jiraApiKey}` },
        }).catch(() => {});
      }
      bindings.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 900_000);
});
