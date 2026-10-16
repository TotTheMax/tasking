import { spawn } from "node:child_process";
/**
 * Integrated real end-to-end (semi-automated, human clicks).
 *
 * Gate: INTEGRATION=1 DIRECT_APPROVAL=1
 *
 * The full cross-component loop:
 *   /chat in the real intake group -> DirectSessionManager turn
 *   -> real opencode v2 (supervised serve) agent runs a shell command
 *   -> workspace `ask` rule pends the permission
 *   -> the manager posts a real Feishu approval card into the thread
 *   -> the human clicks "允许一次" (real WS event channel -> router ->
 *      DirectSessionManager approve handler -> ApprovalCoordinator)
 *   -> the reply is submitted to the real opencode session, which resumes
 *   -> the turn completes and the completion message lands in the thread.
 */
import { mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type FeishuPolledMessage, FeishuSource } from "../src/adapters/feishu/source.js";
import { BindingStore } from "../src/bridge/binding-store.js";
import { CommentBridge } from "../src/bridge/comment-bridge.js";
import { startEventChannel } from "../src/cli/event-channel.js";
import type { EffectiveConfig } from "../src/config/config-types.js";
import { resolveConfig } from "../src/config/resolver.js";
import { DirectSessionManager } from "../src/direct/manager.js";
import { ConsoleLogger } from "../src/observability/logger.js";
import {
  assertE2ECredsComplete,
  loadE2ECredsEnvFile,
  resolveE2ECreds,
} from "./helpers/e2e-creds.js";

const logger = new ConsoleLogger({});
loadE2ECredsEnvFile();
const CREDS = resolveE2ECreds(process.env);
const enabled = process.env.INTEGRATION === "1" && process.env.DIRECT_APPROVAL === "1";
if (enabled) assertE2ECredsComplete(CREDS);

const BIN = process.env.OPENCODE_V2_BIN ?? "opencode-v2";
const PASSWORD = "tasking-direct-e2e";
const MODEL = process.env.OPENCODE_SMOKE_MODEL ?? "siliconflow-cn/Qwen/Qwen3.5-4B";

function providerParts(): { providerID: string; modelID: string } {
  const idx = MODEL.indexOf("/");
  return idx === -1
    ? { providerID: "", modelID: MODEL }
    : { providerID: MODEL.slice(0, idx), modelID: MODEL.slice(idx + 1) };
}

