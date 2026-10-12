import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type FeishuPolledMessage, FeishuSource } from "../src/adapters/feishu/source.js";
import { BindingStore } from "../src/bridge/binding-store.js";
import type { DirectVerbosity, EffectiveConfig } from "../src/config/config-types.js";
import { resolveConfig } from "../src/config/resolver.js";
import { DirectSessionManager } from "../src/direct/manager.js";
import { ConsoleLogger } from "../src/observability/logger.js";
import { toTaskingError } from "../src/shared/errors.js";
import {
  assertE2ECredsComplete,
  loadE2ECredsEnvFile,
  resolveE2ECreds,
} from "./helpers/e2e-creds.js";

const logger = new ConsoleLogger({}, () => {});

loadE2ECredsEnvFile();

const CREDS = resolveE2ECreds(process.env);

const enabled = process.env.INTEGRATION === "1";

if (enabled) assertE2ECredsComplete(CREDS);

const TURN_WAIT_MS = 240000;

function directConfig(targetDir: string, verbosity: DirectVerbosity = "detailed"): EffectiveConfig {
  return resolveConfig(
    {
      feishu: {
        enabled: true,
        app_id: CREDS.feishuAppId,
        app_secret: CREDS.feishuAppSecret,
        intake_chat_id: CREDS.feishuIntakeChatId,
        direct: {
          projects: { itdirect: targetDir },
          verbosity,
        },
      },
    },
    "/tmp",
    "p",
  );
}

function makeMsg(overrides: Partial<FeishuPolledMessage>): FeishuPolledMessage {
  return {
    message_id: "",
    root_id: null,
    parent_id: null,
    msg_type: "text",
    text: "",
    sender_open_id: "ou_integration",
    sender_name: "integration",
    sender_type: "user",
    create_time: String(Math.floor(Date.now() / 1000)),
    chat_id: CREDS.feishuIntakeChatId,
    ...overrides,
  };
}

async function waitFor(fn: () => boolean | Promise<boolean>, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 500));
  }
}

