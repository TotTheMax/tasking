import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FeishuPolledMessage } from "../src/adapters/feishu/source.js";
import { BindingStore } from "../src/bridge/binding-store.js";
import { CommentBridge } from "../src/bridge/comment-bridge.js";
import { startEventChannel } from "../src/cli/event-channel.js";
import { resolveConfig } from "../src/config/resolver.js";
import { ConsoleLogger } from "../src/observability/logger.js";
import { setLocale } from "../src/translate/locale.js";

const logger = new ConsoleLogger({}, () => {});

describe("startEventChannel wiring", () => {
  let root: string;
  let bindings: BindingStore;
  let bridge: CommentBridge;
  let posted: string[];
  let config: ReturnType<typeof resolveConfig>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "tasking-ec-"));
    bindings = new BindingStore(join(root, "b.db"));
    config = resolveConfig(
      {
        tracker: { kind: "jira", api_key: "tok", project_key: "ENG" },
        feishu: {
          enabled: true,
          app_id: "c",
          app_secret: "s",
          intake_chat_id: "oc_intake",
          forward_interval_ms: 5000,
          sweep_interval_ms: 60000,
          create_issue_type: "Task",
        },
      },
      "/tmp",
      "prompt",
    );
    posted = [];
    const tracker = {
      postComment: async (_key: string, body: string) => {
        posted.push(body);
      },
    } as unknown as ConstructorParameters<typeof CommentBridge>[0]["tracker"];
    bridge = new CommentBridge({
      tracker,
      feishu: {} as never,
      bindings,
      config: () => config,
      logger,
    });
  });

  afterEach(() => {
    bridge.stop();
    bindings.close();
    rmSync(root, { recursive: true, force: true });
  });

  function msg(over: { message_id: string; root_id: string }): FeishuPolledMessage {
    return {
      message_id: over.message_id,
      root_id: over.root_id,
      parent_id: over.root_id,
      msg_type: "text",
      text: "event body",
      sender_open_id: null,
      sender_name: "User",
      sender_type: "user",
      create_time: "200",
      chat_id: "oc_intake",
    };
  }

  it("returns null when the feishu bridge is disabled", () => {
    const disabled = resolveConfig(
      {
        tracker: { kind: "jira", api_key: "tok", project_key: "ENG" },
        feishu: { enabled: false },
      },
      "/tmp",
      "prompt",
    );
    expect(startEventChannel({ config: disabled, bridge, logger })).toBeNull();
  });

  it("routes event messages into the bridge ingest queue", async () => {
    bindings.upsertBinding({
      issue_id: "1",
      issue_key: "ENG-1",
      chat_id: "oc_intake",
      root_id: "om_root",
      thread_id: "omt_root",
    });
    const listener = startEventChannel({
      config,
      bridge,
      logger,
      clientFactory: () => ({
        start: () => Promise.resolve(),
      }),
    });
    expect(listener).not.toBeNull();
    listener?.handleEventData({
      message: {
        message_id: "om_ev1",
        root_id: "om_root",
        parent_id: "om_root",
        message_type: "text",
        create_time: "1787814079103",
        chat_id: "oc_intake",
        content: JSON.stringify({ text: "event body" }),
      },
      sender: { sender_id: { open_id: "ou_u" }, sender_type: "user" },
    });
    await bridge.whenIdle();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("event body");
  });

  function cardPayload(): Record<string, unknown> {
    return {
      schema: "2.0",
      header: { event_type: "card.action.trigger", event_id: "e1" },
      event: {
        operator: { open_id: "ou_op" },
        action: { tag: "button", value: { action: "stop", root_id: "om_root", turn: 2 } },
        context: { open_message_id: "om_card", open_chat_id: "oc_intake" },
      },
    };
  }

  it("routes card actions straight to the direct handler, skipping the ingest queue", async () => {
    const seen: unknown[] = [];
    const listener = startEventChannel({
      config,
      bridge,
      logger,
      direct: {
        handleCardAction: async (action) => {
          seen.push(action.value);
          return { toast: { type: "success", content: "ok" }, card: { schema: "2.0", body: {} } };
        },
      },
      clientFactory: () => ({ start: () => Promise.resolve() }),
    });
    const response = listener?.handleCardActionData(cardPayload());
    expect(seen).toEqual([{ action: "stop", root_id: "om_root", turn: 2 }]);
    await expect(response).resolves.toEqual({
      toast: { type: "success", content: "ok" },
      card: { type: "raw", data: { schema: "2.0", body: {} } },
    });
    expect(posted).toHaveLength(0);
  });

  it("routes kind:bridge card actions to the bridge, not the direct handler", async () => {
    const bridgeSeen: unknown[] = [];
    const directSeen: unknown[] = [];
    bridge.handleCardAction = async (action) => {
      bridgeSeen.push(action.value);
      return { toast: { type: "success", content: "bridge ok" } };
    };
    const listener = startEventChannel({
      config,
      bridge,
      logger,
      direct: {
        handleCardAction: async (action) => {
          directSeen.push(action.value);
          return { toast: { type: "info", content: "direct" } };
        },
      },
      clientFactory: () => ({ start: () => Promise.resolve() }),
    });
    const response = listener?.handleCardActionData({
      schema: "2.0",
      header: { event_type: "card.action.trigger", event_id: "e2" },
      event: {
        operator: { open_id: "ou_op" },
        action: {
          tag: "button",
          value: { action: "full", kind: "bridge", issue_id: "1", comment_id: "9" },
        },
        context: { open_message_id: "om_card", open_chat_id: "oc_intake" },
      },
    });
    await expect(response).resolves.toEqual({ toast: { type: "success", content: "bridge ok" } });
    expect(bridgeSeen).toHaveLength(1);
    expect(directSeen).toHaveLength(0);
  });

  it("answers with a toast when direct sessions are disabled", async () => {
    const listener = startEventChannel({
      config,
      bridge,
      logger,
      clientFactory: () => ({ start: () => Promise.resolve() }),
    });
    expect(listener?.handleCardActionData(cardPayload())).toEqual({
      toast: { type: "warning", content: "直连功能未启用" },
    });
  });

  it("translates toast content to english when locale is en", async () => {
    setLocale("en");
    try {
      const listener = startEventChannel({
        config,
        bridge,
        logger,
        direct: {
          handleCardAction: async () => ({ toast: { type: "success", content: "已取消" } }),
        },
        clientFactory: () => ({ start: () => Promise.resolve() }),
      });
      const response = listener?.handleCardActionData(cardPayload());
      await expect(response).resolves.toEqual({
        toast: { type: "success", content: "Cancelled" },
      });
    } finally {
      setLocale("zh");
    }
  });

  it("translates the disabled-direct toast to english when locale is en", () => {
    setLocale("en");
    try {
      const listener = startEventChannel({
        config,
        bridge,
        logger,
        clientFactory: () => ({ start: () => Promise.resolve() }),
      });
      expect(listener?.handleCardActionData(cardPayload())).toEqual({
        toast: { type: "warning", content: "Direct sessions are not enabled" },
      });
    } finally {
      setLocale("zh");
    }
  });
});