async function waitForAsync(cond: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

describe.skipIf(!enabled)("integrated direct approval E2E (semi-automated)", () => {
  it("a real opencode ask permission becomes a real Feishu card; the click resumes the turn", async () => {
    const suffix = Date.now().toString(36);
    const root = mkdtempSync(join(tmpdir(), "tasking-direct-e2e-"));
    const workDir = join(root, "work");
    mkdirSync(join(workDir, ".opencode"), { recursive: true });
    writeFileSync(
      join(workDir, ".opencode", "opencode.json"),
      JSON.stringify({ permissions: [{ action: "shell", resource: "*", effect: "ask" }] }),
    );
    mkdirSync(join(root, "config"), { recursive: true });
    const catalog = JSON.parse(
      readFileSync(join(process.env.HOME ?? "", ".cache", "opencode", "models.json"), "utf8"),
    ) as Record<string, { api?: string }>;
    const { providerID, modelID } = providerParts();
    const baseURL = catalog[providerID]?.api;
    if (baseURL) {
      writeFileSync(
        join(root, "config", "opencode.json"),
        JSON.stringify({
          providers: { [providerID]: { baseURL, models: { [modelID]: { name: modelID } } } },
        }),
      );
    }
    const auth = JSON.parse(
      readFileSync(
        join(process.env.HOME ?? "", ".local", "share", "opencode", "auth.json"),
        "utf8",
      ),
    ) as Record<string, { key?: string }>;
    const providerKey = auth[providerID]?.key ?? "";
    const port = 48800 + (process.pid % 150);
    const serveURL = `http://127.0.0.1:${port}`;
    const serveLog = join(root, "serve.log");
    const logFd = openSync(serveLog, "a");
    const serveEnv = {
      ...process.env,
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_CONFIG_DIR: join(root, "config"),
      OPENCODE_DB: join(root, "db.sqlite"),
      OPENCODE_SERVER_PASSWORD: PASSWORD,
      OPENCODE_PASSWORD: PASSWORD,
      SILICONFLOW_CN_API_KEY: providerKey,
    };
    const child = spawn(BIN, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: workDir,
      env: serveEnv,
      stdio: ["ignore", logFd, logFd],
      detached: true,
    });
    child.unref();

    const config: EffectiveConfig = resolveConfig(
      {
        tracker: { kind: "none" },
        opencode: {
          command: BIN,
          model: MODEL,
          server_url: serveURL,
          turn_timeout_ms: 600_000,
          permission_timeout_ms: 600_000,
          auto_approve: false,
        },
        feishu: {
          enabled: true,
          app_id: CREDS.feishuAppId,
          app_secret: CREDS.feishuAppSecret,
          intake_chat_id: CREDS.feishuIntakeChatId,
          direct: { enabled: true, verbosity: "summary" },
        },
      },
      "/tmp",
      "prompt",
    );
    process.env.OPENCODE_PASSWORD = PASSWORD;
    process.env.OPENCODE_DISABLE_AUTOUPDATE = "1";
    const bindings = new BindingStore(join(root, "b.db"));
    const feishu = new FeishuSource(config.feishu, logger);
    let cardPosted = false;
    const originalReplyCard = feishu.replyCardInThread.bind(feishu);
    feishu.replyCardInThread = async (rootId: string, card: unknown) => {
      const res = await originalReplyCard(rootId, card);
      cardPosted = true;
      const title =
        (card as { header?: { title?: { content?: string } } })?.header?.title?.content ?? "";
      logger.info(`>>> 审批卡已发出（${title}）—— 请在群里点「✅ 允许一次」`);
      return res;
    };
    const manager = new DirectSessionManager({
      feishu,
      store: bindings,
      config: () => config,
      logger,
    });
    const bridge = new CommentBridge({
      tracker: null,
      feishu,
      bindings,
      config: () => config,
      logger,
    });
    const listener = startEventChannel({ config, bridge, direct: manager, logger });

    try {
      expect(listener).not.toBeNull();
      await waitForAsync(async () => {
        try {
          const res = await fetch(`${serveURL}/api/info`, {
            headers: {
              Authorization: `Basic ${Buffer.from(`opencode:${PASSWORD}`).toString("base64")}`,
            },
          });
          return res.ok;
        } catch {
          return false;
        }
      }, 90_000);

      const commandMsgId = await feishu.postMessage(
        CREDS.feishuIntakeChatId,
        `/chat ${workDir} 用 shell 工具执行 echo direct-e2e-approval`,
      );
      const msg: FeishuPolledMessage = {
        message_id: commandMsgId,
        root_id: null,
        parent_id: null,
        msg_type: "text",
        text: `/chat ${workDir} 用 shell 工具执行 echo direct-e2e-approval`,
        sender_open_id: "ou_e2e",
        sender_name: "e2e",
        sender_type: "user",
        create_time: String(Math.floor(Date.now() / 1000)),
        chat_id: CREDS.feishuIntakeChatId,
        attachments: [],
      };
      logger.info(`>>> 已发起直连会话（suffix ${suffix}）`);
      logger.info(">>> 稍后群里话题内会出现审批卡，请点「✅ 允许一次」");
      const started = await manager.handleIntakeMessage(msg);
      expect(started).toBe(true);

      const deadline = Date.now() + 600_000;
      let completed = false;
      while (Date.now() < deadline && !completed) {
        const session = bindings.getDirectSession(commandMsgId);
        if (cardPosted && session?.status === "idle" && session.turns > 0) {
          completed = true;
        }
        if (!completed) await new Promise((r) => setTimeout(r, 3000));
      }
      expect(cardPosted, "approval card was never posted to the thread").toBe(true);
      expect(completed, "turn did not complete after the approval").toBe(true);
      logger.info("integrated direct approval E2E verified end to end");
    } finally {
      listener?.stop();
      manager.stop();
      try {
        process.kill(-(child.pid ?? 0), "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      bindings.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 600_000);
});
