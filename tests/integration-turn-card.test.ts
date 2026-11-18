/**
 * Real Feishu turn-card smoke (fully automated, no human clicks).
 *
 * Gate: INTEGRATION=1 TURN_CARD_SMOKE=1. Requires the test app to be able to
 * send interactive cards into the intake group.
 *
 * It posts a real interleaved turn card, PATCHes it with a near-budget card,
 * posts a continuation segment card into the same thread, and asserts the real
 * API accepts all three (proving the card JSON, collapsible panels, buttons and
 * the measured ~24KB payload fit Feishu's 30KB limit). Messages are deleted in a
 * finally block. Visual correctness still needs the human final-only smoke.
 */
import { describe, expect, it } from "vitest";
import { type FeishuPolledMessage, FeishuSource } from "../src/adapters/feishu/source.js";
import type { EffectiveConfig } from "../src/config/config-types.js";
import { resolveConfig } from "../src/config/resolver.js";
import {
  CARD_BUDGET_BYTES,
  type TurnCardEvent,
  type TurnCardState,
  buildTurnCard,
  cardPayloadBytes,
} from "../src/direct/card.js";
import { ConsoleLogger } from "../src/observability/logger.js";
import {
  assertE2ECredsComplete,
  loadE2ECredsEnvFile,
  resolveE2ECreds,
} from "./helpers/e2e-creds.js";

const logger = new ConsoleLogger({}, () => {});
loadE2ECredsEnvFile();
const CREDS = resolveE2ECreds(process.env);
const enabled = process.env.INTEGRATION === "1" && process.env.TURN_CARD_SMOKE === "1";
if (enabled) assertE2ECredsComplete(CREDS);

function directConfig(): EffectiveConfig {
  return resolveConfig(
    {
      feishu: {
        enabled: true,
        app_id: CREDS.feishuAppId,
        app_secret: CREDS.feishuAppSecret,
        intake_chat_id: CREDS.feishuIntakeChatId,
        direct: { projects: {}, verbosity: "detailed" },
      },
    },
    "/tmp",
    "p",
  );
}

function toolEvent(index: number, outputSize = 800): TurnCardEvent {
  return {
    kind: "tool",
    tool: {
      tool: "bash",
      title: `smoke-tool-${index}`,
      status: "completed",
      exit: 0,
      durationMs: 42,
      input: { command: `echo smoke-${index}` },
      output: "x".repeat(outputSize),
    },
  };
}

function cardState(events: TurnCardEvent[], over: Partial<TurnCardState> = {}): TurnCardState {
  return {
    rootId: "om_turn_smoke",
    sessionName: "turn-card-smoke",
    sessionStatus: "running",
    turns: 1,
    totalTokens: 1200,
    queued: 0,
    turn: 1,
    phase: "running",
    toolCalls: events.filter((e) => e.kind === "tool").length,
    durationSec: 12,
    turnTokens: 900,
    events,
    ...over,
  };
}

async function waitFor(fn: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 500));
  }
}

describe.skipIf(!enabled)("real Feishu turn-card smoke (automated)", () => {
  it("accepts an interleaved card, a near-budget update and a continuation segment", async () => {
    const feishu = new FeishuSource(directConfig().feishu, logger);
    const rootId = await feishu.postMessage(
      CREDS.feishuIntakeChatId,
      `[integration-turn-card] ${Date.now()}`,
    );
    expect(rootId).not.toBe("");
    const posted: string[] = [];
    try {
      const interleaved = buildTurnCard(
        cardState([
          { kind: "text", text: "先看现状：" },
          toolEvent(1),
          { kind: "text", text: "再执行第二步：" },
          toolEvent(2),
        ]),
      );
      const first = await feishu.replyCardInThread(rootId, interleaved);
      expect(first.message_id).not.toBe("");
      posted.push(first.message_id);

      let count = 4;
      let nearState = cardState(Array.from({ length: count }, (_, i) => toolEvent(i, 900)));
      let near = buildTurnCard(nearState);
      while (cardPayloadBytes(near) < 20 * 1024 && count < 40) {
        count++;
        nearState = cardState(Array.from({ length: count }, (_, i) => toolEvent(i, 900)));
        near = buildTurnCard(nearState);
      }
      expect(cardPayloadBytes(near)).toBeLessThanOrEqual(CARD_BUDGET_BYTES);
      await expect(feishu.updateCard(first.message_id, near)).resolves.toBeUndefined();

      const continuation = buildTurnCard({ ...nearState, segment: 2 });
      const second = await feishu.replyCardInThread(rootId, continuation);
      expect(second.message_id).not.toBe("");
      expect(second.message_id).not.toBe(first.message_id);
      posted.push(second.message_id);

      const threadId = second.thread_id ?? first.thread_id;
      expect(threadId).not.toBeNull();
      let interactive: FeishuPolledMessage[] = [];
      await waitFor(async () => {
        const replies = await feishu.listThreadReplies(threadId ?? "", null);
        interactive = replies.filter((m) => m.msg_type === "interactive");
        return interactive.length >= 2;
      }, 15000);
      expect(interactive.length).toBeGreaterThanOrEqual(2);
    } finally {
      for (const id of posted) {
        try {
          await feishu.deleteMessage(id);
        } catch {
          void 0;
        }
      }
      try {
        await feishu.deleteMessage(rootId);
      } catch {
        void 0;
      }
    }
  }, 120_000);
});
