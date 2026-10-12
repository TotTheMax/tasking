import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FeishuEventListener } from "../src/adapters/feishu/events.js";
import { FeishuSource } from "../src/adapters/feishu/source.js";
import type { FeishuPolledMessage } from "../src/adapters/feishu/source.js";
import { JiraTracker } from "../src/adapters/jira/tracker.js";
import { BindingStore } from "../src/bridge/binding-store.js";
import { CommentBridge } from "../src/bridge/comment-bridge.js";
import type { EffectiveConfig } from "../src/config/config-types.js";
import { resolveConfig } from "../src/config/resolver.js";
import { ConsoleLogger } from "../src/observability/logger.js";
import {
  assertE2ECredsComplete,
  loadE2ECredsEnvFile,
  resolveE2ECreds,
} from "./helpers/e2e-creds.js";

const logger = new ConsoleLogger({});

loadE2ECredsEnvFile();

const CREDS = resolveE2ECreds(process.env);
const enabled = process.env.INTEGRATION === "1";
if (enabled) assertE2ECredsComplete(CREDS);

async function fetchChatName(chatId: string): Promise<string> {
  try {
    const token = (await fetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: CREDS.feishuAppId, app_secret: CREDS.feishuAppSecret }),
      },
    ).then((r) => r.json())) as { tenant_access_token?: string };
    const data = (await fetch("https://open.feishu.cn/open-apis/im/v1/chats?page_size=100", {
      headers: { Authorization: `Bearer ${token.tenant_access_token ?? ""}` },
    }).then((r) => r.json())) as {
      data?: { items?: Array<{ chat_id: string; name: string }> };
    };
    return data.data?.items?.find((c) => c.chat_id === chatId)?.name ?? "接收入口";
  } catch {
    return "接收入口";
  }
}

/**
 * Semi-automated real-API event-flow verification (run manually):
 *   INTEGRATION=1 npm run test:event-flow
 * The human sends two messages in the intake group; every assertion is automated.
 * The created Jira issue is deleted in a finally block (ADR 0015 semantics).
 */
describe("real Feishu event flow (semi-automated)", () => {
  it("receives /issue via WS, bridges a thread reply to Jira, cleans up", async () => {
    if (!enabled) return;
    const suffix = Date.now().toString(36);
    const root = mkdtempSync(join(tmpdir(), "tasking-event-flow-"));
    const bindings = new BindingStore(join(root, "b.db"));
    const config: EffectiveConfig = resolveConfig(
      {
        tracker: {
          kind: "jira",
          endpoint: CREDS.jiraEndpoint,
          api_key: CREDS.jiraApiKey,
          api_user: "agent@example.com",
          auth_mode: "bearer",
          project_key: CREDS.jiraProjectKey,
          active_states: ["待办", "处理中"],
          terminal_states: ["完成", "关闭"],
        },
        feishu: {
          enabled: true,
          app_id: CREDS.feishuAppId,
          app_secret: CREDS.feishuAppSecret,
          intake_chat_id: CREDS.feishuIntakeChatId,
          forward_interval_ms: 5000,
          sweep_interval_ms: 60000,
          create_issue_type: "任务",
        },
      },
      "/tmp",
      "prompt",
    );
    const tracker = new JiraTracker(config.tracker);
    const feishu = new FeishuSource(config.feishu, logger);
    const bridge = new CommentBridge({
      tracker,
      feishu,
      bindings,
      config: () => config,
      logger,
    });

    let createdKey: string | null = null;
    let createdId: string | null = null;
    let connected = false;
    let replySeen: FeishuPolledMessage | null = null;
    const seenReplies: FeishuPolledMessage[] = [];
    const listener = new FeishuEventListener({
      appId: CREDS.feishuAppId,
      appSecret: CREDS.feishuAppSecret,
      onMessage: (msg) => {
        void bridge.ingestMessage(msg).catch((e) =>
          logger.error("event-flow ingest failed", {
            error: e instanceof Error ? e.message : String(e),
          }),
        );
        if (msg.root_id !== null && msg.sender_type === "user") {
          replySeen = msg;
          if (msg.text.trim() !== "") seenReplies.push(msg);
        }
      },
      onConnected: () => {
        connected = true;
      },
      logger,
    });

    try {
      bridge.start();
      listener.start();
      const t0 = Date.now();
      while (!connected && Date.now() - t0 < 15000) {
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(connected).toBe(true);
      logger.info("event channel connected");

      const chatName = await fetchChatName(CREDS.feishuIntakeChatId);
      logger.info(`>>> 请到「${chatName}」群发送消息（10 分钟内有效）:`);
      logger.info(`    /issue event-flow 冒烟 ${suffix}`);
      const t1 = Date.now();
      const searchUrl = `${CREDS.jiraEndpoint.replace(/\/+$/, "")}/search?jql=${encodeURIComponent(
        `summary ~ "event-flow 冒烟 ${suffix}"`,
      )}`;
      while (createdKey === null && Date.now() - t1 < 600000) {
        try {
          const res = await fetch(searchUrl, {
            headers: { Authorization: `Bearer ${CREDS.jiraApiKey}` },
          });
          const data = (await res.json()) as { issues?: Array<{ key: string; id: string }> };
          const hit = data.issues?.[0];
          if (hit) {
            createdKey = hit.key;
            createdId = hit.id;
          }
        } catch {
          // transient network error, keep polling
        }
        if (createdKey === null) await new Promise((r) => setTimeout(r, 500));
      }
      expect(createdKey).not.toBeNull();
      logger.info(`>>> 任务已创建：${createdKey}`);
      logger.info(">>> 请在该话题内回复任意文字（如：event flow reply）");
      const t2 = Date.now();
      while (replySeen === null && Date.now() - t2 < 600000) {
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(replySeen).not.toBeNull();
      const replyMsg = replySeen as unknown as FeishuPolledMessage;
      await bridge.whenIdle();
      // Any observed thread reply should reach Jira; which one lands first is
      // timing-dependent, so check them all rather than latching one.
      const needles = seenReplies.map((m) => m.text.trim().slice(0, 20));
      const t3 = Date.now();
      let bridged = false;
      while (!bridged && Date.now() - t3 < 30000) {
        const comments = await tracker.fetchComments(createdKey as string, null);
        bridged = comments.some((c) => needles.some((n) => n !== "" && c.text.includes(n)));
        if (!bridged) await new Promise((r) => setTimeout(r, 500));
      }
      expect(bridged).toBe(true);
      logger.info("event flow verified: /issue + thread reply both arrived via WS");
    } finally {
      listener.stop();
      bridge.stop();
      if (createdKey) {
        await fetch(`${CREDS.jiraEndpoint.replace(/\/+$/, "")}/issue/${createdKey}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${CREDS.jiraApiKey}` },
        }).catch(() => {});
      }
      bindings.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 600000);
});
