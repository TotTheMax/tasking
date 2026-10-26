/**
 * Real Feishu approval-card smoke (semi-automated, human clicks).
 *
 * Gate: INTEGRATION=1 CARD_SMOKE=1. Requires the test app to have the
 * card.action.trigger callback subscribed (long-connection mode).
 *
 * It posts a real approval card into the intake group through the real
 * Feishu API, then the human clicks "允许一次" twice. The click travels
 * the real WS event channel -> event-channel router -> CommentBridge
 * approve_* handler -> ApprovalCoordinator.reply, and the resolution
 * stamps the card in place via a real updateCard call.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FeishuSource } from "../src/adapters/feishu/source.js";
import { BindingStore } from "../src/bridge/binding-store.js";
import { CommentBridge } from "../src/bridge/comment-bridge.js";
import { startEventChannel } from "../src/cli/event-channel.js";
import type { EffectiveConfig } from "../src/config/config-types.js";
import { resolveConfig } from "../src/config/resolver.js";
import { buildApprovalCard } from "../src/direct/card.js";
import { ApprovalCoordinator } from "../src/driver/approval.js";
import { ConsoleLogger } from "../src/observability/logger.js";
import {
  assertE2ECredsComplete,
  loadE2ECredsEnvFile,
  resolveE2ECreds,
} from "./helpers/e2e-creds.js";

const logger = new ConsoleLogger({});
loadE2ECredsEnvFile();
const CREDS = resolveE2ECreds(process.env);
const enabled = process.env.INTEGRATION === "1" && process.env.CARD_SMOKE === "1";
if (enabled) assertE2ECredsComplete(CREDS);

describe.skipIf(!enabled)("real Feishu approval-card smoke (semi-automated)", () => {
  it("a real button click replies once, dedups the second click, and stamps the card", async () => {
    const suffix = Date.now().toString(36);
    const requestID = `per_smoke_${suffix}`;
    const root = mkdtempSync(join(tmpdir(), "tasking-card-smoke-"));
    const bindings = new BindingStore(join(root, "b.db"));
    const config: EffectiveConfig = resolveConfig(
      {
        tracker: { kind: "none" },
        feishu: {
          enabled: true,
          app_id: CREDS.feishuAppId,
          app_secret: CREDS.feishuAppSecret,
          intake_chat_id: CREDS.feishuIntakeChatId,
        },
      },
      "/tmp",
      "prompt",
    );
    const feishu = new FeishuSource(config.feishu, logger);

    const replies: Array<{ requestID: string; decision: string }> = [];
    const stampErrors: string[] = [];
    let cardMessageId: string | null = null;
    const coordinator = new ApprovalCoordinator({
      replyPermission: async (_sessionId, id, decision) => {
        replies.push({ requestID: id, decision });
      },
      onCardResolved: async (id, state, decision) => {
        if (cardMessageId === null) return;
        const resolution =
          state === "replied" &&
          (decision === "once" || decision === "always" || decision === "reject")
            ? { state: "replied" as const, decision }
            : { state: state as "expired" | "cancelled" | "external" };
        try {
          await feishu.updateCard(
            cardMessageId,
            buildApprovalCard(
              {
                rootId: anchorId,
                turn: 0,
                requestID: id,
                action: "shell",
                resources: ["echo smoke"],
              },
              resolution,
            ),
          );
        } catch (e) {
          stampErrors.push(e instanceof Error ? e.message : String(e));
        }
      },
    });
    const bridge = new CommentBridge({
      tracker: null,
      feishu,
      bindings,
      config: () => config,
      logger,
      approvals: { reply: (id, decision) => coordinator.reply(id, decision) },
    });

    let anchorId = "";
    const listener = startEventChannel({ config, bridge, logger });

    try {
      expect(listener).not.toBeNull();
      anchorId = await feishu.postMessage(
        CREDS.feishuIntakeChatId,
        `🔐 审批卡片冒烟锚点 ${suffix}（请勿回复本消息）`,
      );
      coordinator.ingest("ses_smoke", [
        {
          id: requestID,
          sessionID: "ses_smoke",
          action: "shell",
          resources: ["echo smoke"],
          save: ["echo *"],
        },
      ]);
      const posted = await feishu.replyCardFlat(
        anchorId,
        buildApprovalCard({
          rootId: anchorId,
          turn: 0,
          requestID,
          action: "shell",
          resources: ["echo smoke"],
          save: ["echo *"],
          kind: "bridge",
        }),
      );
      cardMessageId = posted.message_id;
      logger.info(">>> 审批卡已发到群「Tasking-Intake-Test」");
      logger.info(">>> 请点卡片上的『✅ 允许一次』，然后再点一次同一按钮（验证去重）");
      logger.info(`>>> requestID=${requestID}`);

      const deadline = Date.now() + 360_000;
      while (replies.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(replies.length, "no click received within 6 minutes").toBeGreaterThan(0);

      await new Promise((r) => setTimeout(r, 8_000));
      expect(replies).toHaveLength(1);
      expect(replies[0]?.requestID).toBe(requestID);
      expect(replies[0]?.decision).toBe("once");
      expect(stampErrors).toEqual([]);
      logger.info("card smoke verified: click -> WS router -> coordinator reply once, stamped");
    } finally {
      listener?.stop();
      bindings.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 420_000);
});