describe.skipIf(!enabled)("Direct session real API integration", () => {
  it(
    "runs a real opencode turn against a temp repo and mirrors the summary to a real Feishu thread",
    { timeout: TURN_WAIT_MS * 3 + 60000 },
    async () => {
      const repo = mkdtempSync(join(tmpdir(), "tasking-direct-real-"));
      execSync("git init -q", { cwd: repo });
      const root = mkdtempSync(join(tmpdir(), "tasking-direct-real-state-"));
      const bindings = new BindingStore(join(root, "b.db"));
      const config = directConfig(repo, "summary");
      const feishu = new FeishuSource(config.feishu, logger);
      const mgr = new DirectSessionManager({
        feishu,
        store: bindings,
        config: () => config,
        logger,
      });
      mgr.start();
      let mgr2: DirectSessionManager | null = null;
      try {
        const rootMsgId = await feishu.postMessage(
          CREDS.feishuIntakeChatId,
          `[integration-direct] 直连会话测试 ${Date.now()}`,
        );
        if (!rootMsgId) throw new Error("postMessage root failed");

        const createThread = await mgr.handleIntakeMessage(
          makeMsg({
            message_id: rootMsgId,
            text: "/chat itdirect 请创建文件 direct_hello.txt 内容为 hi（不要做其他事），完成后告诉我结果",
          }),
        );
        expect(createThread).toBe(true);
        let summary: FeishuPolledMessage | undefined;
        let ackReply: FeishuPolledMessage | undefined;
        await waitFor(async () => {
          const s = bindings.getDirectSession(rootMsgId);
          if (!s?.thread_id) return false;
          const replies = await feishu.listThreadReplies(s.thread_id, null);
          summary = replies.find((m) => m.sender_type === "app" && m.text.includes("direct_hello"));
          ackReply = replies.find((m) => m.sender_type === "app" && m.text.includes("会话已创建"));
          return summary !== undefined && ackReply !== undefined;
        }, TURN_WAIT_MS);
        const session = bindings.getDirectSession(rootMsgId);
        expect(
          session?.session_id,
          "first turn should have created an opencode session",
        ).toBeTruthy();
        const threadId = session?.thread_id ?? "";
        expect(threadId, "thread_id should be captured from the ack reply").toBeTruthy();
        expect(summary, "summary should mention the created file").toBeTruthy();
        expect(ackReply, "creation ack should be posted").toBeTruthy();

        const followUpAt = String(Math.floor(Date.now() / 1000) - 5);
        mgr2 = new DirectSessionManager({
          feishu,
          store: bindings,
          config: () => config,
          logger,
        });
        await mgr2.recover();
        await mgr2.handleThreadMessage(
          makeMsg({
            message_id: `om_follow_${Date.now()}`,
            root_id: rootMsgId,
            text: "请读出 direct_hello.txt 的内容",
            create_time: followUpAt,
          }),
        );
        await waitFor(async () => {
          const followUpReplies = await feishu.listThreadReplies(threadId, followUpAt);
          return followUpReplies.some((m) => m.sender_type === "app" && m.text.includes("hi"));
        }, TURN_WAIT_MS);
        expect(bindings.getDirectSession(rootMsgId)?.session_id).toBe(session?.session_id);

        await mgr2.handleThreadMessage(
          makeMsg({
            message_id: `om_done_${Date.now()}`,
            root_id: rootMsgId,
            text: "/done",
            create_time: String(Math.floor(Date.now() / 1000) + 2),
          }),
        );
        expect(bindings.getDirectSession(rootMsgId)?.status).toBe("done");
      } finally {
        mgr.stop();
        mgr2?.stop();
        bindings.close();
        rmSync(root, { recursive: true, force: true });
        rmSync(repo, { recursive: true, force: true });
      }
    },
  );

  it(
    "real /stop kills a running turn; the session stays usable afterwards",
    { timeout: TURN_WAIT_MS * 2 + 60000 },
    async () => {
      const repo = mkdtempSync(join(tmpdir(), "tasking-direct-stop-"));
      execSync("git init -q", { cwd: repo });
      const root = mkdtempSync(join(tmpdir(), "tasking-direct-stop-state-"));
      const bindings = new BindingStore(join(root, "b.db"));
      const config = directConfig(repo, "summary");
      const feishu = new FeishuSource(config.feishu, logger);
      const mgr = new DirectSessionManager({
        feishu,
        store: bindings,
        config: () => config,
        logger,
      });
      mgr.start();
      try {
        const rootMsgId = await feishu.postMessage(
          CREDS.feishuIntakeChatId,
          `[integration-direct] /stop 测试 ${Date.now()}`,
        );
        if (!rootMsgId) throw new Error("postMessage root failed");
        await mgr.handleIntakeMessage(
          makeMsg({
            message_id: rootMsgId,
            text: "/chat itdirect 请使用 bash 工具运行命令 `sleep 90`，不要做其他任何事情，命令结束后回复：完成",
          }),
        );
        await waitFor(
          async () => bindings.getDirectSession(rootMsgId)?.status === "running",
          TURN_WAIT_MS,
        );
        await new Promise((r) => setTimeout(r, 20000));
        expect(bindings.getDirectSession(rootMsgId)?.status).toBe("running");

        await mgr.handleThreadMessage(
          makeMsg({
            message_id: `om_stop_${Date.now()}`,
            root_id: rootMsgId,
            text: "/stop",
            create_time: String(Math.floor(Date.now() / 1000)),
          }),
        );
        expect(bindings.getDirectSession(rootMsgId)?.status).toBe("idle");
        const threadId = bindings.getDirectSession(rootMsgId)?.thread_id ?? "";
        await waitFor(async () => {
          const replies = await feishu.listThreadReplies(threadId, null);
          return replies.some((m) => m.sender_type === "app" && m.text.includes("已中断"));
        }, 30000);
        await waitFor(
          async () => bindings.getDirectSession(rootMsgId)?.status === "idle",
          TURN_WAIT_MS,
        );
        const interruptedReplies = await feishu.listThreadReplies(threadId, null);
        expect(
          interruptedReplies.some((m) => m.sender_type === "app" && m.text.includes("未完成")),
          "aborted turn must not post the normal failure summary",
        ).toBe(false);

        const followUpAt = String(Math.floor(Date.now() / 1000));
        await mgr.handleThreadMessage(
          makeMsg({
            message_id: `om_after_stop_${Date.now()}`,
            root_id: rootMsgId,
            text: "刚才的任务不用管了。请直接回复两个字：好的",
            create_time: followUpAt,
          }),
        );
        await waitFor(async () => {
          const replies = await feishu.listThreadReplies(threadId, followUpAt);
          return replies.some((m) => m.sender_type === "app" && m.text.includes("好的"));
        }, TURN_WAIT_MS);
        expect(bindings.getDirectSession(rootMsgId)?.status).toBe("idle");
      } finally {
        mgr.stop();
        bindings.close();
        rmSync(root, { recursive: true, force: true });
        rmSync(repo, { recursive: true, force: true });
      }
    },
  );

  it(
    "path-mode sessions really execute in the given directory",
    { timeout: TURN_WAIT_MS + 120000 },
    async () => {
      const repo = mkdtempSync(join(tmpdir(), "tasking-direct-path-"));
      execSync("git init -q", { cwd: repo });
      const root = mkdtempSync(join(tmpdir(), "tasking-direct-path-state-"));
      const bindings = new BindingStore(join(root, "b.db"));
      const config = directConfig(repo);
      const feishu = new FeishuSource(config.feishu, logger);
      const mgr = new DirectSessionManager({
        feishu,
        store: bindings,
        config: () => config,
        logger,
      });
      mgr.start();
      try {
        const rootMsgId = await feishu.postMessage(
          CREDS.feishuIntakeChatId,
          `[integration-direct] path 模式 ${Date.now()}`,
        );
        if (!rootMsgId) throw new Error("postMessage root failed");
        await mgr.handleIntakeMessage(
          makeMsg({
            message_id: rootMsgId,
            text: `/chat ${repo} 请创建文件 path_marker.txt 内容为 path-ok（不要做其他事），完成后告诉我`,
          }),
        );
        await waitFor(
          async () => bindings.getDirectSession(rootMsgId)?.status === "idle",
          TURN_WAIT_MS,
        );
        const marker = join(repo, "path_marker.txt");
        await waitFor(() => existsSync(marker), 30000);
        expect(readFileSync(marker, "utf8").includes("path-ok")).toBe(true);
        const session = bindings.getDirectSession(rootMsgId);
        expect(session?.path).toBe(realpathSync(repo));
        expect(session?.project).toBeNull();
      } finally {
        mgr.stop();
        bindings.close();
        rmSync(root, { recursive: true, force: true });
        rmSync(repo, { recursive: true, force: true });
      }
    },
  );

  it(
    "recover() notifies a real thread for orphaned running sessions",
    { timeout: 60000 },
    async () => {
      const repo = mkdtempSync(join(tmpdir(), "tasking-direct-rec-"));
      execSync("git init -q", { cwd: repo });
      const root = mkdtempSync(join(tmpdir(), "tasking-direct-rec-state-"));
      const bindings = new BindingStore(join(root, "b.db"));
      const config = directConfig(repo);
      const feishu = new FeishuSource(config.feishu, logger);
      const mgr = new DirectSessionManager({
        feishu,
        store: bindings,
        config: () => config,
        logger,
      });
      mgr.start();
      try {
        const rootMsgId = await feishu.postMessage(
          CREDS.feishuIntakeChatId,
          `[integration-direct] 恢复测试 ${Date.now()}`,
        );
        if (!rootMsgId) throw new Error("postMessage root failed");
        const ack = await feishu.replyInThread(rootMsgId, "占位（模拟上次 ACK）");
        bindings.upsertDirectSession({
          root_id: rootMsgId,
          chat_id: CREDS.feishuIntakeChatId,
          project: "itdirect",
          path: repo,
          session_id: "ses_orphan",
          status: "running",
        });
        bindings.updateDirectSession(rootMsgId, { thread_id: ack.thread_id });

        const mgr2 = new DirectSessionManager({
          feishu,
          store: bindings,
          config: () => config,
          logger,
        });
        await mgr2.recover();
        expect(bindings.getDirectSession(rootMsgId)?.status).toBe("idle");
        await waitFor(async () => {
          const replies = await feishu.listThreadReplies(ack.thread_id ?? "", null);
          return replies.some((m) => m.sender_type === "app" && m.text.includes("中断"));
        }, 30000);
      } finally {
        mgr.stop();
        bindings.close();
        rmSync(root, { recursive: true, force: true });
        rmSync(repo, { recursive: true, force: true });
      }
    },
  );

  it(
    "sends and updates a real card, and uploads a file when im:resource is granted",
    { timeout: 60000 },
    async () => {
      const repo = mkdtempSync(join(tmpdir(), "tasking-direct-card-"));
      try {
        const feishu = new FeishuSource(directConfig(repo).feishu, logger);
        const rootMsgId = await feishu.postMessage(
          CREDS.feishuIntakeChatId,
          `[integration-direct] 卡片测试 ${Date.now()}`,
        );
        expect(rootMsgId).not.toBe("");
        const card = {
          schema: "2.0",
          config: { update_multi: true },
          header: { template: "blue", title: { tag: "plain_text", content: "direct card probe" } },
          body: { elements: [{ tag: "markdown", content: "probe" }] },
        };
        const created = await feishu.replyCardInThread(rootMsgId, card);
        expect(created.message_id).not.toBe("");
        const updated = {
          ...card,
          header: {
            template: "green",
            title: { tag: "plain_text", content: "direct card probe v2" },
          },
        };
        await expect(feishu.updateCard(created.message_id, updated)).resolves.toBeUndefined();

        let uploadKey: string | null = null;
        try {
          uploadKey = await feishu.uploadFile(Buffer.from("# full detail\n"), "direct-probe.md");
        } catch (e) {
          expect(toTaskingError(e).message).toMatch(/im:resource|99991672|Access denied/i);
        }
        if (uploadKey !== null && uploadKey !== "") {
          const sent = await feishu.sendFileMessage(rootMsgId, uploadKey);
          expect(sent.message_id).not.toBe("");
        }
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
  );
});
