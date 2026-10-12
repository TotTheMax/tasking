import {
  type FeishuCardAction,
  FeishuEventListener,
  type FeishuEventListenerDeps,
} from "../adapters/feishu/events.js";
import type { CommentBridge } from "../bridge/comment-bridge.js";
import type { EffectiveConfig } from "../config/config-types.js";
import type { Logger } from "../observability/logger.js";
import type { CardActionReply } from "../shared/info-card.js";
import { translateCard } from "../translate/card.js";
import { translate } from "../translate/locale.js";

export interface EventChannelWiring {
  config: EffectiveConfig;
  bridge: CommentBridge;
  direct?: { handleCardAction(action: FeishuCardAction): Promise<CardActionReply | undefined> };
  logger: Logger;
  clientFactory?: FeishuEventListenerDeps["clientFactory"];
}

function wrapCardReply(replyPromise: Promise<CardActionReply | undefined>): Promise<unknown> {
  return replyPromise.then((reply) =>
    reply === undefined
      ? undefined
      : {
          toast: reply.toast === undefined ? undefined : translateToast(reply.toast),
          ...(reply.card === undefined
            ? {}
            : { card: { type: "raw", data: translateCard(reply.card) } }),
        },
  );
}

function translateToast(toast: NonNullable<CardActionReply["toast"]>): CardActionReply["toast"] {
  return { ...toast, content: translate(toast.content) };
}

export function startEventChannel(wiring: EventChannelWiring): FeishuEventListener | null {
  const { config, bridge, direct, logger, clientFactory } = wiring;
  if (!config.feishu.enabled) return null;
  const listener = new FeishuEventListener({
    appId: config.feishu.app_id ?? "",
    appSecret: config.feishu.app_secret ?? "",
    edition: config.feishu.edition,
    onMessage: (msg) => {
      void bridge.ingestMessage(msg).catch((e) =>
        logger.error("event ingest failed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    },
    onCardAction: (action) => {
      const kind = (action.value as { kind?: unknown } | null | undefined)?.kind;
      if (kind === "bridge") {
        return wrapCardReply(bridge.handleCardAction(action));
      }
      if (!direct)
        return {
          toast: translateToast({ type: "warning", content: "直连功能未启用" }),
        };
      return wrapCardReply(direct.handleCardAction(action));
    },
    onConnected: () => {
      void bridge.sweepNow();
    },
    logger,
    clientFactory,
  });
  listener.start();
  logger.info("feishu event channel starting");
  return listener;
}
