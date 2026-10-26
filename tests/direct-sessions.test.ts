import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeishuPolledMessage } from "../src/adapters/feishu/source.js";
import type { BindingStore } from "../src/bridge/binding-store.js";
import { BindingStore as BindingStoreImpl } from "../src/bridge/binding-store.js";
import type { EffectiveConfig } from "../src/config/config-types.js";
import { DEFAULTS, type DirectConfig } from "../src/config/config-types.js";
import { resolveConfig } from "../src/config/resolver.js";
import type { DirectTurnOutcome } from "../src/direct/driver.js";
import { type DirectFeishuPort, DirectSessionManager } from "../src/direct/manager.js";
import type { TurnDriverEvent } from "../src/driver/turn-driver.js";
import type { ActivityEvent } from "../src/observability/activity-store.js";
import { TaskingError } from "../src/shared/errors.js";
import { translateCard } from "../src/translate/card.js";
import { setLocale, translate } from "../src/translate/locale.js";

let workdir: string;
let dbPath: string;
let store: BindingStore;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "tasking-direct-"));
  dbPath = join(workdir, "bindings.db");
  store = new BindingStoreImpl(dbPath);
});

afterEach(() => {
  store.close();
  rmSync(workdir, { recursive: true, force: true });
});

function msg(overrides: Partial<FeishuPolledMessage>): FeishuPolledMessage {
  return {
    message_id: "om_1",
    root_id: null,
    parent_id: null,
    msg_type: "text",
    text: "",
    sender_open_id: "ou_u",
    sender_name: "user",
    sender_type: "user",
    create_time: "1700000000",
    chat_id: "oc_chat",
    ...overrides,
  };
}

function directConfig(overrides: Partial<DirectConfig> = {}): EffectiveConfig {
  return resolveConfig(
    {
      workspace: { root: workdir },
      feishu: {
        enabled: true,
        direct: {
          projects: { tasking: workdir },
          verbosity: "summary",
          ...overrides,
        },
      },
    },
    "/tmp",
    "p",
  );
}

function projectPath(): string {
  return realpathSync(workdir);
}

interface Reply {
  rootId: string;
  text: string;
}

class FakeFeishu {
  replies: Reply[] = [];
  threads = new Map<string, FeishuPolledMessage[]>();
  cards: Array<{ rootId: string; card: unknown }> = [];
  updates: Array<{ messageId: string; card: unknown }> = [];
  async replyInThread(rootId: string, text: string) {
    this.replies.push({ rootId, text });
    return {
      message_id: `om_reply_${this.replies.length}`,
      root_id: rootId,
      thread_id: `omt_${rootId}`,
    };
  }
  async replyFlat(rootId: string, text: string) {
    this.replies.push({ rootId, text });
  }
  async replyCardInThread(rootId: string, card: unknown) {
    this.cards.push({ rootId, card });
    return {
      message_id: `om_card_${this.cards.length}`,
      root_id: rootId,
      thread_id: `omt_${rootId}`,
    };
  }
  async updateCard(messageId: string, card: unknown): Promise<void> {
    this.updates.push({ messageId, card });
  }
  downloaded: Array<{ messageId: string; fileKey: string; kind: string }> = [];
  async downloadMessageResource(messageId: string, fileKey: string, kind: "image" | "file") {
    this.downloaded.push({ messageId, fileKey, kind });
    return { data: new Uint8Array([1, 2, 3]), contentType: "image/png" };
  }
  members: Array<{ open_id: string; name: string }> = [{ open_id: "ou_op", name: "张三" }];
  memberCalls = 0;
  membersThrow = false;
  async listChatMembers(): Promise<Array<{ open_id: string; name: string }>> {
    this.memberCalls++;
    if (this.membersThrow) throw new Error("member list unavailable");
    return this.members;
  }
  files: Array<{ content: Uint8Array; fileName: string }> = [];
  fileMessages: Array<{ rootId: string; fileKey: string }> = [];
  async uploadFile(content: Uint8Array, fileName: string): Promise<string> {
    this.files.push({ content, fileName });
    return `file_${this.files.length}`;
  }
  async sendFileMessage(rootId: string, fileKey: string) {
    this.fileMessages.push({ rootId, fileKey });
    return {
      message_id: `om_file_${this.fileMessages.length}`,
      root_id: rootId,
      thread_id: `omt_${rootId}`,
    };
  }
  updateJson(): string[] {
    return this.updates.map((u) => JSON.stringify(u.card));
  }
  async listThreadReplies(threadId: string, since?: string | null): Promise<FeishuPolledMessage[]> {
    const list = this.threads.get(threadId) ?? [];
    return list.filter((m) => !since || Number(m.create_time) > Number(since));
  }
  seedThread(threadId: string, m: FeishuPolledMessage): void {
    const list = this.threads.get(threadId) ?? [];
    list.push(m);
    this.threads.set(threadId, list);
  }
  sent(rootId: string): string[] {
    return this.replies.filter((r) => r.rootId === rootId).map((r) => r.text);
  }
  cardTexts(rootId: string): string[] {
    return this.cards.filter((c) => c.rootId === rootId).map((c) => JSON.stringify(c.card));
  }
}

type SpawnCall = {
  cmd: string[];
  cwd: string;
  request: import("../../src/direct/driver.js").DirectTurnRequest;
  onEvent?: (evt: TurnDriverEvent) => void;
  signal?: AbortSignal;
};

class FakeRunner {
  calls: SpawnCall[] = [];
  private resolvers: Array<(r: DirectTurnOutcome) => void> = [];

  spawn = (
    request: import("../../src/direct/driver.js").DirectTurnRequest,
  ): Promise<DirectTurnOutcome> => {
    const cmd = [
      "opencode",
      "run",
      "--dir",
      request.directory,
      ...(request.sessionId ? ["-s", request.sessionId] : []),
      ...(request.autoApprove ? ["--auto"] : []),
      ...(request.agent ? ["--agent", request.agent] : []),
      ...(request.model ? ["--model", request.model] : []),
      ...(request.variant ? ["--variant", request.variant] : []),
      request.prompt,
    ];
    this.calls.push({
      cmd,
      cwd: request.directory,
      request,
      signal: request.signal,
      onEvent: request.onEvent,
    });
    return new Promise<DirectTurnOutcome>((resolve) => {
      this.resolvers.push(resolve);
    });
  };

  finish(index: number, events: TurnDriverEvent[], exitCode = 0): void {
    const call = this.calls[index];
    for (const evt of events) call?.onEvent?.(evt);
    const status: DirectTurnOutcome["status"] =
      exitCode === 0 ? "succeeded" : exitCode === 124 ? "timed_out" : "failed";
    this.resolvers[index]?.({
      status,
      sessionId:
        (this.calls[index]?.request.sessionId as string | null) ?? `ses_fake${this.calls.length}`,
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      error: status === "succeeded" ? null : `exit ${exitCode}`,
      postureOpened: this.calls[index]?.request.autoApprove ?? false,
    });
  }

  waitForCall(n: number): Promise<void> {
    return new Promise((resolve) => {
      const check = () => (this.calls.length >= n ? resolve() : setTimeout(check, 5));
      check();
    });
  }
}

function textEvent(text: string): TurnDriverEvent {
  return { type: "text", text, sessionId: "ses_fake1" };
}

function toolEvent(title: string, status: "completed" | "error" = "completed"): TurnDriverEvent {
  return { type: "tool_use", tool: "bash", title, status };
}

describe("DirectSessionManager", () => {
  it("creates a session from /chat <project>, ACKs, runs first turn, posts summary", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    const root = msg({ message_id: "om_root1", text: "/chat tasking 帮我跑一下测试" });
    const handled = await mgr.handleIntakeMessage(root);
    expect(handled).toBe(true);
    await runner.waitForCall(1);
    expect(feishu.sent("om_root1")[0]).toContain("已创建");
    const call = runner.calls[0];
    expect(call.cmd).toContain("--dir");
    expect(call.cmd[call.cmd.indexOf("--dir") + 1]).toBe(projectPath());
    expect(call.cwd).toBe(projectPath());
    expect(call.cmd[call.cmd.length - 1]).toBe("帮我跑一下测试");
    expect(call.cmd).not.toContain("--title");
    runner.finish(0, [textEvent("测试全部通过")]);
    await mgr.whenIdle();
    const summary = feishu.sent("om_root1").find((t) => t.includes("测试全部通过"));
    expect(summary).toBeDefined();
    expect(summary).toContain("🔧");
    const session = store.getDirectSession("om_root1");
    expect(session?.status).toBe("idle");
    expect(session?.session_id).toContain("ses_");
  });

  it("propagates the configured opencode agent/model/variant into the spawned command", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const cfg = resolveConfig(
      {
        opencode: { agent: "review", model: "deepseek/deepseek-v4-flash", variant: "high" },
        feishu: { enabled: true, direct: { projects: { tasking: workdir } } },
      },
      "/tmp",
      "p",
    );
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => cfg,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_root_cfg", text: "/chat tasking 你好" }));
    await runner.waitForCall(1);
    const cmd = runner.calls[0]?.cmd ?? [];
    expect(cmd[cmd.indexOf("--agent") + 1]).toBe("review");
    expect(cmd[cmd.indexOf("--model") + 1]).toBe("deepseek/deepseek-v4-flash");
    expect(cmd[cmd.indexOf("--variant") + 1]).toBe("high");
    expect(cmd[cmd.length - 1]).toBe("你好");
  });

  it("replies with an error for an unknown project and creates no session", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    const handled = await mgr.handleIntakeMessage(
      msg({ message_id: "om_root2", text: "/chat nope 你好" }),
    );
    expect(handled).toBe(true);
    expect(feishu.sent("om_root2")[0]).toContain("未找到");
    expect(store.getDirectSession("om_root2")).toBeNull();
    expect(runner.calls).toHaveLength(0);
  });

  it("starts path-mode sessions and enforces path_roots", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const target = mkdtempSync(join(tmpdir(), "tasking-direct-target-"));
    try {
      const mgr = new DirectSessionManager({
        feishu,
        store,
        config: () => directConfig({ path_roots: ["/repos"] }),
        logger: fakeLogger(),
        turnDriver: runner.spawn,
      });
      const handled = await mgr.handleIntakeMessage(
        msg({ message_id: "om_root3", text: `/chat ${target} 看看这个目录` }),
      );
      expect(handled).toBe(true);
      expect(feishu.sent("om_root3")[0]).toContain("不在允许的路径范围");
      expect(store.getDirectSession("om_root3")).toBeNull();
      expect(runner.calls).toHaveLength(0);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it("continues an idle session in-thread with -s and merges queued follow-ups", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_root4", text: "/chat tasking 第一问" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("第一答")]);
    await mgr.whenIdle();

    await mgr.handleThreadMessage(
      msg({ message_id: "om_f1", root_id: "om_root4", text: "第二问", create_time: "1700000001" }),
    );
    await runner.waitForCall(2);
    const second = runner.calls[1];
    expect(second.cmd).toContain("-s");
    expect(second.cmd[second.cmd.indexOf("-s") + 1]).toContain("ses_");
    expect(second.cmd[second.cmd.length - 1]).toBe("第二问");

    const blocked = mgr.handleThreadMessage(
      msg({ message_id: "om_f2", root_id: "om_root4", text: "第三问", create_time: "1700000002" }),
    );
    await blocked;
    expect(feishu.sent("om_root4").some((t) => t.includes("已排队"))).toBe(true);
    runner.finish(1, [textEvent("第二答")]);
    await runner.waitForCall(3);
    expect(runner.calls[2]?.cmd[runner.calls[2].cmd.length - 1]).toBe("第三问");
    runner.finish(2, [textEvent("第三答")]);
    await mgr.whenIdle();
    expect(feishu.sent("om_root4").some((t) => t.includes("第三答"))).toBe(true);
  });

  it("detailed verbosity keeps tool detail out of the text channel", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_root5", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [toolEvent("npm test"), toolEvent("git status"), textEvent("做完了")]);
    await mgr.whenIdle();
    expect(feishu.cards).toHaveLength(2);
    const turnCard = feishu.updateJson().at(-1) ?? "";
    expect(turnCard).toContain("npm test");
    expect(turnCard).toContain("git status");
    expect(turnCard).not.toContain("做完了");
    const resultCard = JSON.stringify(feishu.cards[1]?.card);
    expect(resultCard).toContain("做完了");
    expect(resultCard).toContain("⏱");
    expect(feishu.sent("om_root5")).toHaveLength(0);
  });

  it("reports permission rejections in the summary", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_root6", text: "/chat tasking 改文件" }));
    await runner.waitForCall(1);
    runner.finish(0, [toolEvent("hello.txt", "error"), textEvent("我没有权限修改文件")]);
    await mgr.whenIdle();
    const summary = feishu.sent("om_root6").find((t) => t.includes("我没有权限修改文件"));
    expect(summary).toContain("权限");
  });

  it("/done ends the session, deletes the opencode session, and later messages get a one-time terminal hint", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const deleted: string[] = [];
    const cleared: string[] = [];
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
      deleteSession: async (sid) => {
        deleted.push(sid);
      },
      clearActivity: (key) => cleared.push(key),
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_root7", text: "/chat tasking 开始" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("ok")]);
    await mgr.whenIdle();

    const sessionId = store.getDirectSession("om_root7")?.session_id;
    expect(sessionId).toBeTruthy();

    await mgr.handleThreadMessage(
      msg({ message_id: "om_d1", root_id: "om_root7", text: "/done", create_time: "1700000010" }),
    );
    expect(store.getDirectSession("om_root7")?.status).toBe("done");
    expect(feishu.sent("om_root7").some((t) => t.includes("已结束"))).toBe(true);
    expect(deleted).toEqual([sessionId]);
    expect(cleared).toEqual(["direct:om_root7"]);

    await mgr.handleThreadMessage(
      msg({ message_id: "om_d2", root_id: "om_root7", text: "还在吗", create_time: "1700000011" }),
    );
    await mgr.handleThreadMessage(
      msg({ message_id: "om_d3", root_id: "om_root7", text: "还在吗2", create_time: "1700000012" }),
    );
    const hints = feishu.sent("om_root7").filter((t) => t.includes("已结束") || t.includes("停用"));
    expect(hints.length).toBe(2);
    expect(runner.calls).toHaveLength(1);
  });

  it("forwards full tool activity fields (input/output/status/exit) to the activity sink", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const recorded: ActivityEvent[] = [];
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
      activity: (_k, evt) => recorded.push(evt),
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_act", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [
      {
        type: "tool_use",
        tool: "bash",
        title: "ls",
        status: "completed",
        input: { command: "ls -la" },
        output: "a\nb",
        exit: 0,
        durationMs: 12,
      } as OpencodeEvent,
      textEvent("done"),
    ]);
    await mgr.whenIdle();

    const tool = recorded.find((e) => e.type === "tool_use");
    expect(tool?.input).toEqual({ command: "ls -la" });
    expect(tool?.output).toBe("a\nb");
    expect(tool?.status).toBe("completed");
    expect(tool?.exit).toBe(0);
    expect(tool?.durationMs).toBe(12);
    expect(tool?.turn).toBe(1);
  });

  it("increments the turn count when a turn starts, so it is visible mid-run", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_mid", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);

    const mid = mgr.listActive().find((d) => d.root_id === "om_mid");
    expect(mid?.status).toBe("running");
    expect(mid?.turns).toBe(1);
    expect(mid?.total_tokens).toBe(0);

    runner.finish(0, [textEvent("好了")]);
    await mgr.whenIdle();
    const after = mgr.listActive().find((d) => d.root_id === "om_mid");
    expect(after?.turns).toBe(1);
    expect(after?.total_tokens).toBe(120);
  });

  it("persists a session name and reports per-session + aggregate tokens without double counting", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(
      msg({ message_id: "om_tok", text: "/chat tasking 帮我看看 token 统计\n第二行" }),
    );
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("好")]);
    await mgr.whenIdle();

    expect(store.getDirectSession("om_tok")?.name).toBe("帮我看看 token 统计 第二行");
    const view = mgr.listActive().find((d) => d.root_id === "om_tok");
    expect(view?.name).toBe("帮我看看 token 统计 第二行");
    expect(view?.turns).toBe(1);
    expect(view?.input_tokens).toBe(100);
    expect(view?.output_tokens).toBe(20);
    expect(view?.total_tokens).toBe(120);
    expect(view?.agent).toBe("build");
    expect(view?.model).toBeNull();
    expect(mgr.aggregateTotals().total_tokens).toBe(120);

    // Simulated daemon restart: per-session counters are durable; the daemon
    // aggregate is not.
    const mgr2 = new DirectSessionManager({
      feishu: new FakeFeishu(),
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: new FakeRunner().spawn,
    });
    const restored = mgr2.listActive().find((d) => d.root_id === "om_tok");
    expect(restored?.turns).toBe(1);
    expect(restored?.input_tokens).toBe(100);
    expect(restored?.output_tokens).toBe(20);
    expect(restored?.total_tokens).toBe(120);
    expect(mgr2.aggregateTotals().total_tokens).toBe(0);

    await mgr.handleThreadMessage(
      msg({
        message_id: "om_tok_done",
        root_id: "om_tok",
        text: "/done",
        create_time: "1700000300",
      }),
    );
    expect(mgr.listActive()).toHaveLength(0);
    expect(mgr.aggregateTotals().total_tokens).toBe(120);
  });

  it("is idempotent for a re-delivered /chat root (no duplicate session, no re-run, no reply)", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_dupchat", text: "/chat tasking 首问" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("首答")]);
    await mgr.whenIdle();
    const sid = store.getDirectSession("om_dupchat")?.session_id;
    expect(sid).toBeTruthy();

    const replies = feishu.sent("om_dupchat").length;
    const handled = await mgr.handleIntakeMessage(
      msg({ message_id: "om_dupchat", text: "/chat tasking 首问" }),
    );
    expect(handled).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(runner.calls).toHaveLength(1);
    expect(store.getDirectSession("om_dupchat")?.session_id).toBe(sid);
    expect(feishu.sent("om_dupchat")).toHaveLength(replies);
  });

  it("skips re-creating a /chat root after /done silently", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
      deleteSession: async () => {},
      clearActivity: () => {},
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_donechat", text: "/chat tasking 首问" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答")]);
    await mgr.whenIdle();
    await mgr.handleThreadMessage(
      msg({
        message_id: "om_dc1",
        root_id: "om_donechat",
        text: "/done",
        create_time: "1700000200",
      }),
    );
    const replies = feishu.sent("om_donechat").length;
    const handled = await mgr.handleIntakeMessage(
      msg({ message_id: "om_donechat", text: "/chat tasking 首问" }),
    );
    expect(handled).toBe(true);
    expect(runner.calls).toHaveLength(1);
    expect(store.getDirectSession("om_donechat")?.status).toBe("done");
    expect(feishu.sent("om_donechat")).toHaveLength(replies);
  });

  it("/stop aborts the in-flight turn and replies with an interruption note", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_root8", text: "/chat tasking 长任务" }));
    await runner.waitForCall(1);
    await mgr.handleThreadMessage(
      msg({ message_id: "om_s1", root_id: "om_root8", text: "/stop", create_time: "1700000020" }),
    );
    expect(feishu.sent("om_root8").some((t) => t.includes("已中断"))).toBe(true);
    expect(store.getDirectSession("om_root8")?.status).toBe("idle");
    runner.finish(0, [textEvent("partial")]);
    await mgr.whenIdle();
  });

  it("stop() aborts the in-flight turn and drops queued follow-ups (daemon shutdown)", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_sd1", text: "/chat tasking 长任务" }));
    await runner.waitForCall(1);
    await mgr.handleThreadMessage(
      msg({ message_id: "om_sd2", root_id: "om_sd1", text: "排队跟进", create_time: "1700000120" }),
    );
    mgr.stop();
    expect(runner.calls[0]?.signal?.aborted).toBe(true);
    runner.finish(0, [textEvent("partial")]);
    await mgr.whenIdle();
    expect(store.getDirectSession("om_sd1")?.status).toBe("idle");
    expect(runner.calls).toHaveLength(1);
  });

  it("stop() while another session waits for the dir slot starts no new turn", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_q1", text: "/chat tasking 任务一" }));
    await runner.waitForCall(1);
    await mgr.handleIntakeMessage(msg({ message_id: "om_q2", text: "/chat tasking 任务二" }));
    await new Promise((r) => setTimeout(r, 20));
    mgr.stop();
    runner.finish(0, [textEvent("任务一完成")]);
    await mgr.whenIdle();
    expect(runner.calls).toHaveLength(1);
    expect(store.getDirectSession("om_q2")?.status).toBe("idle");
  });

  it("recover() marks orphaned running sessions idle and notifies the thread", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    store.upsertDirectSession({
      root_id: "om_old",
      chat_id: "oc_chat",
      project: "tasking",
      path: "/repos/tasking",
      session_id: "ses_old",
      status: "running",
    });
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.recover();
    expect(store.getDirectSession("om_old")?.status).toBe("idle");
    expect(feishu.sent("om_old").some((t) => t.includes("中断"))).toBe(true);
  });

  it("expireIdle() marks sessions past the TTL as expired and deletes the opencode session", () => {
    store.upsertDirectSession({
      root_id: "om_ttl",
      chat_id: "oc_chat",
      project: null,
      path: "/x",
      session_id: "ses_ttl",
      status: "idle",
    });
    const deleted: string[] = [];
    const cleared: string[] = [];
    const mgr = new DirectSessionManager({
      feishu: new FakeFeishu(),
      store,
      config: () => directConfig({ idle_ttl_ms: 1000 }),
      logger: fakeLogger(),
      turnDriver: new FakeRunner().spawn,
      deleteSession: async (sid) => {
        deleted.push(sid);
      },
      clearActivity: (key) => cleared.push(key),
    });
    const count = mgr.expireIdle(Date.now() + 5000);
    expect(count).toBe(1);
    expect(store.getDirectSession("om_ttl")?.status).toBe("expired");
    expect(deleted).toEqual(["ses_ttl"]);
    expect(cleared).toEqual(["direct:om_ttl"]);
  });

  it("listActive() exposes running/idle sessions with queue depth and activity id", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_la", text: "/chat tasking 一号" }));
    await runner.waitForCall(1);
    const running = mgr.listActive().find((d) => d.root_id === "om_la");
    expect(running?.id).toBe("direct:om_la");
    expect(running?.status).toBe("running");
    expect(running?.project).toBe("tasking");

    await mgr.handleThreadMessage(
      msg({ message_id: "om_la2", root_id: "om_la", text: "继续", create_time: "1700000100" }),
    );
    expect(mgr.listActive().find((d) => d.root_id === "om_la")?.queued).toBe(1);
    runner.finish(0, [textEvent("好")]);
    await runner.waitForCall(2);
    runner.finish(1, [textEvent("继续答")]);
    await mgr.whenIdle();
    expect(mgr.listActive().find((d) => d.root_id === "om_la")?.status).toBe("idle");
  });

  it("skips messages at or before the session cursor (sweep redelivery)", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_root9", text: "/chat tasking 一" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("一答")]);
    await mgr.whenIdle();
    store.advanceDirectCursor("om_root9", "om_redup", "1700000005");

    const handled = await mgr.handleThreadMessage(
      msg({
        message_id: "om_redup",
        root_id: "om_root9",
        text: "旧消息",
        create_time: "1700000005",
      }),
    );
    expect(handled).toBe(true);
    expect(runner.calls).toHaveLength(1);
  });

  it("reports failure when the turn exits non-zero", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_root10", text: "/chat tasking 崩一下" }));
    await runner.waitForCall(1);
    runner.finish(0, [], 1);
    await mgr.whenIdle();
    expect(feishu.sent("om_root10").some((t) => t.includes("未完成"))).toBe(true);
    expect(store.getDirectSession("om_root10")?.status).toBe("idle");
  });
});

function fakeLogger(lines?: string[]) {
  const push = (msg: unknown, fields?: unknown): void => {
    lines?.push(fields === undefined ? String(msg) : `${String(msg)} ${JSON.stringify(fields)}`);
  };
  return {
    info: push,
    warn: push,
    error: push,
    debug: push,
    level: "debug",
    child: () => fakeLogger(lines),
  };
}

describe("DirectSessionManager sweep backstop", () => {
  function setup() {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    return { feishu, runner, mgr };
  }

  it("captures thread_id from the creation ack and sweeps missed thread messages", async () => {
    const { feishu, runner, mgr } = setup();
    mgr.start();
    await mgr.handleIntakeMessage(msg({ message_id: "om_sw1", text: "/chat tasking 第一问" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("第一答")]);
    await mgr.whenIdle();
    expect(store.getDirectSession("om_sw1")?.thread_id).toBe("omt_om_sw1");

    feishu.seedThread(
      "omt_om_sw1",
      msg({
        message_id: "om_missed",
        root_id: "om_sw1",
        text: "停机期间发的追问",
        create_time: "1700000009",
      }),
    );
    await mgr.sweepThreads();
    await runner.waitForCall(2);
    expect(runner.calls[1]?.cmd[runner.calls[1].cmd.length - 1]).toBe("停机期间发的追问");
    runner.finish(1, [textEvent("第二答")]);
    await mgr.whenIdle();

    await mgr.sweepThreads();
    await new Promise((r) => setTimeout(r, 20));
    expect(runner.calls).toHaveLength(2);
  });

  it("skips sessions without thread_id during sweep", async () => {
    const { feishu, runner, mgr } = setup();
    store.upsertDirectSession({
      root_id: "om_sw2",
      chat_id: "oc_chat",
      project: "tasking",
      path: "/repos/tasking",
      session_id: "ses_old",
      status: "idle",
    });
    await mgr.sweepThreads();
    await new Promise((r) => setTimeout(r, 20));
    expect(runner.calls).toHaveLength(0);
    expect(feishu.replies).toHaveLength(0);
  });
});

describe("DirectSessionManager review fixes", () => {
  function setup(config = directConfig) {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    return { feishu, runner, mgr };
  }

  it("serializes turns across sessions targeting the same directory", async () => {
    const { runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_dA", text: "/chat tasking A1" }));
    await runner.waitForCall(1);
    await mgr.handleIntakeMessage(msg({ message_id: "om_dB", text: "/chat tasking B1" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(runner.calls).toHaveLength(1);
    runner.finish(0, [textEvent("A答")]);
    await runner.waitForCall(2);
    expect(runner.calls[1]?.cmd[runner.calls[1].cmd.length - 1]).toBe("B1");
    runner.finish(1, [textEvent("B答")]);
    await mgr.whenIdle();
  });

  it("does not swallow distinct messages arriving within the same second", async () => {
    const { runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_s0", text: "/chat tasking 起点" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("0答")]);
    await mgr.whenIdle();

    await mgr.handleThreadMessage(
      msg({ message_id: "om_s1", root_id: "om_s0", text: "一", create_time: "1700000100" }),
    );
    await mgr.handleThreadMessage(
      msg({ message_id: "om_s2", root_id: "om_s0", text: "二", create_time: "1700000100" }),
    );
    await runner.waitForCall(2);
    runner.finish(1, [textEvent("一答")]);
    await runner.waitForCall(3);
    expect(runner.calls[2]?.cmd[runner.calls[2].cmd.length - 1]).toBe("二");

    await mgr.handleThreadMessage(
      msg({ message_id: "om_s1", root_id: "om_s0", text: "一", create_time: "1700000100" }),
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(runner.calls).toHaveLength(3);
    runner.finish(2, [textEvent("二答")]);
    await mgr.whenIdle();
  });

  it("/done reports cumulative turns and tokens", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_cum", text: "/chat tasking 一" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("1答")]);
    await mgr.whenIdle();
    await mgr.handleThreadMessage(
      msg({ message_id: "om_c1", root_id: "om_cum", text: "二", create_time: "1700000021" }),
    );
    await runner.waitForCall(2);
    runner.finish(1, [textEvent("2答")]);
    await mgr.whenIdle();

    await mgr.handleThreadMessage(
      msg({ message_id: "om_c2", root_id: "om_cum", text: "/done", create_time: "1700000022" }),
    );
    const done = feishu.sent("om_cum").find((t) => t.includes("已结束"));
    expect(done).toContain("2 turn");
    expect(done).toContain("240");
  });

  it("path_roots checks the realpath so symlink escapes are rejected", async () => {
    const allowed = mkdtempSync(join(tmpdir(), "tasking-allowed-"));
    const outside = mkdtempSync(join(tmpdir(), "tasking-outside-"));
    const link = join(allowed, "inside");
    symlinkSync(outside, link, "dir");
    try {
      const { feishu, runner, mgr } = setup(() => directConfig({ path_roots: [allowed] }));
      await mgr.handleIntakeMessage(msg({ message_id: "om_link", text: `/chat ${link} hi` }));
      expect(feishu.sent("om_link")[0]).toContain("不在允许的路径范围");
      expect(runner.calls).toHaveLength(0);
    } finally {
      rmSync(link, { force: true });
      rmSync(allowed, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("counts permission rejections only from permission-related tool errors", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_perm", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [
      {
        type: "tool_use",
        tool: "bash",
        status: "error",
        error: "The user rejected permission to use this specific tool call.",
      },
      { type: "tool_use", tool: "bash", status: "error", error: "command not found" },
      textEvent("done"),
    ]);
    await mgr.whenIdle();
    const summary = feishu.sent("om_perm").find((t) => t.includes("done"));
    expect(summary).toContain("1 个操作被权限拒绝");
  });
});

describe("DirectSessionManager coverage gaps (review TAS-41)", () => {
  function setup(config = directConfig) {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    return { feishu, runner, mgr };
  }

  it("/chat bare lists projects; /chat help shows usage", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_l1", text: "/chat" }));
    expect(feishu.sent("om_l1")[0]).toContain("可用项目");
    expect(feishu.sent("om_l1")[0]).toContain("tasking");
    await mgr.handleIntakeMessage(msg({ message_id: "om_l2", text: "/chat help" }));
    expect(feishu.sent("om_l2")[0]).toContain("直连会话用法");
    expect(runner.calls).toHaveLength(0);
  });

  it("/chat <project> without a message prompts for the first message", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_e1", text: "/chat tasking" }));
    expect(feishu.sent("om_e1")[0]).toContain("带上首条消息");
    expect(store.getDirectSession("om_e1")).toBeNull();
    expect(runner.calls).toHaveLength(0);
  });

  it("/stop with no in-flight turn reports no running task", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_si", text: "/chat tasking 先跑" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("完事")]);
    await mgr.whenIdle();
    await mgr.handleThreadMessage(
      msg({ message_id: "om_si2", root_id: "om_si", text: "/stop", create_time: "1700000030" }),
    );
    expect(feishu.sent("om_si").some((t) => t.includes("没有运行中的任务"))).toBe(true);
  });

  it("in-thread /help and unknown slash commands get chat-scoped replies", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_h1", text: "/chat tasking 开始" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("ok")]);
    await mgr.whenIdle();
    await mgr.handleThreadMessage(
      msg({ message_id: "om_h2", root_id: "om_h1", text: "/help", create_time: "1700000040" }),
    );
    await mgr.handleThreadMessage(
      msg({ message_id: "om_h3", root_id: "om_h1", text: "/state", create_time: "1700000041" }),
    );
    expect(feishu.cardTexts("om_h1").some((t) => t.includes("直连会话帮助"))).toBe(true);
    expect(feishu.sent("om_h1").some((t) => t.includes("未知命令"))).toBe(true);
    expect(runner.calls).toHaveLength(1);
  });

  it("expired sessions get a one-time expiry hint", async () => {
    const { feishu, runner, mgr } = setup(() => directConfig({ idle_ttl_ms: 1000 }));
    await mgr.handleIntakeMessage(msg({ message_id: "om_x1", text: "/chat tasking 开始" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("ok")]);
    await mgr.whenIdle();
    mgr.expireIdle(Date.now() + 5000);
    await mgr.handleThreadMessage(
      msg({ message_id: "om_x2", root_id: "om_x1", text: "还在么", create_time: "1700000050" }),
    );
    await mgr.handleThreadMessage(
      msg({ message_id: "om_x3", root_id: "om_x1", text: "又来了", create_time: "1700000051" }),
    );
    expect(feishu.sent("om_x1").filter((t) => t.includes("已过期")).length).toBeGreaterThanOrEqual(
      1,
    );
    expect(feishu.sent("om_x1").filter((t) => t.includes("已过期")).length).toBeLessThanOrEqual(1);
    expect(runner.calls).toHaveLength(1);
  });

  it("waits for a free global slot when max_concurrent=1", async () => {
    const { runner, mgr } = setup(() => directConfig({ max_concurrent: 1 }));
    await mgr.handleIntakeMessage(msg({ message_id: "om_g1", text: "/chat tasking A" }));
    await runner.waitForCall(1);
    await mgr.handleIntakeMessage(msg({ message_id: "om_g2", text: "/chat tasking B" }));
    await new Promise((r) => setTimeout(r, 80));
    expect(runner.calls).toHaveLength(1);
    runner.finish(0, [textEvent("A答")]);
    await runner.waitForCall(2);
    expect(runner.calls[1]?.cwd).toBe(projectPath());
    runner.finish(1, [textEvent("B答")]);
    await mgr.whenIdle();
  });

  it("truncates over-long final answers to the hard cap", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_t1", text: "/chat tasking 长文" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("啊".repeat(6000))]);
    await mgr.whenIdle();
    const summary = feishu.sent("om_t1").find((t) => t.includes("已截断"));
    expect(summary).toBeDefined();
    expect((summary ?? "").length).toBeLessThan(4000);
  });
});

describe("DirectSessionManager verbosity levels", () => {
  it("quiet mode posts the final text without the stats line or tool mirror", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "quiet" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_q1", text: "/chat tasking 安静点" }));
    await runner.waitForCall(1);
    runner.finish(0, [toolEvent("npm test"), textEvent("结果如下")]);
    await mgr.whenIdle();
    const summary = feishu.sent("om_q1").find((t) => t.includes("结果如下"));
    expect(summary).toBeDefined();
    expect(summary).not.toContain("⏱");
    expect(summary).not.toContain("🔧");
    expect(feishu.sent("om_q1").some((t) => t.startsWith("🔧"))).toBe(false);
  });

  it("quiet mode still surfaces permission rejections", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "quiet" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_q2", text: "/chat tasking 改文件" }));
    await runner.waitForCall(1);
    runner.finish(0, [
      {
        type: "tool_use",
        tool: "write",
        status: "error",
        error: "The user rejected permission to use this specific tool call.",
      },
      textEvent("被拒绝了"),
    ]);
    await mgr.whenIdle();
    const summary = feishu.sent("om_q2").find((t) => t.includes("被拒绝了"));
    expect(summary).toContain("权限拒绝");
  });
});

describe("DirectSessionManager adversarial review fixes (TAS-41)", () => {
  function setup(config = directConfig) {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    return { feishu, runner, mgr };
  }

  it("never exceeds max_concurrent even with three contending sessions", async () => {
    const dirs = [
      mkdtempSync(join(tmpdir(), "tasking-cap-1-")),
      mkdtempSync(join(tmpdir(), "tasking-cap-2-")),
      mkdtempSync(join(tmpdir(), "tasking-cap-3-")),
    ];
    try {
      let concurrent = 0;
      let peak = 0;
      const pending: Array<(r: DirectTurnOutcome) => void> = [];
      const spawn = async (): Promise<DirectTurnOutcome> => {
        concurrent++;
        peak = Math.max(peak, concurrent);
        return new Promise<DirectTurnOutcome>((resolve) => {
          pending.push((r) => {
            concurrent--;
            resolve(r);
          });
        });
      };
      const mgr = new DirectSessionManager({
        feishu: new FakeFeishu(),
        store,
        config: () => directConfig({ max_concurrent: 2 }),
        logger: fakeLogger(),
        turnDriver: spawn as never,
      });
      for (const [i, dir] of dirs.entries()) {
        await mgr.handleIntakeMessage(msg({ message_id: `om_cap${i}`, text: `/chat ${dir} 任务` }));
      }
      await new Promise((r) => setTimeout(r, 80));
      expect(peak).toBe(2);
      expect(pending).toHaveLength(2);
      for (let round = 0; round < 5 && pending.length === 0; round++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      for (const resolve of pending.splice(0)) {
        resolve({
          status: "succeeded",
          sessionId: "ses_cap",
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          error: null,
          postureOpened: false,
        });
        await new Promise((r) => setTimeout(r, 30));
      }
      for (let round = 0; round < 10 && pending.length === 0; round++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      for (const resolve of pending.splice(0)) {
        resolve({
          status: "succeeded",
          sessionId: "ses_cap",
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          error: null,
          postureOpened: false,
        });
        await new Promise((r) => setTimeout(r, 30));
      }
      await mgr.whenIdle();
      expect(peak).toBe(2);
    } finally {
      for (const d of dirs) rmSync(d, { recursive: true, force: true });
    }
  });

  it("rejects a project whose configured directory does not exist", async () => {
    const { feishu, runner, mgr } = setup(() =>
      directConfig({ projects: { ghost: join(workdir, "missing-dir") } }),
    );
    await mgr.handleIntakeMessage(msg({ message_id: "om_p404", text: "/chat ghost 你好" }));
    expect(feishu.sent("om_p404").some((t) => t.includes("路径不存在"))).toBe(true);
    expect(runner.calls).toHaveLength(0);
    expect(store.getDirectSession("om_p404")).toBeNull();
  });

  it("rejects a project whose configured path is not a directory", async () => {
    const file = join(workdir, "not-a-dir.txt");
    writeFileSync(file, "x");
    const { feishu, runner, mgr } = setup(() => directConfig({ projects: { ghost: file } }));
    await mgr.handleIntakeMessage(msg({ message_id: "om_pnd", text: "/chat ghost 你好" }));
    expect(feishu.sent("om_pnd").some((t) => t.includes("不是目录"))).toBe(true);
    expect(runner.calls).toHaveLength(0);
  });

  it("resolves a project through a symlink to its realpath", async () => {
    const real = mkdtempSync(join(tmpdir(), "tasking-proj-real-"));
    try {
      const link = join(workdir, "proj-link");
      symlinkSync(real, link);
      const { runner, mgr } = setup(() => directConfig({ projects: { tasking: link } }));
      await mgr.handleIntakeMessage(msg({ message_id: "om_sym1", text: "/chat tasking 你好" }));
      await runner.waitForCall(1);
      expect(runner.calls[0]?.cwd).toBe(realpathSync(real));
      runner.finish(0, [textEvent("ok")]);
      await mgr.whenIdle();
    } finally {
      rmSync(real, { recursive: true, force: true });
    }
  });

  it("a session queued behind a busy directory does not consume a global slot", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "tasking-dirA-"));
    const dirB = mkdtempSync(join(tmpdir(), "tasking-dirB-"));
    try {
      const { runner, mgr } = setup(() => directConfig({ max_concurrent: 2 }));
      await mgr.handleIntakeMessage(msg({ message_id: "om_q1", text: `/chat ${dirA} 一` }));
      await runner.waitForCall(1);
      await mgr.handleIntakeMessage(msg({ message_id: "om_q2", text: `/chat ${dirA} 二` }));
      await new Promise((r) => setTimeout(r, 30));
      await mgr.handleIntakeMessage(msg({ message_id: "om_q3", text: `/chat ${dirB} 三` }));
      await new Promise((r) => setTimeout(r, 60));
      expect(runner.calls).toHaveLength(2);
      expect(runner.calls[0]?.cwd).toBe(realpathSync(dirA));
      expect(runner.calls[1]?.cwd).toBe(realpathSync(dirB));
      runner.finish(0, [textEvent("一")]);
      runner.finish(1, [textEvent("三")]);
      await runner.waitForCall(3);
      expect(runner.calls[2]?.cwd).toBe(realpathSync(dirA));
      runner.finish(2, [textEvent("二")]);
      await mgr.whenIdle();
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it("survives a rejecting spawn: failure notice, idle status, follow-up works", async () => {
    const feishu = new FakeFeishu();
    let rejectFirst = true;
    const calls: string[][] = [];
    const spawn = async (): Promise<DirectTurnOutcome> => {
      if (rejectFirst) {
        rejectFirst = false;
        throw new Error("spawn ENOENT");
      }
      calls.push(["ok"]);
      return {
        status: "succeeded",
        sessionId: "ses_ok",
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        error: null,
        postureOpened: false,
      };
    };
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: spawn as never,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_sp1", text: "/chat tasking 会挂" }));
    await mgr.whenIdle();
    expect(feishu.sent("om_sp1").some((t) => t.includes("未能启动"))).toBe(true);
    expect(store.getDirectSession("om_sp1")?.status).toBe("idle");

    await mgr.handleThreadMessage(
      msg({ message_id: "om_sp2", root_id: "om_sp1", text: "再来", create_time: "1700000060" }),
    );
    await mgr.whenIdle();
    expect(calls).toHaveLength(1);
    expect(store.getDirectSession("om_sp1")?.status).toBe("idle");
  });

  it("merges multiple queued follow-ups in FIFO order with the documented separator", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_m0", text: "/chat tasking 起点" }));
    await runner.waitForCall(1);
    await mgr.handleThreadMessage(
      msg({ message_id: "om_m1", root_id: "om_m0", text: "第一补", create_time: "1700000070" }),
    );
    await mgr.handleThreadMessage(
      msg({ message_id: "om_m2", root_id: "om_m0", text: "第二补", create_time: "1700000071" }),
    );
    runner.finish(0, [textEvent("起答")]);
    await runner.waitForCall(2);
    expect(runner.calls[1]?.cmd[runner.calls[1].cmd.length - 1]).toBe("第一补\n---\n第二补");
    runner.finish(1, [textEvent("合并答")]);
    await mgr.whenIdle();
    expect(feishu.sent("om_m0").some((t) => t.includes("合并答"))).toBe(true);
  });

  it("heals thread_id capture when the creation ack fails but a later reply succeeds", async () => {
    const replies: Reply[] = [];
    let failFirst = true;
    const flakyFeishu = {
      replies,
      async replyInThread(rootId: string, text: string) {
        if (failFirst) {
          failFirst = false;
          throw new Error("feishu 500");
        }
        replies.push({ rootId, text });
        return { message_id: "om_r", root_id: rootId, thread_id: `omt_${rootId}` };
      },
      async replyFlat(rootId: string, text: string) {
        replies.push({ rootId, text });
      },
      async listThreadReplies() {
        return [];
      },
    };
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu: flakyFeishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_fl", text: "/chat tasking 测试" }));
    await runner.waitForCall(1);
    expect(store.getDirectSession("om_fl")?.thread_id).toBeNull();
    runner.finish(0, [textEvent("答")]);
    await mgr.whenIdle();
    expect(store.getDirectSession("om_fl")?.thread_id).toBe("omt_om_fl");
    expect(store.getDirectSession("om_fl")?.status).toBe("idle");
  });

  it("a fresh manager instance skips already-processed boundary-second messages (restart redelivery)", async () => {
    const { runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_rs", text: "/chat tasking 一" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("一答")]);
    await mgr.whenIdle();

    await mgr.handleThreadMessage(
      msg({ message_id: "om_edge", root_id: "om_rs", text: "边界消息", create_time: "1700000080" }),
    );
    await runner.waitForCall(2);
    runner.finish(1, [textEvent("边界答")]);
    await mgr.whenIdle();

    const mgr2 = new DirectSessionManager({
      feishu: new FakeFeishu(),
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    const handled = await mgr2.handleThreadMessage(
      msg({ message_id: "om_edge", root_id: "om_rs", text: "边界消息", create_time: "1700000080" }),
    );
    expect(handled).toBe(true);
    await new Promise((r) => setTimeout(r, 40));
    expect(runner.calls).toHaveLength(2);
  });
});

describe("DirectSessionManager UX review fixes (TAS-41)", () => {
  function setup(config = directConfig) {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    return { feishu, runner, mgr };
  }

  it("/stop clears queued follow-ups and reports the count", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_st1", text: "/chat tasking 长任务" }));
    await runner.waitForCall(1);
    await mgr.handleThreadMessage(
      msg({ message_id: "om_st2", root_id: "om_st1", text: "补一", create_time: "1700000090" }),
    );
    await mgr.handleThreadMessage(
      msg({ message_id: "om_st3", root_id: "om_st1", text: "补二", create_time: "1700000091" }),
    );
    await mgr.handleThreadMessage(
      msg({ message_id: "om_st4", root_id: "om_st1", text: "/stop", create_time: "1700000092" }),
    );
    const stopReply = feishu.sent("om_st1").find((t) => t.includes("已中断"));
    expect(stopReply).toContain("2 条排队消息");
    runner.finish(0, [textEvent("部分")]);
    await mgr.whenIdle();
    expect(runner.calls).toHaveLength(1);
    expect(store.getDirectSession("om_st1")?.status).toBe("idle");
  });

  it("replies a hint for non-text (empty-text) messages instead of silence", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_nt1", text: "/chat tasking 开始" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("ok")]);
    await mgr.whenIdle();
    await mgr.handleThreadMessage(
      msg({
        message_id: "om_nt2",
        root_id: "om_nt1",
        msg_type: "image",
        text: "",
        create_time: "1700000095",
      }),
    );
    expect(feishu.sent("om_nt1").some((t) => t.includes("暂仅支持文本"))).toBe(true);
    expect(runner.calls).toHaveLength(1);
  });

  it("tells the user when queued messages will be merged", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_qm1", text: "/chat tasking 起点" }));
    await runner.waitForCall(1);
    await mgr.handleThreadMessage(
      msg({ message_id: "om_qm2", root_id: "om_qm1", text: "第一条", create_time: "1700000096" }),
    );
    expect(feishu.sent("om_qm1").some((t) => t.includes("已排队") && !t.includes("合并"))).toBe(
      true,
    );
    await mgr.handleThreadMessage(
      msg({ message_id: "om_qm3", root_id: "om_qm1", text: "第二条", create_time: "1700000097" }),
    );
    expect(feishu.sent("om_qm1").some((t) => t.includes("合并为一轮"))).toBe(true);
    runner.finish(0, [textEvent("起答")]);
    await runner.waitForCall(2);
    runner.finish(1, [textEvent("合并答")]);
    await mgr.whenIdle();
  });

  it("/done reports discarded queued messages", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_dd1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    await mgr.handleThreadMessage(
      msg({ message_id: "om_dd2", root_id: "om_dd1", text: "排队消息", create_time: "1700000098" }),
    );
    await mgr.handleThreadMessage(
      msg({ message_id: "om_dd3", root_id: "om_dd1", text: "/done", create_time: "1700000099" }),
    );
    const done = feishu.sent("om_dd1").find((t) => t.includes("已结束"));
    expect(done).toContain("1 条排队消息");
    runner.finish(0, [textEvent("ok")]);
    await mgr.whenIdle();
    expect(runner.calls).toHaveLength(1);
  });

  it("ACK shows the project name (not the full path); path mode shows the basename", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_ack1", text: "/chat tasking 干活" }));
    const ack1 = feishu.sent("om_ack1")[0];
    expect(ack1).toContain("项目 tasking");
    expect(ack1).not.toContain(workdir);
    const target = mkdtempSync(join(tmpdir(), "tasking-ack-path-"));
    try {
      await mgr.handleIntakeMessage(msg({ message_id: "om_ack2", text: `/chat ${target} 干活` }));
      const ack2 = feishu.sent("om_ack2")[0];
      expect(ack2).toContain("目录 tasking-ack-path-");
      expect(ack2).not.toContain("/tmp/tasking-ack-path-");
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
    await runner.waitForCall(2);
    runner.finish(0, [textEvent("一")]);
    runner.finish(1, [textEvent("二")]);
    await mgr.whenIdle();
  });

  it("intake /chat help leads with how to start; thread /help leads with reply-to-continue", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_hh1", text: "/chat help" }));
    const intakeHelp = feishu.sent("om_hh1")[0];
    expect(intakeHelp.indexOf("/chat <项目名|绝对路径>")).toBeLessThan(
      intakeHelp.indexOf("直接回复"),
    );
    await mgr.handleIntakeMessage(msg({ message_id: "om_hh2", text: "/chat tasking 开始" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("ok")]);
    await mgr.whenIdle();
    await mgr.handleThreadMessage(
      msg({ message_id: "om_hh3", root_id: "om_hh2", text: "/help", create_time: "1700000105" }),
    );
    const threadHelp = feishu.cardTexts("om_hh2").find((t) => t.includes("直接回复本话题"));
    expect(threadHelp?.indexOf("直接回复本话题")).toBeLessThan(
      threadHelp?.indexOf("/chat <项目|路径>") ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it("notifies when waiting on a busy directory", async () => {
    const { feishu, runner, mgr } = setup();
    const dirA = mkdtempSync(join(tmpdir(), "tasking-busy-"));
    try {
      await mgr.handleIntakeMessage(msg({ message_id: "om_b1", text: `/chat ${dirA} 一` }));
      await runner.waitForCall(1);
      await mgr.handleIntakeMessage(msg({ message_id: "om_b2", text: `/chat ${dirA} 二` }));
      await new Promise((r) => setTimeout(r, 40));
      expect(feishu.sent("om_b2").some((t) => t.includes("排队等待中"))).toBe(true);
      runner.finish(0, [textEvent("一答")]);
      await runner.waitForCall(2);
      runner.finish(1, [textEvent("二答")]);
      await mgr.whenIdle();
    } finally {
      rmSync(dirA, { recursive: true, force: true });
    }
  });
});

describe("DirectSessionManager stop-then-continue regression", () => {
  it("a follow-up after /stop starts a fresh turn loop", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const store2 = new BindingStoreImpl(join(mkdtempSync(join(tmpdir(), "tas-stop-reg-")), "b.db"));
    const mgr = new DirectSessionManager({
      feishu,
      store: store2,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    try {
      await mgr.handleIntakeMessage(msg({ message_id: "om_sr1", text: "/chat tasking 长" }));
      await runner.waitForCall(1);
      await mgr.handleThreadMessage(
        msg({ message_id: "om_sr2", root_id: "om_sr1", text: "/stop", create_time: "1700000110" }),
      );
      runner.finish(0, [textEvent("部分")]);
      await mgr.whenIdle();

      await mgr.handleThreadMessage(
        msg({ message_id: "om_sr3", root_id: "om_sr1", text: "继续", create_time: "1700000111" }),
      );
      await runner.waitForCall(2);
      expect(runner.calls[1]?.cmd[runner.calls[1].cmd.length - 1]).toBe("继续");
      runner.finish(1, [textEvent("继续答")]);
      await mgr.whenIdle();
      expect(feishu.sent("om_sr1").some((t) => t.includes("继续答"))).toBe(true);
    } finally {
      store2.close();
    }
  });
});

function noCardPort(feishu: FakeFeishu): DirectFeishuPort {
  return {
    replyInThread: (rootId, text) => feishu.replyInThread(rootId, text),
    replyFlat: (rootId, text) => feishu.replyFlat(rootId, text),
  };
}

function failingUpdatePort(feishu: FakeFeishu): DirectFeishuPort {
  return {
    replyInThread: (rootId, text) => feishu.replyInThread(rootId, text),
    replyFlat: (rootId, text) => feishu.replyFlat(rootId, text),
    replyCardInThread: (rootId, card) => feishu.replyCardInThread(rootId, card),
    updateCard: async () => {
      throw new Error("card update failed");
    },
  };
}

describe("DirectSessionManager turn cards (detailed)", () => {
  function setup(
    port: (feishu: FakeFeishu) => DirectFeishuPort = (f) => f,
    extra: { cardRetryDelayMs?: number } = {},
  ) {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu: port(feishu),
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
      cardRetryDelayMs: extra.cardRetryDelayMs ?? 0,
    });
    return { feishu, runner, mgr };
  }

  it("creates the turn card up front instead of an ACK and per-tool texts", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_tc1", text: "/chat tasking 跑测试" }));
    await runner.waitForCall(1);
    expect(feishu.cards).toHaveLength(1);
    expect(feishu.sent("om_tc1")).toEqual([]);
    runner.finish(0, [toolEvent("npm test"), textEvent("通过")]);
    await mgr.whenIdle();
    expect(feishu.cards).toHaveLength(2);
    expect(JSON.stringify(feishu.cards[1]?.card)).toContain("通过");
    expect(feishu.updateJson().at(-1)).toContain("npm test");
    expect(store.getDirectSession("om_tc1")?.card_message_id).toBe("om_card_1");
    expect(store.getDirectSession("om_tc1")?.last_prompt).toBe("跑测试");
  });

  it("creates the card before waiting for the directory slot and shows the queued state", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_qa", text: "/chat tasking 第一个" }));
    await runner.waitForCall(1);
    await mgr.handleIntakeMessage(msg({ message_id: "om_qb", text: "/chat tasking 第二个" }));
    await vi.waitFor(() => expect(feishu.cards.some((c) => c.rootId === "om_qb")).toBe(true));
    expect(runner.calls).toHaveLength(1);
    const queuedCard = feishu.cards.find((c) => c.rootId === "om_qb");
    expect(JSON.stringify(queuedCard?.card)).toContain("排队中");
    runner.finish(0, [textEvent("A 完成")]);
    await runner.waitForCall(2);
    runner.finish(1, [textEvent("B 完成")]);
    await mgr.whenIdle();
  });

  it("coalesces rapid tool events and flushes the terminal state immediately", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_co1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    const call = runner.calls[0];
    call?.onEvent?.(toolEvent("first"));
    call?.onEvent?.(toolEvent("second"));
    call?.onEvent?.(toolEvent("third"));
    expect(feishu.updates).toHaveLength(0);
    runner.finish(0, [textEvent("完成")]);
    await mgr.whenIdle();
    const last = feishu.updateJson().at(-1) ?? "";
    expect(last).toContain("first");
    expect(last).toContain("third");
    expect(feishu.updates).toHaveLength(1);
  });

  it("seals the previous turn card when the next turn starts, keeping its panels", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_se1", text: "/chat tasking 第一轮" }));
    await runner.waitForCall(1);
    runner.finish(0, [toolEvent("npm test"), textEvent("第一答")]);
    await mgr.whenIdle();
    await mgr.handleThreadMessage(
      msg({ message_id: "om_se2", root_id: "om_se1", text: "第二轮", create_time: "1700000100" }),
    );
    await runner.waitForCall(2);
    const sealed = feishu.updateJson().find((c) => c.includes("该轮已结束"));
    expect(sealed).toBeDefined();
    expect(sealed).toContain("npm test");
    expect(sealed).not.toContain("中断");
    runner.finish(1, [textEvent("第二答")]);
    await mgr.whenIdle();
  });

  it("falls back to one coalesced text message when cards are unavailable", async () => {
    const { feishu, runner, mgr } = setup(noCardPort);
    await mgr.handleIntakeMessage(msg({ message_id: "om_fb1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [toolEvent("npm test"), toolEvent("git status"), textEvent("完成")]);
    await mgr.whenIdle();
    const sent = feishu.sent("om_fb1");
    const merged = sent.find((t) => t.includes("npm test"));
    expect(merged).toBeDefined();
    expect(merged).toContain("git status");
    expect(sent.some((t) => t.includes("完成"))).toBe(true);
  });

  it("switches a mid-turn update failure to the text fallback", async () => {
    const { feishu, runner, mgr } = setup(failingUpdatePort);
    await mgr.handleIntakeMessage(msg({ message_id: "om_fb2", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.calls[0]?.onEvent?.(toolEvent("npm test"));
    await mgr.handleThreadMessage(
      msg({ message_id: "om_fb3", root_id: "om_fb2", text: "排队", create_time: "1700000100" }),
    );
    runner.finish(0, [textEvent("第一答")]);
    await runner.waitForCall(2);
    runner.finish(1, [textEvent("第二答")]);
    await mgr.whenIdle();
    expect(feishu.sent("om_fb2").some((t) => t.includes("npm test"))).toBe(true);
  });

  it("text fallback after successful card updates only sends tools not yet on the card", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    let failUpdates = false;
    const port: DirectFeishuPort = {
      replyInThread: (rootId, text) => feishu.replyInThread(rootId, text),
      replyFlat: (rootId, text) => feishu.replyFlat(rootId, text),
      replyCardInThread: (rootId, card) => feishu.replyCardInThread(rootId, card),
      updateCard: async (messageId, card) => {
        if (failUpdates) throw new Error("card update failed");
        await feishu.updateCard(messageId, card);
      },
    };
    const mgr = new DirectSessionManager({
      feishu: port,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_du1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.calls[0]?.onEvent?.(toolEvent("carded-a"));
    runner.calls[0]?.onEvent?.(toolEvent("carded-b"));
    await vi.waitFor(() => expect(feishu.updates.length).toBeGreaterThanOrEqual(1), {
      timeout: 4000,
    });
    failUpdates = true;
    runner.finish(0, [toolEvent("late-c"), textEvent("完成")]);
    await mgr.whenIdle();
    const toolTexts = feishu.sent("om_du1").filter((t) => t.includes("late-c"));
    expect(toolTexts).toHaveLength(1);
    expect(toolTexts[0]).toContain("late-c");
    expect(toolTexts[0]).not.toContain("carded-a");
    expect(toolTexts[0]).not.toContain("carded-b");
  });

  it("a tool arriving while a card update is in flight still reaches the text fallback", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    let failUpdates = false;
    let firstUpdate: (() => void) | null = null;
    let updateCalls = 0;
    const port: DirectFeishuPort = {
      replyInThread: (rootId, text) => feishu.replyInThread(rootId, text),
      replyFlat: (rootId, text) => feishu.replyFlat(rootId, text),
      replyCardInThread: (rootId, card) => feishu.replyCardInThread(rootId, card),
      updateCard: (messageId, card) =>
        new Promise<void>((resolve, reject) => {
          updateCalls++;
          if (updateCalls > 1 || failUpdates) {
            reject(new Error("card update failed"));
            return;
          }
          firstUpdate = resolve;
        }),
    };
    const mgr = new DirectSessionManager({
      feishu: port,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
      cardRetryDelayMs: 0,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_rc1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.calls[0]?.onEvent?.(toolEvent("pre-flight"));
    await vi.waitFor(() => expect(updateCalls).toBeGreaterThanOrEqual(1), { timeout: 4000 });
    runner.calls[0]?.onEvent?.(toolEvent("in-flight"));
    failUpdates = true;
    firstUpdate?.();
    runner.finish(0, [textEvent("完成")]);
    await mgr.whenIdle();
    const merged = feishu
      .sent("om_rc1")
      .filter((t) => t.includes("🔧"))
      .join("\n");
    expect(merged).toContain("in-flight");
    expect(merged).not.toContain("pre-flight");
  });

  it("delays before retrying a retryable card update failure", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const attempts: number[] = [];
    const port: DirectFeishuPort = {
      replyInThread: (rootId, text) => feishu.replyInThread(rootId, text),
      replyFlat: (rootId, text) => feishu.replyFlat(rootId, text),
      replyCardInThread: (rootId, card) => feishu.replyCardInThread(rootId, card),
      updateCard: async (messageId, card) => {
        attempts.push(Date.now());
        if (attempts.length === 1) {
          throw new TaskingError("feishu_api_status", "feishu updateCard failed: 504", {
            status: 504,
          });
        }
        await feishu.updateCard(messageId, card);
      },
    };
    const mgr = new DirectSessionManager({
      feishu: port,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
      cardRetryDelayMs: 50,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_dr1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.calls[0]?.onEvent?.(toolEvent("重试后成功"));
    await vi.waitFor(() => expect(attempts.length).toBeGreaterThanOrEqual(2), { timeout: 5000 });
    expect(attempts[1] - attempts[0]).toBeGreaterThanOrEqual(50);
    runner.finish(0, [textEvent("完成")]);
    await mgr.whenIdle();
    expect(feishu.sent("om_dr1").some((t) => t.includes("🔧"))).toBe(false);
  });

  it("falls back to a single merged incremental text when the delayed retry also fails", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    let failed = false;
    const port: DirectFeishuPort = {
      replyInThread: (rootId, text) => feishu.replyInThread(rootId, text),
      replyFlat: (rootId, text) => feishu.replyFlat(rootId, text),
      replyCardInThread: (rootId, card) => feishu.replyCardInThread(rootId, card),
      updateCard: async (messageId, card) => {
        if (failed) {
          throw new TaskingError("feishu_api_status", "feishu updateCard failed: 504", {
            status: 504,
          });
        }
        await feishu.updateCard(messageId, card);
      },
    };
    const mgr = new DirectSessionManager({
      feishu: port,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
      cardRetryDelayMs: 0,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_dr2", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.calls[0]?.onEvent?.(toolEvent("已上卡"));
    await vi.waitFor(() => expect(feishu.updates.length).toBeGreaterThanOrEqual(1), {
      timeout: 4000,
    });
    failed = true;
    runner.finish(0, [toolEvent("降级增量"), textEvent("完成")]);
    await mgr.whenIdle();
    const toolTexts = feishu.sent("om_dr2").filter((t) => t.includes("🔧"));
    expect(toolTexts).toHaveLength(1);
    expect(toolTexts[0]).toContain("降级增量");
    expect(toolTexts[0]).not.toContain("已上卡");
  });

  it("recovers card mode on the next turn after a fallback turn", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    let failed = false;
    const port: DirectFeishuPort = {
      replyInThread: (rootId, text) => feishu.replyInThread(rootId, text),
      replyFlat: (rootId, text) => feishu.replyFlat(rootId, text),
      replyCardInThread: (rootId, card) => feishu.replyCardInThread(rootId, card),
      updateCard: async (messageId, card) => {
        if (failed) {
          throw new TaskingError("feishu_api_status", "feishu updateCard failed: 504", {
            status: 504,
          });
        }
        await feishu.updateCard(messageId, card);
      },
    };
    const mgr = new DirectSessionManager({
      feishu: port,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
      cardRetryDelayMs: 0,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_dr3", text: "/chat tasking 第一轮" }));
    await runner.waitForCall(1);
    failed = true;
    runner.finish(0, [toolEvent("第一轮工具"), textEvent("第一答")]);
    await mgr.whenIdle();
    expect(feishu.sent("om_dr3").some((t) => t.includes("🔧"))).toBe(true);
    const cardsAfterTurn1 = feishu.cards.length;
    failed = false;
    await mgr.handleThreadMessage(
      msg({ message_id: "om_dr4", root_id: "om_dr3", text: "第二轮", create_time: "1700000100" }),
    );
    await runner.waitForCall(2);
    expect(feishu.cards.length).toBeGreaterThan(cardsAfterTurn1);
    runner.finish(1, [textEvent("第二答")]);
    await mgr.whenIdle();
  });

  it("does not retry a non-retryable 4xx card update failure", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    let attempts = 0;
    const port: DirectFeishuPort = {
      replyInThread: (rootId, text) => feishu.replyInThread(rootId, text),
      replyFlat: (rootId, text) => feishu.replyFlat(rootId, text),
      replyCardInThread: (rootId, card) => feishu.replyCardInThread(rootId, card),
      updateCard: async () => {
        attempts++;
        throw new TaskingError("feishu_api_status", "feishu updateCard failed: 400", {
          status: 400,
        });
      },
    };
    const mgr = new DirectSessionManager({
      feishu: port,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
      cardRetryDelayMs: 0,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_dr5", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [toolEvent("快速失败工具"), textEvent("完成")]);
    await mgr.whenIdle();
    expect(attempts).toBe(1);
    expect(feishu.sent("om_dr5").some((t) => t.includes("快速失败工具"))).toBe(true);
  });

  it("serializes overlapping flushes while a card update is in flight", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    let releaseFirst: (() => void) | null = null;
    let updateCalls = 0;
    const port: DirectFeishuPort = {
      replyInThread: (rootId, text) => feishu.replyInThread(rootId, text),
      replyFlat: (rootId, text) => feishu.replyFlat(rootId, text),
      replyCardInThread: (rootId, card) => feishu.replyCardInThread(rootId, card),
      updateCard: (messageId, card) =>
        new Promise<void>((resolve) => {
          updateCalls++;
          if (updateCalls === 1) {
            releaseFirst = resolve;
            return;
          }
          void feishu.updateCard(messageId, card).then(resolve);
        }),
    };
    const mgr = new DirectSessionManager({
      feishu: port,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
      cardRetryDelayMs: 0,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_dr6", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.calls[0]?.onEvent?.(toolEvent("悬挂期间"));
    await vi.waitFor(() => expect(updateCalls).toBeGreaterThanOrEqual(1), { timeout: 4000 });
    runner.finish(0, [textEvent("完成")]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(updateCalls).toBe(1);
    releaseFirst?.();
    await mgr.whenIdle();
    expect(updateCalls).toBeGreaterThanOrEqual(2);
    expect(feishu.sent("om_dr6").some((t) => t.includes("🔧"))).toBe(false);
  });

  it("a flush waking after the turn changed neither resends old tools nor clobbers the new cursor", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    let updateAttempts = 0;
    const port: DirectFeishuPort = {
      replyInThread: (rootId, text) => feishu.replyInThread(rootId, text),
      replyFlat: (rootId, text) => feishu.replyFlat(rootId, text),
      replyCardInThread: (rootId, card) => feishu.replyCardInThread(rootId, card),
      updateCard: async () => {
        updateAttempts++;
        throw new TaskingError("feishu_api_status", "feishu updateCard failed: 504", {
          status: 504,
        });
      },
    };
    const mgr = new DirectSessionManager({
      feishu: port,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
      cardRetryDelayMs: 200,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_dr7", text: "/chat tasking 第一轮" }));
    await runner.waitForCall(1);
    runner.calls[0]?.onEvent?.(toolEvent("旧轮工具"));
    await vi.waitFor(() => expect(updateAttempts).toBeGreaterThanOrEqual(1), { timeout: 4000 });
    runner.finish(0, [textEvent("第一答")]);
    await mgr.handleThreadMessage(
      msg({ message_id: "om_dr8", root_id: "om_dr7", text: "第二轮", create_time: "1700000100" }),
    );
    await runner.waitForCall(2);
    runner.finish(1, [toolEvent("新轮工具"), textEvent("第二答")]);
    await mgr.whenIdle();
    const toolTexts = feishu.sent("om_dr7").filter((t) => t.includes("🔧"));
    expect(toolTexts.filter((t) => t.includes("旧轮工具")).length).toBeLessThanOrEqual(1);
    expect(toolTexts.some((t) => t.includes("新轮工具"))).toBe(true);
  });

  it("sends a short answer as text, not a file, when the completion card create fails", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const port: DirectFeishuPort = {
      replyInThread: (rootId, text) => feishu.replyInThread(rootId, text),
      replyFlat: (rootId, text) => feishu.replyFlat(rootId, text),
      replyCardInThread: async () => {
        throw new TaskingError("feishu_api_status", "feishu replyInThread failed: 504", {
          status: 504,
        });
      },
      updateCard: (messageId, card) => feishu.updateCard(messageId, card),
      uploadFile: (content, fileName) => feishu.uploadFile(content, fileName),
      sendFileMessage: (rootId, fileKey) => feishu.sendFileMessage(rootId, fileKey),
    };
    const mgr = new DirectSessionManager({
      feishu: port,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
      cardRetryDelayMs: 0,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_dc1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("短回答")]);
    await mgr.whenIdle();
    expect(feishu.sent("om_dc1").some((t) => t.includes("短回答"))).toBe(true);
    expect(feishu.fileMessages).toHaveLength(0);
  });
});

describe("DirectSessionManager turn card actions", () => {
  function setup() {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    return { feishu, runner, mgr };
  }

  function click(action: string, rootId: string, turn: number) {
    return {
      messageId: "om_card_1",
      chatId: "oc_chat",
      operatorOpenId: "ou_op",
      operatorName: "张三",
      value: { action, root_id: rootId, turn },
    };
  }

  it("interrupts from the card, returning the interrupted card before the slow work", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_ca1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    const reply = await mgr.handleCardAction(click("stop", "om_ca1", 1));
    expect(reply?.toast.content).toContain("中断");
    expect(JSON.stringify(reply?.card)).toContain("已中断");
    expect(feishu.sent("om_ca1").some((t) => t.includes("已中断"))).toBe(false);
    runner.finish(0, []);
    await mgr.whenIdle();
    expect(feishu.sent("om_ca1").some((t) => t.includes("已中断") && t.includes("张三"))).toBe(
      true,
    );
  });

  it("ends the session only after the confirm click, naming the operator", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_ca2", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答")]);
    await mgr.whenIdle();

    const prompt = await mgr.handleCardAction(click("done", "om_ca2", 1));
    expect(JSON.stringify(prompt?.card)).toContain("不可恢复");
    expect(feishu.sent("om_ca2").some((t) => t.includes("会话已结束"))).toBe(false);
    expect(store.getDirectSession("om_ca2")?.status).not.toBe("done");

    const confirmed = await mgr.handleCardAction(click("done_confirm", "om_ca2", 1));
    expect(confirmed?.toast.content).toContain("已结束");
    await mgr.whenIdle();
    expect(store.getDirectSession("om_ca2")?.status).toBe("done");
    expect(feishu.sent("om_ca2").some((t) => t.includes("会话已结束") && t.includes("张三"))).toBe(
      true,
    );
  });

  it("keeps the interrupted status on the sealed card after a retry", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_si1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    await mgr.handleCardAction(click("stop", "om_si1", 1));
    runner.finish(0, []);
    await mgr.whenIdle();
    await mgr.handleCardAction(click("retry", "om_si1", 1));
    await runner.waitForCall(2);
    const sealed = feishu.updateJson().find((c) => c.includes("该轮已结束")) ?? "";
    expect(sealed).toContain("已中断");
    expect(sealed).not.toContain("✅ 完成");
    runner.finish(1, [textEvent("重试答")]);
    await mgr.whenIdle();
  });

  it("answers clicks on a finished turn with a toast and no card", async () => {
    const { runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_ca3", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答")]);
    await mgr.whenIdle();
    const reply = await mgr.handleCardAction(click("stop", "om_ca3", 1));
    expect(reply?.toast.content).toContain("该轮已结束");
    expect(reply?.card).toBeUndefined();
  });

  it("executes a re-delivered click only once", async () => {
    const { runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_ca4", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    const first = await mgr.handleCardAction(click("stop", "om_ca4", 1));
    expect(first?.toast.content).toContain("中断");
    const second = await mgr.handleCardAction(click("stop", "om_ca4", 1));
    expect(second?.toast.content).toContain("已处理");
    runner.finish(0, []);
    await mgr.whenIdle();
  });

  it("retries the latest prompt as a new turn marked with its source", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_ca5", text: "/chat tasking 第一轮问题" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答一")]);
    await mgr.whenIdle();
    const reply = await mgr.handleCardAction(click("retry", "om_ca5", 1));
    expect(reply?.toast.content).toContain("重试");
    await runner.waitForCall(2);
    expect(runner.calls[1]?.cmd.at(-1)).toBe("第一轮问题");
    expect(JSON.stringify(feishu.cards.at(-1)?.card)).toContain("重试自 Turn 1");
    runner.finish(1, [textEvent("答二")]);
    await mgr.whenIdle();
  });
});

function noUploadPort(feishu: FakeFeishu): DirectFeishuPort {
  return {
    replyInThread: (rootId, text) => feishu.replyInThread(rootId, text),
    replyFlat: (rootId, text) => feishu.replyFlat(rootId, text),
    replyCardInThread: (rootId, card) => feishu.replyCardInThread(rootId, card),
    updateCard: (messageId, card) => feishu.updateCard(messageId, card),
  };
}

function failingUploadPort(feishu: FakeFeishu): DirectFeishuPort {
  return {
    replyInThread: (rootId, text) => feishu.replyInThread(rootId, text),
    replyFlat: (rootId, text) => feishu.replyFlat(rootId, text),
    replyCardInThread: (rootId, card) => feishu.replyCardInThread(rootId, card),
    updateCard: (messageId, card) => feishu.updateCard(messageId, card),
    uploadFile: async () => {
      throw new Error("missing im:resource scope");
    },
  };
}

describe("DirectSessionManager full output on demand", () => {
  function setup(port: (feishu: FakeFeishu) => DirectFeishuPort = (f) => f) {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu: port(feishu),
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    return { feishu, runner, mgr };
  }

  function fullClick(rootId: string, turn: number) {
    return {
      messageId: "om_card_1",
      chatId: "oc_chat",
      operatorOpenId: "ou_op",
      operatorName: "张三",
      value: { action: "full", root_id: rootId, turn },
    };
  }

  const richTool: OpencodeEvent = {
    type: "tool_use",
    tool: "bash",
    title: "npm test",
    status: "completed",
    exit: 0,
    durationMs: 1200,
    input: { command: "npm test" },
    output: "PASS tests/a.test.ts\nPASS tests/b.test.ts",
  };

  it("sends the latest turn's full detail as a markdown file", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_fd1", text: "/chat tasking 跑测试" }));
    await runner.waitForCall(1);
    runner.finish(0, [richTool, textEvent("全绿")]);
    await mgr.whenIdle();
    const reply = await mgr.handleCardAction(fullClick("om_fd1", 1));
    expect(reply?.toast.content).toContain("输出");
    await mgr.whenIdle();
    expect(feishu.files).toHaveLength(1);
    expect(feishu.files[0]?.fileName).toBe("direct-turn-1.md");
    const content = Buffer.from(feishu.files[0]?.content ?? new Uint8Array()).toString("utf8");
    expect(content).toContain("npm test");
    expect(content).toContain("PASS tests/b.test.ts");
    expect(feishu.fileMessages).toHaveLength(1);
    expect(feishu.fileMessages[0]?.rootId).toBe("om_fd1");
  });

  it("falls back to a long text message when upload is unavailable", async () => {
    const { feishu, runner, mgr } = setup(noUploadPort);
    await mgr.handleIntakeMessage(msg({ message_id: "om_fd2", text: "/chat tasking 跑测试" }));
    await runner.waitForCall(1);
    runner.finish(0, [richTool, textEvent("全绿")]);
    await mgr.whenIdle();
    await mgr.handleCardAction(fullClick("om_fd2", 1));
    await mgr.whenIdle();
    expect(feishu.files).toHaveLength(0);
    const fallback = feishu.sent("om_fd2").find((t) => t.includes("npm test"));
    expect(fallback).toBeDefined();
    expect(fallback).toContain("文件上传不可用");
  });

  it("points at the TUI when the detail is too large to send as a message", async () => {
    const { feishu, runner, mgr } = setup(failingUploadPort);
    await mgr.handleIntakeMessage(msg({ message_id: "om_fd3", text: "/chat tasking 跑测试" }));
    await runner.waitForCall(1);
    const huge = Array.from({ length: 2500 }, (_, i) => `L${i}-${"x".repeat(70)}`).join("\n");
    runner.finish(0, [{ ...richTool, output: huge }, textEvent("全绿")]);
    await mgr.whenIdle();
    await mgr.handleCardAction(fullClick("om_fd3", 1));
    await mgr.whenIdle();
    expect(feishu.files).toHaveLength(0);
    expect(feishu.sent("om_fd3").some((t) => t.includes("TUI"))).toBe(true);
  });
});

describe("DirectSessionManager recovery and expiry card finalization", () => {
  function storedMgr(port: (feishu: FakeFeishu) => DirectFeishuPort) {
    const feishu = new FakeFeishu();
    const mgr = new DirectSessionManager({
      feishu: port(feishu),
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
    });
    return { feishu, mgr };
  }

  function seedRunning(rootId: string, sessionId: string): void {
    store.upsertDirectSession({
      root_id: rootId,
      chat_id: "oc_chat",
      project: "tasking",
      name: "跑测试",
      path: projectPath(),
      session_id: sessionId,
      status: "running",
    });
    store.updateDirectSession(rootId, { card_message_id: `om_card_${rootId}` });
    store.updateDirectSession(rootId, { last_prompt: "跑测试" });
  }

  it("finalizes an interrupted turn's card on restart without its panels", async () => {
    const { feishu, mgr } = storedMgr((f) => f);
    seedRunning("om_rc1", "ses_rc1");
    await mgr.recover();
    expect(store.getDirectSession("om_rc1")?.status).toBe("idle");
    const patched = JSON.stringify(feishu.updates.at(-1)?.card);
    expect(patched).toContain("已中断");
    expect(patched).toContain("daemon 重启");
    expect(patched).toContain("重试");
    expect(patched).not.toContain("完整输出");
    expect(feishu.sent("om_rc1").some((t) => t.includes("上次运行被中断"))).toBe(true);
  });

  it("marks an expired session's last card as expired and clears its buttons", async () => {
    const { feishu, mgr } = storedMgr((f) => f);
    store.upsertDirectSession({
      root_id: "om_ex1",
      chat_id: "oc_chat",
      project: "tasking",
      name: "闲置",
      path: projectPath(),
      session_id: "ses_ex1",
      status: "idle",
    });
    store.updateDirectSession("om_ex1", { card_message_id: "om_card_ex1" });
    const count = mgr.expireIdle(Date.now() + 60 * 24 * 3600 * 1000);
    expect(count).toBe(1);
    await vi.waitFor(() => expect(feishu.updates.length).toBeGreaterThan(0));
    const patched = JSON.stringify(feishu.updates.at(-1)?.card);
    expect(patched).toContain("已过期");
    expect(patched).toContain("会话已过期");
    expect(patched).not.toContain('"tag":"button"');
  });

  it("still recovers the session when the card finalize fails", async () => {
    const { feishu, mgr } = storedMgr(failingUpdatePort);
    seedRunning("om_rc2", "ses_rc2");
    await expect(mgr.recover()).resolves.toBeUndefined();
    expect(store.getDirectSession("om_rc2")?.status).toBe("idle");
    expect(feishu.sent("om_rc2").some((t) => t.includes("上次运行被中断"))).toBe(true);
  });
});

describe("DirectSessionManager summary mode stays card-free", () => {
  it("never calls the card API under summary verbosity (explicit fallback path)", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig(),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_sm1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [toolEvent("npm test"), textEvent("答")]);
    await mgr.whenIdle();
    expect(feishu.cards).toHaveLength(0);
    expect(feishu.updates).toHaveLength(0);
    expect(feishu.sent("om_sm1")[0]).toContain("已创建");
    expect(feishu.sent("om_sm1").some((t) => t.includes("答"))).toBe(true);
  });
});

describe("DirectSessionManager card update resilience", () => {
  function portWithFlakyUpdate(feishu: FakeFeishu, failures: number): DirectFeishuPort {
    let remaining = failures;
    return {
      replyInThread: (rootId, text) => feishu.replyInThread(rootId, text),
      replyFlat: (rootId, text) => feishu.replyFlat(rootId, text),
      replyCardInThread: (rootId, card) => feishu.replyCardInThread(rootId, card),
      updateCard: async (messageId, card) => {
        if (remaining > 0) {
          remaining--;
          throw new Error("transient card failure");
        }
        await feishu.updateCard(messageId, card);
      },
    };
  }

  it("retries a transient update failure once and self-heals", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu: portWithFlakyUpdate(feishu, 1),
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
      cardRetryDelayMs: 0,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_rt1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [toolEvent("npm test"), textEvent("答")]);
    await mgr.whenIdle();
    expect(feishu.updates.length).toBeGreaterThan(0);
    expect(JSON.stringify(feishu.updates.at(-1)?.card)).toContain("npm test");
    expect(store.getDirectSession("om_rt1")?.card_message_id).toBe("om_card_1");
  });

  it("flushes as soon as a tool fails, without waiting for the coalescing window", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_ff1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.calls[0]?.onEvent?.({
      type: "tool_use",
      tool: "bash",
      title: "systemctl status jenkins",
      status: "completed",
      exit: 1,
      output: "Unit jenkins.service could not be found.",
    });
    await vi.waitFor(() => expect(feishu.updates).toHaveLength(1));
    expect(JSON.stringify(feishu.updates[0]?.card)).toContain("systemctl status jenkins");
    runner.finish(0, [textEvent("答")]);
    await mgr.whenIdle();
  });
});

describe("DirectSessionManager completion delivery (detailed)", () => {
  function setup(port: (feishu: FakeFeishu) => DirectFeishuPort = (f) => f) {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu: port(feishu),
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    return { feishu, runner, mgr };
  }

  it("renders the answer as a markdown result card", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_cd1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("## 结论\n\n**P0** 游标\n\n| a | b |\n|---|---|")]);
    await mgr.whenIdle();
    const result = feishu.cards.at(-1)?.card as {
      body?: { elements?: Array<{ content?: string }> };
    };
    const body = result?.body?.elements?.[0]?.content ?? "";
    expect(body).toContain("## 结论");
    expect(body).toContain("| a | b |");
    expect(feishu.sent("om_cd1")).toHaveLength(0);
  });

  it("sends a very long answer as a markdown file instead of a card", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_cd2", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    const huge = Array.from({ length: 400 }, (_, i) => `第 ${i} 行：${"x".repeat(80)}`).join("\n");
    runner.finish(0, [textEvent(huge)]);
    await mgr.whenIdle();
    expect(feishu.files).toHaveLength(1);
    expect(feishu.files[0]?.fileName).toContain("direct-answer-");
  });

  it("falls back to a long text message when the file path is unavailable", async () => {
    const { feishu, runner, mgr } = setup(noUploadPort);
    await mgr.handleIntakeMessage(msg({ message_id: "om_cd3", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    const huge = Array.from({ length: 400 }, (_, i) => `第 ${i} 行：${"x".repeat(80)}`).join("\n");
    runner.finish(0, [textEvent(huge)]);
    await mgr.whenIdle();
    expect(feishu.files).toHaveLength(0);
    expect(feishu.sent("om_cd3").some((t) => t.includes("文件上传不可用"))).toBe(true);
  });
});

describe("DirectSessionManager card-action observability", () => {
  it("logs a received card action", async () => {
    const lines: string[] = [];
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(lines),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_ob1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答")]);
    await mgr.whenIdle();
    lines.length = 0;
    await mgr.handleCardAction({
      messageId: "om_card_1",
      chatId: "oc_chat",
      operatorOpenId: "ou_op",
      operatorName: "张三",
      value: { action: "stop", root_id: "om_ob1", turn: 1 },
    });
    expect(lines.some((l) => l.includes("direct card action received"))).toBe(true);
    lines.length = 0;
    await mgr.handleCardAction({
      messageId: "om_card_1",
      chatId: "oc_chat",
      operatorOpenId: "ou_op",
      operatorName: "张三",
      value: { action: "stop", root_id: "om_ob1", turn: 1 },
    });
    expect(lines.some((l) => l.includes("deduplicated"))).toBe(true);
  });
});

describe("DirectSessionManager /done copy", () => {
  it("pluralises the turn count in the end-of-session stats", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig(),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_pl1", text: "/chat tasking 一" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答一")]);
    await mgr.whenIdle();
    await mgr.handleThreadMessage(
      msg({ message_id: "om_pl2", root_id: "om_pl1", text: "二", create_time: "1700000100" }),
    );
    await runner.waitForCall(2);
    runner.finish(1, [textEvent("答二")]);
    await mgr.whenIdle();
    await mgr.handleThreadMessage(
      msg({ message_id: "om_pl3", root_id: "om_pl1", text: "/done", create_time: "1700000200" }),
    );
    await mgr.whenIdle();
    const end = feishu.sent("om_pl1").find((t) => t.includes("会话已结束")) ?? "";
    expect(end).toContain("2 turns");
    expect(end).not.toContain("2 turn ·");
  });
});

describe("DirectSessionManager operator names", () => {
  function setup() {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    return { feishu, runner, mgr };
  }

  function click(action: string, rootId: string, turn: number, operatorOpenId = "ou_op") {
    return {
      messageId: "om_card_1",
      chatId: "oc_chat",
      operatorOpenId,
      operatorName: null,
      value: { action, root_id: rootId, turn },
    };
  }

  async function startTurn(feishu: FakeFeishu, runner: FakeRunner, mgr: DirectSessionManager) {
    await mgr.handleIntakeMessage(msg({ message_id: "om_op1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    await mgr.handleCardAction(click("stop", "om_op1", 1));
    runner.finish(0, []);
    await mgr.whenIdle();
  }

  it("resolves the operator name from the group member list", async () => {
    const { feishu, runner, mgr } = setup();
    await startTurn(feishu, runner, mgr);
    const interrupt = feishu.sent("om_op1").find((t) => t.includes("已中断")) ?? "";
    expect(interrupt).toContain("张三");
    expect(interrupt).not.toContain("ou_op");
  });

  it("falls back to the open_id when the clicker is not in the list", async () => {
    const { feishu, runner, mgr } = setup();
    feishu.members = [{ open_id: "ou_other", name: "别人" }];
    await mgr.handleIntakeMessage(msg({ message_id: "om_op2", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    await mgr.handleCardAction(click("stop", "om_op2", 1, "ou_ghost"));
    runner.finish(0, []);
    await mgr.whenIdle();
    expect(feishu.sent("om_op2").some((t) => t.includes("ou_ghost"))).toBe(true);
  });

  it("falls back to the open_id when the member lookup fails", async () => {
    const { feishu, runner, mgr } = setup();
    feishu.membersThrow = true;
    await mgr.handleIntakeMessage(msg({ message_id: "om_op3", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    await mgr.handleCardAction(click("stop", "om_op3", 1));
    runner.finish(0, []);
    await mgr.whenIdle();
    expect(feishu.sent("om_op3").some((t) => t.includes("ou_op"))).toBe(true);
  });

  it("fetches the member list once per chat and reuses the cache", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.whenIdle();
    await mgr.handleIntakeMessage(msg({ message_id: "om_op4", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    await mgr.handleCardAction(click("stop", "om_op4", 1));
    runner.finish(0, []);
    await mgr.whenIdle();
    expect(feishu.memberCalls).toBe(1);
  });

  it("prefers the name carried by the callback payload", async () => {
    const { feishu, runner, mgr } = setup();
    feishu.members = [{ open_id: "ou_op", name: "群里的名字" }];
    await mgr.handleIntakeMessage(msg({ message_id: "om_op5", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    await mgr.handleCardAction({
      messageId: "om_card_1",
      chatId: "oc_chat",
      operatorOpenId: "ou_op",
      operatorName: "回调里的名字",
      value: { action: "stop", root_id: "om_op5", turn: 1 },
    });
    runner.finish(0, []);
    await mgr.whenIdle();
    const interrupt = feishu.sent("om_op5").find((t) => t.includes("已中断")) ?? "";
    expect(interrupt).toContain("回调里的名字");
  });
});

describe("DirectSessionManager intake guard is silent", () => {
  function setup() {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    return { feishu, runner, mgr };
  }

  it("skips a re-delivered /chat root without replying or re-running", async () => {
    const { feishu, runner, mgr } = setup();
    const root = msg({ message_id: "om_gr1", text: "/chat tasking 干活" });
    await mgr.handleIntakeMessage(root);
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答")]);
    await mgr.whenIdle();
    const replies = feishu.sent("om_gr1").length;
    const sessionId = store.getDirectSession("om_gr1")?.session_id;

    await mgr.handleIntakeMessage(root);
    await mgr.whenIdle();

    expect(feishu.sent("om_gr1")).toHaveLength(replies);
    expect(runner.calls).toHaveLength(1);
    expect(store.getDirectSession("om_gr1")?.session_id).toBe(sessionId);
  });

  it("stays silent when the re-delivered root's session has ended", async () => {
    const { feishu, runner, mgr } = setup();
    const root = msg({ message_id: "om_gr2", text: "/chat tasking 干活" });
    await mgr.handleIntakeMessage(root);
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答")]);
    await mgr.whenIdle();
    await mgr.handleThreadMessage(
      msg({ message_id: "om_gr3", root_id: "om_gr2", text: "/done", create_time: "1700000100" }),
    );
    await mgr.whenIdle();
    const replies = feishu.sent("om_gr2").length;

    await mgr.handleIntakeMessage(root);
    await mgr.whenIdle();

    expect(store.getDirectSession("om_gr2")?.status).toBe("done");
    expect(feishu.sent("om_gr2")).toHaveLength(replies);
  });
});

describe("DirectSessionManager session controls", () => {
  function setup(over: Partial<DirectConfig> = {}) {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "detailed", ...over }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    return { feishu, runner, mgr };
  }

  function threadMsg(text: string, n: number) {
    return msg({ message_id: `om_sc${n}`, root_id: "om_sc1", text, create_time: `170000${n}00` });
  }

  async function createSession(mgr: DirectSessionManager, runner: FakeRunner) {
    await mgr.handleIntakeMessage(msg({ message_id: "om_sc1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答")]);
    await mgr.whenIdle();
  }

  function lastCmd(runner: FakeRunner): string[] {
    return runner.calls.at(-1)?.cmd ?? [];
  }

  it("/auto on adds --auto to the next turn and persists across turns", async () => {
    const { runner, mgr } = setup();
    await createSession(mgr, runner);
    await mgr.handleThreadMessage(threadMsg("/auto on", 2));
    await mgr.whenIdle();
    expect(store.getDirectSession("om_sc1")?.auto_approve_override).toBe("on");
    await mgr.handleThreadMessage(threadMsg("继续", 3));
    await runner.waitForCall(2);
    expect(lastCmd(runner)).toContain("--auto");
    runner.finish(1, [textEvent("答2")]);
    await mgr.whenIdle();
    await mgr.handleThreadMessage(threadMsg("/auto reset", 4));
    await mgr.handleThreadMessage(threadMsg("再来", 5));
    await runner.waitForCall(3);
    expect(lastCmd(runner)).not.toContain("--auto");
    runner.finish(2, [textEvent("答3")]);
    await mgr.whenIdle();
  });

  it("/auto once only arms the next turn", async () => {
    const { runner, mgr } = setup();
    await createSession(mgr, runner);
    await mgr.handleThreadMessage(threadMsg("/auto once", 2));
    await mgr.handleThreadMessage(threadMsg("第一", 3));
    await runner.waitForCall(2);
    expect(lastCmd(runner)).toContain("--auto");
    runner.finish(1, [textEvent("答2")]);
    await mgr.whenIdle();
    await mgr.handleThreadMessage(threadMsg("第二", 4));
    await runner.waitForCall(3);
    expect(lastCmd(runner)).not.toContain("--auto");
    runner.finish(2, [textEvent("答3")]);
    await mgr.whenIdle();
    expect(store.getDirectSession("om_sc1")?.auto_approve_override).toBeNull();
  });

  it("/auto with no argument reports the posture and its source", async () => {
    const { feishu, runner, mgr } = setup();
    await createSession(mgr, runner);
    await mgr.handleThreadMessage(threadMsg("/auto", 2));
    await mgr.whenIdle();
    const reply = feishu.cardTexts("om_sc1").find((t) => t.includes("权限姿态")) ?? "";
    expect(reply).toContain("🔒");
    expect(reply).toContain("全局配置");
  });

  it("/auto card highlights the effective posture and override wins over once", async () => {
    const { feishu, runner, mgr } = setup();
    await createSession(mgr, runner);
    await mgr.handleThreadMessage(threadMsg("/auto once", 2));
    await mgr.whenIdle();
    await mgr.handleThreadMessage(threadMsg("/auto", 3));
    await mgr.whenIdle();
    const onceCard = JSON.stringify(feishu.cards.at(-1)?.card);
    expect(onceCard).toContain("⚡ 仅下一轮放开");
    expect(onceCard).toMatch(/"content":"⚡ 仅下一轮"\},"type":"primary"/);
    expect(onceCard).not.toMatch(/"content":"🔓 本会话放开"\},"type":"primary"/);

    await mgr.handleThreadMessage(threadMsg("/auto on", 4));
    await mgr.handleThreadMessage(threadMsg("/auto once", 5));
    await mgr.handleThreadMessage(threadMsg("/auto", 6));
    await mgr.whenIdle();
    const onCard = JSON.stringify(feishu.cards.at(-1)?.card);
    expect(onCard).toContain("🔓 本会话放开");
    expect(onCard).toMatch(/"content":"🔓 本会话放开"\},"type":"primary"/);
  });

  it("the once-armed turn is marked ⚡ on its turn card and reverts afterwards", async () => {
    const { feishu, runner, mgr } = setup();
    await createSession(mgr, runner);
    await mgr.handleThreadMessage(threadMsg("/auto once", 2));
    await mgr.whenIdle();
    await mgr.handleThreadMessage(threadMsg("放开这轮", 3));
    await runner.waitForCall(2);
    expect(lastCmd(runner)).toContain("--auto");
    runner.finish(1, [textEvent("答2")]);
    await mgr.whenIdle();
    const sealed = feishu.updates.map((u) => JSON.stringify(u.card));
    expect(sealed.some((c) => c.includes("⚡ 下轮放开"))).toBe(true);
    await mgr.handleThreadMessage(threadMsg("下一轮", 4));
    await runner.waitForCall(3);
    expect(lastCmd(runner)).not.toContain("--auto");
    runner.finish(2, [textEvent("答3")]);
    await mgr.whenIdle();
  });

  it("/auto posture card buttons apply and revert the override", async () => {
    const { runner, mgr } = setup();
    await createSession(mgr, runner);
    const click = (action: string) => ({
      messageId: "om_card_auto1",
      chatId: "oc_chat",
      operatorOpenId: "ou_op",
      operatorName: "张三",
      value: { action, root_id: "om_sc1" },
    });
    const on = await mgr.handleCardAction(click("auto_on"));
    expect(on?.toast.type).toBe("success");
    expect(store.getDirectSession("om_sc1")?.auto_approve_override).toBe("on");
    const onAgain = await mgr.handleCardAction(click("auto_on"));
    expect(onAgain?.toast.type).toBe("success");
    expect(onAgain?.toast.content).not.toBe("该操作已处理");
    const once = await mgr.handleCardAction(click("auto_once"));
    expect(once?.toast.type).toBe("success");
    await mgr.handleThreadMessage(threadMsg("继续", 3));
    await runner.waitForCall(2);
    expect(lastCmd(runner)).toContain("--auto");
    runner.finish(1, [textEvent("答2")]);
    await mgr.whenIdle();
    const off = await mgr.handleCardAction(click("auto_off"));
    expect(off?.toast.type).toBe("success");
    expect(store.getDirectSession("om_sc1")?.auto_approve_override).toBeNull();
  });

  it("/agent and /model override the next turn's command", async () => {
    const { runner, mgr } = setup();
    await createSession(mgr, runner);
    await mgr.handleThreadMessage(threadMsg("/agent review", 2));
    await mgr.handleThreadMessage(threadMsg("/model deepseek/x", 3));
    await mgr.whenIdle();
    await mgr.handleThreadMessage(threadMsg("继续", 4));
    await runner.waitForCall(2);
    const cmd = lastCmd(runner);
    expect(cmd[cmd.indexOf("--agent") + 1]).toBe("review");
    expect(cmd[cmd.indexOf("--model") + 1]).toBe("deepseek/x");
    runner.finish(1, [textEvent("答2")]);
    await mgr.whenIdle();
    await mgr.handleThreadMessage(threadMsg("/agent reset", 5));
    await mgr.handleThreadMessage(threadMsg("再来", 6));
    await runner.waitForCall(3);
    expect(lastCmd(runner)[lastCmd(runner).indexOf("--agent") + 1]).not.toBe("review");
    runner.finish(2, [textEvent("答3")]);
    await mgr.whenIdle();
  });

  it("/new clears the session context but keeps the thread and directory", async () => {
    const { feishu, runner, mgr } = setup();
    await createSession(mgr, runner);
    const before = store.getDirectSession("om_sc1");
    await mgr.handleThreadMessage(threadMsg("/new", 2));
    await mgr.whenIdle();
    expect(store.getDirectSession("om_sc1")?.session_id).toBeNull();
    expect(feishu.sent("om_sc1").some((t) => t.includes("已开启新会话"))).toBe(true);
    await mgr.handleThreadMessage(threadMsg("新问题", 3));
    await runner.waitForCall(2);
    const cmd = lastCmd(runner);
    expect(cmd).not.toContain("-s");
    expect(cmd[cmd.indexOf("--dir") + 1]).toBe(before?.path);
    runner.finish(1, [textEvent("答2")]);
    await mgr.whenIdle();
  });

  it("/status replies with a dashboard card", async () => {
    const { feishu, runner, mgr } = setup();
    await createSession(mgr, runner);
    const cardsBefore = feishu.cards.length;
    await mgr.handleThreadMessage(threadMsg("/status", 2));
    await mgr.whenIdle();
    expect(feishu.cards.length).toBe(cardsBefore + 1);
    const body = JSON.stringify(feishu.cards.at(-1)?.card);
    expect(body).toContain("会话状态");
    expect(body).toContain("权限姿态");
    expect(body).toContain("turns");
  });

  it("lists the new commands in thread help", async () => {
    const { feishu, runner, mgr } = setup();
    await createSession(mgr, runner);
    await mgr.handleThreadMessage(threadMsg("/help", 2));
    await mgr.whenIdle();
    const help = feishu.cardTexts("om_sc1").find((t) => t.includes("直连会话帮助")) ?? "";
    expect(help).toContain("/auto");
    expect(help).toContain("/agent");
    expect(help).toContain("/new");
    expect(help).toContain("/status");
  });
});

describe("DirectSessionManager running heartbeat", () => {
  it("refreshes the card at least every 5s while a turn runs and stops after", async () => {
    vi.useFakeTimers();
    try {
      const feishu = new FakeFeishu();
      const runner = new FakeRunner();
      const mgr = new DirectSessionManager({
        feishu,
        store,
        config: () => directConfig({ verbosity: "detailed" }),
        logger: fakeLogger(),
        turnDriver: runner.spawn,
      });
      const created = mgr.handleIntakeMessage(
        msg({ message_id: "om_hb", text: "/chat tasking 干活" }),
      );
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(50);
      expect(runner.calls).toHaveLength(1);
      const before = feishu.updates.length;
      await vi.advanceTimersByTimeAsync(11000);
      expect(feishu.updates.length).toBeGreaterThanOrEqual(before + 2);
      runner.finish(0, [textEvent("答")]);
      await created;
      await vi.advanceTimersByTimeAsync(50);
      const settled = feishu.updates.length;
      await vi.advanceTimersByTimeAsync(20000);
      expect(feishu.updates.length).toBe(settled);
      await mgr.whenIdle();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("DirectSessionManager permission button", () => {
  function setup() {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    return { feishu, runner, mgr };
  }

  function perm(action: string, posture = "off") {
    return {
      messageId: "om_card_1",
      chatId: "oc_chat",
      operatorOpenId: "ou_op",
      operatorName: "张三",
      value: { action, root_id: "om_pb1", turn: 1, posture },
    };
  }

  async function ready(feishu: FakeFeishu, runner: FakeRunner, mgr: DirectSessionManager) {
    await mgr.handleIntakeMessage(msg({ message_id: "om_pb1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答")]);
    await mgr.whenIdle();
  }

  it("asks for confirmation first, then opens the session", async () => {
    const { feishu, runner, mgr } = setup();
    await ready(feishu, runner, mgr);
    const prompted = await mgr.handleCardAction(perm("perm"));
    expect(JSON.stringify(prompted?.card)).toContain("perm_on");
    expect(store.getDirectSession("om_pb1")?.auto_approve_override).toBeNull();

    const opened = await mgr.handleCardAction(perm("perm_on"));
    expect(store.getDirectSession("om_pb1")?.auto_approve_override).toBe("on");
    expect(JSON.stringify(opened?.card)).toContain("🔓 auto");

    const closed = await mgr.handleCardAction(perm("perm", "on"));
    expect(closed?.toast.content).toContain("收回");
    expect(store.getDirectSession("om_pb1")?.auto_approve_override).toBeNull();
  });

  it("arms a single turn from the confirm row", async () => {
    const { feishu, runner, mgr } = setup();
    await ready(feishu, runner, mgr);
    await mgr.handleCardAction(perm("perm"));
    const armed = await mgr.handleCardAction(perm("perm_once"));
    expect(JSON.stringify(armed?.card)).toContain("下轮放开");
    await mgr.handleThreadMessage(
      msg({ message_id: "om_pb2", root_id: "om_pb1", text: "下一轮", create_time: "1700000100" }),
    );
    await runner.waitForCall(2);
    const cmd = runner.calls.at(-1)?.cmd ?? [];
    expect(cmd).toContain("--auto");
    runner.finish(1, [textEvent("答2")]);
    await mgr.whenIdle();
  });
});

describe("DirectSessionManager permission re-open after cancel", () => {
  it("lets the user open, cancel, and open the confirm row again", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_rc1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答")]);
    await mgr.whenIdle();
    const clickFrom = (card: unknown, action: string) => {
      const elements =
        (card as { body?: { elements?: Array<Record<string, unknown>> } }).body?.elements ?? [];
      for (const el of elements) {
        const behaviors = el.behaviors as Array<{ value?: Record<string, unknown> }> | undefined;
        const value = behaviors?.[0]?.value;
        if (value?.action === action) {
          return {
            messageId: "om_card_1",
            chatId: "oc_chat",
            operatorOpenId: "ou_op",
            operatorName: "张三",
            value,
          };
        }
      }
      throw new Error(`button ${action} not found`);
    };

    const rendered = feishu.updates.at(-1)?.card;
    const first = await mgr.handleCardAction(clickFrom(rendered, "perm"));
    const cancelled = await mgr.handleCardAction(clickFrom(first?.card, "perm_cancel"));
    expect(JSON.stringify(cancelled?.card)).not.toContain("perm_on");
    const again = await mgr.handleCardAction(clickFrom(cancelled?.card, "perm"));
    expect(again?.toast.content).not.toContain("已处理");
    expect(JSON.stringify(again?.card)).toContain("perm_on");
  });
});

describe("DirectSessionManager running heartbeat", () => {
  it("refreshes the card at least every 5s while a turn runs and stops after", async () => {
    vi.useFakeTimers();
    try {
      const feishu = new FakeFeishu();
      const runner = new FakeRunner();
      const mgr = new DirectSessionManager({
        feishu,
        store,
        config: () => directConfig({ verbosity: "detailed" }),
        logger: fakeLogger(),
        turnDriver: runner.spawn,
      });
      const created = mgr.handleIntakeMessage(
        msg({ message_id: "om_hb", text: "/chat tasking 干活" }),
      );
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(50);
      expect(runner.calls).toHaveLength(1);
      const before = feishu.updates.length;
      await vi.advanceTimersByTimeAsync(11000);
      expect(feishu.updates.length).toBeGreaterThanOrEqual(before + 2);
      runner.finish(0, [textEvent("答")]);
      await created;
      await vi.advanceTimersByTimeAsync(50);
      const settled = feishu.updates.length;
      await vi.advanceTimersByTimeAsync(20000);
      expect(feishu.updates.length).toBe(settled);
      await mgr.whenIdle();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("DirectSessionManager /new deletes the abandoned session", () => {
  it("cleans up the old opencode session and says so", async () => {
    const deleted: string[] = [];
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig(),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
      deleteSession: async (sessionId) => {
        deleted.push(sessionId);
      },
      clearActivity: () => {},
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_nw1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答")]);
    await mgr.whenIdle();
    const sessionId = store.getDirectSession("om_nw1")?.session_id ?? "";
    expect(sessionId).toContain("ses_");

    await mgr.handleThreadMessage(
      msg({ message_id: "om_nw2", root_id: "om_nw1", text: "/new", create_time: "1700000100" }),
    );
    await mgr.whenIdle();

    expect(deleted).toEqual([sessionId]);
    expect(store.getDirectSession("om_nw1")?.session_id).toBeNull();
    const ack = feishu.sent("om_nw1").find((t) => t.includes("新会话")) ?? "";
    expect(ack).toContain("已删除");
  });
});

describe("DirectSessionManager cross-turn dedup", () => {
  it("reuses one seen-message map across turns of a session", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "summary" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_dedup", text: "/chat tasking 第一问" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答一")]);
    await mgr.whenIdle();
    await mgr.handleThreadMessage(
      msg({
        message_id: "om_dedup2",
        root_id: "om_dedup",
        text: "第二问",
        create_time: "1700000100",
      }),
    );
    await runner.waitForCall(2);
    const first = runner.calls[0]?.request.seenMessages;
    const second = runner.calls[1]?.request.seenMessages;
    expect(first).toBeDefined();
    expect(second).toBe(first);
    runner.finish(1, [textEvent("答二")]);
    await mgr.whenIdle();
  });
});

describe("DirectSessionManager agent/model override takes effect on the next turn", () => {
  it("flags switch_agent only after the override changes", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "summary" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_ag1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答一")]);
    await mgr.whenIdle();

    // Unchanged continuation: the default agent was already applied at create.
    await mgr.handleThreadMessage(
      msg({ message_id: "om_ag2", root_id: "om_ag1", text: "继续", create_time: "1700000100" }),
    );
    await runner.waitForCall(2);
    expect(runner.calls[1]?.request.switchAgent).toBe(false);
    runner.finish(1, [textEvent("答二")]);
    await mgr.whenIdle();

    // Override the agent, then continue: the next turn must ask to switch.
    await mgr.handleThreadMessage(
      msg({
        message_id: "om_ag3",
        root_id: "om_ag1",
        text: "/agent review",
        create_time: "1700000200",
      }),
    );
    await mgr.whenIdle();
    await mgr.handleThreadMessage(
      msg({
        message_id: "om_ag4",
        root_id: "om_ag1",
        text: "再继续",
        create_time: "1700000300",
      }),
    );
    await runner.waitForCall(3);
    expect(runner.calls[2]?.request.agent).toBe("review");
    expect(runner.calls[2]?.request.switchAgent).toBe(true);
    runner.finish(2, [textEvent("答三")]);
    await mgr.whenIdle();
  });

  it("recover() interrupts the server-side turn of a running session", async () => {
    const interrupted: string[] = [];
    const feishu = new FakeFeishu();
    let signalStarted: (() => void) | null = null;
    const turnStarted = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "summary" }),
      logger: fakeLogger(),
      turnDriver: () => {
        signalStarted?.();
        return new Promise(() => {});
      },
      interruptSession: async (sid) => {
        interrupted.push(sid);
      },
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_rec1", text: "/chat tasking 干活" }));
    await turnStarted;
    store.updateDirectSession("om_rec1", { session_id: "ses_rec1" });
    store.markDirectSessionStatus("om_rec1", "running");
    await mgr.recover();
    expect(interrupted).toEqual(["ses_rec1"]);
    expect(store.getDirectSession("om_rec1")?.status).toBe("idle");
  });

  it("deleteSessionByRoot marks done and cleans up the opencode session", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const deleted: string[] = [];
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "summary" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
      deleteSession: async (sid) => {
        deleted.push(sid);
      },
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_del1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答")]);
    await mgr.whenIdle();
    const sessionId = store.getDirectSession("om_del1")?.session_id ?? "";

    expect(await mgr.deleteSessionByRoot("om_del1", "TUI")).toBe(true);
    expect(store.getDirectSession("om_del1")?.status).toBe("done");
    expect(deleted).toEqual([sessionId]);
    expect(await mgr.deleteSessionByRoot("om_nonexistent")).toBe(false);
    expect(await mgr.deleteSessionByRoot("om_del1")).toBe(true);
  });

  it("carries the live context size onto the turn card header", async () => {
    const feishu = new FakeFeishu();
    let turn = 0;
    const driver = async () => {
      turn += 1;
      return {
        status: "succeeded" as const,
        sessionId: `ses_ctx_${turn}`,
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        error: null,
        postureOpened: false,
        contextTokens: turn === 1 ? 120_000 : 660_000,
      };
    };
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: driver as never,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_ctx1", text: "/chat tasking 干活" }));
    await mgr.whenIdle();
    await mgr.handleThreadMessage(
      msg({ message_id: "om_ctx2", root_id: "om_ctx1", text: "继续", create_time: "1700000100" }),
    );
    await mgr.whenIdle();
    const last = feishu.updates.at(-1) ?? feishu.cards.at(-1);
    const header = last ? JSON.stringify(last.card) : "";
    expect(header).toContain("ctx ≈660.0k");
  });
});

describe("DirectSessionManager concurrent pending approvals", () => {
  it("keeps an earlier pending approval actionable when a second one arrives", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const apiCalls: string[][] = [];
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
      apiExec: async (args) => {
        apiCalls.push(args);
        return { exitCode: 0, stdout: "{}", stderr: "", timedOut: false };
      },
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_two", text: "/chat tasking 跑两个命令" }));
    await runner.waitForCall(1);
    const call = runner.calls[0];
    const per = (id: string) => ({
      id,
      sessionID: "ses_two",
      action: "shell",
      resources: [`echo ${id}`],
      save: ["echo *"],
    });
    call?.request.onPendingPermissions?.([per("per_a")]);
    call?.request.onPendingPermissions?.([per("per_a"), per("per_b")]);

    const reply = await mgr.handleCardAction({
      messageId: "om_two",
      chatId: "oc_chat",
      operatorOpenId: "ou_op",
      operatorName: "张三",
      value: {
        action: "approve_once",
        root_id: "om_two",
        turn: 1,
        request_id: "per_a",
        kind: "direct",
      },
    });
    expect(reply?.toast?.content).toContain("已允许");
    expect(
      apiCalls.some((a) => a.includes("session.permission.reply") && a.includes("requestID=per_a")),
    ).toBe(true);
    runner.finish(0, [textEvent("ok")]);
    await mgr.whenIdle();
  });

  it("returns the stamped card in the callback response so the click is visible immediately", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
      apiExec: async () => ({ exitCode: 0, stdout: "{}", stderr: "", timedOut: false }),
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_stamp", text: "/chat tasking 跑个命令" }));
    await runner.waitForCall(1);
    runner.calls[0]?.request.onPendingPermissions?.([
      {
        id: "per_stamp",
        sessionID: "ses_stamp",
        action: "shell",
        resources: ["echo hi"],
        save: ["echo *"],
      },
    ]);
    const reply = await mgr.handleCardAction({
      messageId: "om_stamp",
      chatId: "oc_chat",
      operatorOpenId: "ou_op",
      operatorName: "张三",
      value: {
        action: "approve_once",
        root_id: "om_stamp",
        turn: 1,
        request_id: "per_stamp",
        kind: "direct",
      },
    });
    const cardJson = JSON.stringify(reply?.card);
    expect(cardJson).toContain("已允许");
    expect(cardJson).not.toContain("approve_once");
    expect(cardJson).not.toContain("approve_reject");
    runner.finish(0, [textEvent("done")]);
    await mgr.whenIdle();
  });

  it("clears the waiting-approval marker when the turn ends while still pending", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_wait", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.calls[0]?.request.onPendingPermissions?.([
      { id: "per_w", sessionID: "ses_w", action: "shell", resources: ["echo w"] },
    ]);
    runner.calls[0]?.request.onWaitingForApproval?.(true);
    expect(mgr.listActive()[0]?.waiting_approval).toBe(true);
    runner.finish(0, [textEvent("done")]);
    await mgr.whenIdle();
    expect(mgr.listActive()[0]?.waiting_approval).toBeUndefined();
    const sealed = feishu.updates.find((u) => JSON.stringify(u.card).includes("✅ 完成"));
    expect(sealed).toBeDefined();
    expect(JSON.stringify(sealed?.card)).not.toContain("等待审批");
  });
});

describe("DirectSessionManager first-turn approval", () => {
  it("posts an approval card to the thread when the first turn pends (session_id not yet persisted)", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const apiCalls: string[][] = [];
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
      apiExec: async (args) => {
        apiCalls.push(args);
        return { exitCode: 0, stdout: "{}", stderr: "", timedOut: false };
      },
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_appr1", text: "/chat tasking 跑个命令" }));
    await runner.waitForCall(1);
    const call = runner.calls[0];
    expect(call).toBeDefined();
    await call?.request.onPendingPermissions?.([
      {
        id: "per_first",
        sessionID: "ses_first_turn",
        action: "shell",
        resources: ["echo x"],
        save: ["echo *"],
      },
    ]);
    const approvalCard = feishu.cards.find((c) => JSON.stringify(c.card).includes("approve_once"));
    expect(approvalCard).toBeDefined();
    expect(approvalCard?.rootId).toBe("om_appr1");
    const approvalJson = JSON.stringify(approvalCard?.card);
    expect(approvalJson).toContain("per_first");
    expect(approvalJson).toContain("approve_always");
    expect(approvalJson).toContain("approve_reject");
    const reply = await mgr.handleCardAction({
      messageId: "om_appr1",
      chatId: "oc_chat",
      operatorOpenId: "ou_op",
      operatorName: "张三",
      value: {
        action: "approve_once",
        root_id: "om_appr1",
        turn: 1,
        request_id: "per_first",
        kind: "direct",
      },
    });
    expect(reply?.toast?.content).toContain("已允许");
    expect(apiCalls.some((a) => a.includes("session.permission.reply"))).toBe(true);
    const stamped = feishu.updates.find((u) => JSON.stringify(u.card).includes("已允许"));
    expect(stamped).toBeDefined();
    runner.finish(0, [textEvent("done")]);
    await mgr.whenIdle();
  });
});

describe("DirectSessionManager turn logging", () => {
  it("logs the effective command and posture for each turn", async () => {
    const lines: string[] = [];
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(lines),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_lg1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    const start = lines.find((l) => l.includes("direct turn starting")) ?? "";
    expect(start).toContain('"dir"');
    expect(start).toContain('"auto_approve":false');
    expect(start).toContain('"agent"');
    expect(start).toContain('"poll_interval_ms"');
    expect(start).toContain("干活");
    runner.finish(0, [textEvent("答")]);
    await mgr.whenIdle();
    lines.length = 0;
    await mgr.handleThreadMessage(
      msg({
        message_id: "om_lg2",
        root_id: "om_lg1",
        text: "/auto once",
        create_time: "1700000100",
      }),
    );
    await mgr.handleThreadMessage(
      msg({ message_id: "om_lg3", root_id: "om_lg1", text: "再来", create_time: "1700000200" }),
    );
    await runner.waitForCall(2);
    const next = lines.find((l) => l.includes("direct turn starting")) ?? "";
    expect(next).toContain('"auto_approve":true');
    expect(next).toContain('"continuation":true');
    runner.finish(1, [textEvent("答2")]);
    await mgr.whenIdle();
  });
});

describe("DirectSessionManager /name", () => {
  it("renames the session and shows it on the next card flush", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_nm1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答1")]);
    await mgr.whenIdle();
    await mgr.handleThreadMessage(
      msg({
        message_id: "om_nm2",
        root_id: "om_nm1",
        text: "/name 磁盘巡检",
        create_time: "1700000100",
      }),
    );
    await mgr.whenIdle();
    expect(store.getDirectSession("om_nm1")?.name).toBe("磁盘巡检");
    expect(feishu.sent("om_nm1").some((t) => t.includes("磁盘巡检"))).toBe(true);
    await mgr.handleThreadMessage(
      msg({ message_id: "om_nm5", root_id: "om_nm1", text: "再来", create_time: "1700000200" }),
    );
    await runner.waitForCall(2);
    runner.finish(1, [toolEvent("npm test"), textEvent("答2")]);
    await mgr.whenIdle();
    expect(feishu.updateJson().at(-1)).toContain("磁盘巡检");
  });

  it("reports the current name with no argument", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig(),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_nm3", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答")]);
    await mgr.whenIdle();
    await mgr.handleThreadMessage(
      msg({ message_id: "om_nm4", root_id: "om_nm3", text: "/name", create_time: "1700000100" }),
    );
    await mgr.whenIdle();
    const reply = feishu.sent("om_nm3").find((t) => t.includes("当前会话名")) ?? "";
    expect(reply).toContain("干活");
  });
});

describe("DirectSessionManager attachments", () => {
  function setup() {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig(),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
      deleteSession: async () => {},
      clearActivity: () => {},
    });
    return { feishu, runner, mgr };
  }

  it("downloads an attachment into the inbox, prompts with its path, and cleans up on /done", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_at1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答")]);
    await mgr.whenIdle();

    await mgr.handleThreadMessage(
      msg({
        message_id: "om_at2",
        root_id: "om_at1",
        text: "分析一下这张图",
        attachments: [{ kind: "image", key: "img_v2_x", name: "image.png" }],
        create_time: "1700000100",
      }),
    );
    await runner.waitForCall(2);
    const prompt = runner.calls.at(-1)?.cmd.at(-1) ?? "";
    expect(prompt).toContain("分析一下这张图");
    expect(prompt).toContain("direct-inbox");
    const path = /\[附件\] (\S+)/.exec(prompt)?.[1] ?? "";
    expect(path).not.toBe("");
    expect(existsSync(path)).toBe(true);
    expect(feishu.downloaded).toEqual([
      { messageId: "om_at2", fileKey: "img_v2_x", kind: "image" },
    ]);
    runner.finish(1, [textEvent("答2")]);
    await mgr.whenIdle();

    await mgr.handleThreadMessage(
      msg({ message_id: "om_at3", root_id: "om_at1", text: "/done", create_time: "1700000200" }),
    );
    await mgr.whenIdle();
    expect(existsSync(path)).toBe(false);
  });

  it("reports a failed download and still runs when there is text", async () => {
    const { feishu, runner, mgr } = setup();
    feishu.downloadMessageResource = async () => {
      throw new Error("resource too large");
    };
    await mgr.handleIntakeMessage(msg({ message_id: "om_af1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答")]);
    await mgr.whenIdle();
    await mgr.handleThreadMessage(
      msg({
        message_id: "om_af2",
        root_id: "om_af1",
        text: "看这个文件",
        attachments: [{ kind: "file", key: "file_v2_z", name: "big.zip" }],
        create_time: "1700000100",
      }),
    );
    await runner.waitForCall(2);
    expect(feishu.sent("om_af1").some((t) => t.includes("下载失败"))).toBe(true);
    expect(runner.calls.at(-1)?.cmd.at(-1)).toContain("看这个文件");
    runner.finish(1, [textEvent("答2")]);
    await mgr.whenIdle();
  });

  it("does not run a turn when an attachment-only message fails to download", async () => {
    const { feishu, runner, mgr } = setup();
    feishu.downloadMessageResource = async () => {
      throw new Error("resource unavailable");
    };
    await mgr.handleIntakeMessage(msg({ message_id: "om_ae1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答")]);
    await mgr.whenIdle();
    await mgr.handleThreadMessage(
      msg({
        message_id: "om_ae2",
        root_id: "om_ae1",
        text: "",
        attachments: [{ kind: "file", key: "file_v2_e", name: "broken.zip" }],
        create_time: "1700000100",
      }),
    );
    await mgr.whenIdle();
    expect(runner.calls).toHaveLength(1);
    expect(feishu.sent("om_ae1").some((t) => t.includes("附件未能读取"))).toBe(true);
  });

  it("starts a turn for an attachment-only message", async () => {
    const { feishu, runner, mgr } = setup();
    await mgr.handleIntakeMessage(msg({ message_id: "om_ao1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答")]);
    await mgr.whenIdle();

    await mgr.handleThreadMessage(
      msg({
        message_id: "om_ao2",
        root_id: "om_ao1",
        text: "",
        attachments: [{ kind: "image", key: "img_v2_y", name: "image.png" }],
        create_time: "1700000100",
      }),
    );
    await runner.waitForCall(2);
    const prompt = runner.calls.at(-1)?.cmd.at(-1) ?? "";
    expect(prompt).toContain("附件");
    expect(feishu.sent("om_ao1").some((t) => t.includes("暂仅支持文本消息"))).toBe(false);
    runner.finish(1, [textEvent("答2")]);
    await mgr.whenIdle();
  });
});

describe("DirectSessionManager collect mode", () => {
  function setup() {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ verbosity: "detailed" }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
      deleteSession: async () => {},
      clearActivity: () => {},
    });
    return { feishu, runner, mgr };
  }

  function thread(n: number, text: string, attachments: FeishuPolledMessage["attachments"] = []) {
    return msg({
      message_id: `om_cl${n}`,
      root_id: "om_cl1",
      text,
      attachments,
      create_time: `1700000${n}00`,
    });
  }

  async function ready(feishu: FakeFeishu, runner: FakeRunner, mgr: DirectSessionManager) {
    await mgr.handleIntakeMessage(msg({ message_id: "om_cl1", text: "/chat tasking 干活" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("答")]);
    await mgr.whenIdle();
  }

  it("buffers messages (with attachments) and submits them as one turn", async () => {
    const { feishu, runner, mgr } = setup();
    await ready(feishu, runner, mgr);
    await mgr.handleThreadMessage(thread(2, "/collect"));
    await mgr.handleThreadMessage(
      thread(3, "这是报错", [{ kind: "image", key: "img_v2_c", name: "image.png" }]),
    );
    await mgr.handleThreadMessage(thread(4, "再补充一句"));
    expect(runner.calls).toHaveLength(1);
    expect(feishu.sent("om_cl1").some((t) => t.includes("已收集 2 条"))).toBe(true);

    await mgr.handleThreadMessage(thread(5, "/send"));
    await runner.waitForCall(2);
    const prompt = runner.calls.at(-1)?.cmd.at(-1) ?? "";
    expect(prompt).toContain("这是报错");
    expect(prompt).toContain("再补充一句");
    expect(prompt).toContain("direct-inbox");
    expect(feishu.sent("om_cl1").some((t) => t.includes("已提交 2 条"))).toBe(true);
    runner.finish(1, [textEvent("答2")]);
    await mgr.whenIdle();
  });

  it("discards the buffer on /cancel", async () => {
    const { feishu, runner, mgr } = setup();
    await ready(feishu, runner, mgr);
    await mgr.handleThreadMessage(thread(2, "/collect"));
    await mgr.handleThreadMessage(thread(3, "不要了"));
    await mgr.handleThreadMessage(thread(4, "/cancel"));
    await mgr.whenIdle();
    expect(runner.calls).toHaveLength(1);
    expect(feishu.sent("om_cl1").some((t) => t.includes("丢弃 1 条"))).toBe(true);
  });

  it("auto-submits after the idle timeout", async () => {
    const { feishu, runner, mgr } = setup();
    await ready(feishu, runner, mgr);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await mgr.handleThreadMessage(thread(2, "/collect"));
      await mgr.handleThreadMessage(thread(3, "攒着的一条"));
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
      expect(runner.calls).toHaveLength(2);
      expect(runner.calls.at(-1)?.cmd.at(-1)).toContain("攒着的一条");
      expect(feishu.sent("om_cl1").some((t) => t.includes("收集超时"))).toBe(true);
      runner.finish(1, [textEvent("答2")]);
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
    await mgr.whenIdle();
  });

  it("leaves the buffer alone for other commands", async () => {
    const { feishu, runner, mgr } = setup();
    await ready(feishu, runner, mgr);
    await mgr.handleThreadMessage(thread(2, "/collect"));
    await mgr.handleThreadMessage(thread(3, "留着"));
    await mgr.handleThreadMessage(thread(4, "/status"));
    await mgr.handleThreadMessage(thread(5, "/send"));
    await runner.waitForCall(2);
    expect(runner.calls.at(-1)?.cmd.at(-1)).toContain("留着");
    runner.finish(1, [textEvent("答2")]);
    await mgr.whenIdle();
  });

  it("replies with a collect card and drives collection from its buttons", async () => {
    const { feishu, runner, mgr } = setup();
    await ready(feishu, runner, mgr);
    await mgr.handleThreadMessage(thread(2, "/collect"));
    expect(feishu.cardTexts("om_cl1").some((t) => t.includes("收集模式"))).toBe(true);

    const click = (action: string, n: number) => ({
      messageId: `om_card_cl${n}`,
      chatId: "oc_chat",
      operatorOpenId: "ou_op",
      operatorName: "张三",
      value: { action, root_id: "om_cl1" },
    });
    await mgr.handleThreadMessage(thread(3, "/cancel"));
    const start = await mgr.handleCardAction(click("collect_start", 1));
    expect(start?.toast.type).toBe("success");
    await mgr.handleThreadMessage(thread(4, "按钮攒的"));
    expect(runner.calls).toHaveLength(1);
    const send = await mgr.handleCardAction(click("collect_send", 2));
    expect(send?.toast.type).toBe("success");
    await runner.waitForCall(2);
    expect(runner.calls.at(-1)?.cmd.at(-1)).toContain("按钮攒的");
    runner.finish(1, [textEvent("答2")]);
    await mgr.whenIdle();
  });

  it("cancels the buffer from the card button", async () => {
    const { feishu, runner, mgr } = setup();
    await ready(feishu, runner, mgr);
    const start = await mgr.handleCardAction({
      messageId: "om_card_cl3",
      chatId: "oc_chat",
      operatorOpenId: "ou_op",
      operatorName: "张三",
      value: { action: "collect_start", root_id: "om_cl1" },
    });
    expect(start?.toast.type).toBe("success");
    await mgr.handleThreadMessage(thread(2, "不要了"));
    const cancel = await mgr.handleCardAction({
      messageId: "om_card_cl3",
      chatId: "oc_chat",
      operatorOpenId: "ou_op",
      operatorName: "张三",
      value: { action: "collect_cancel", root_id: "om_cl1" },
    });
    expect(cancel?.toast.content).toContain("丢弃 1 条");
    await mgr.whenIdle();
    expect(runner.calls).toHaveLength(1);
  });
});

describe("resolveTarget home expansion", () => {
  it("expands ~ in configured project paths", async () => {
    const { homedir } = await import("node:os");
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: () => directConfig({ projects: { home: "~" } }),
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_home", text: "/chat home 你好" }));
    expect(store.getDirectSession("om_home")?.path).toBe(realpathSync(homedir()));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("ok")]);
    await mgr.whenIdle();
  });
});

describe("interface_language en regression", () => {
  it("/status renders sub-labels in English (no leaked Chinese inside variables)", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    await mgr.handleIntakeMessage(msg({ message_id: "om_root9", text: "/chat tasking hello" }));
    await runner.waitForCall(1);
    runner.finish(0, [textEvent("done")]);
    await mgr.whenIdle();
    setLocale("en");
    try {
      await mgr.handleThreadMessage(
        msg({
          message_id: "om_s1",
          root_id: "om_root9",
          parent_id: "om_root9",
          text: "/status",
        }),
      );
      await mgr.whenIdle();
      const statusJson = JSON.stringify(translateCard(feishu.cards.at(-1)?.card));
      expect(statusJson).not.toContain("（未设置）");
      expect(statusJson).not.toContain("（未开始）");
      expect(statusJson).not.toContain("（会话覆盖）");
      expect(statusJson).not.toContain("🔒 默认");
      expect(statusJson).not.toContain("turns：");
      expect(statusJson).toContain("Model: (unset)");
      expect(statusJson).toContain("Permission posture: 🔒 Default");
      expect(statusJson).toContain("Session status");
      expect(statusJson).toContain("turns:");
    } finally {
      setLocale("zh");
    }
  });
});

describe("en lifecycle outbound sweep", () => {
  it("every outbound text/card is Han-free apart from user and agent content", async () => {
    const feishu = new FakeFeishu();
    const runner = new FakeRunner();
    const mgr = new DirectSessionManager({
      feishu,
      store,
      config: directConfig,
      logger: fakeLogger(),
      turnDriver: runner.spawn,
    });
    const threadMsg = (n: number, text: string) =>
      msg({
        message_id: `om_l${n}`,
        root_id: "om_l0",
        parent_id: "om_l0",
        text,
      });
    setLocale("en");
    try {
      await mgr.handleIntakeMessage(msg({ message_id: "om_l0", text: "/chat tasking 修个bug" }));
      await runner.waitForCall(1);
      runner.finish(0, [textEvent("已修好，请查收")]);
      await mgr.whenIdle();
      for (const [n, text] of [
        [1, "/status"],
        [2, "/auto"],
        [3, "/collect"],
        [4, "/cancel"],
        [5, "/stop"],
        [6, "/done"],
      ] as const) {
        await mgr.handleThreadMessage(threadMsg(n, text));
        await mgr.whenIdle();
      }
      await new Promise((r) => setTimeout(r, 50));
      const allowed = ["修个bug", "已修好，请查收"];
      const strip = (t: string) => allowed.reduce((acc, s) => acc.split(s).join(""), t);
      const scan = (label: string, t: string) => {
        expect(strip(t), `${label} leaked Han: ${t}`).not.toMatch(/[\u4e00-\u9fff]/);
      };
      for (const r of feishu.replies) scan("reply", translate(r.text));
      for (const c of feishu.cards) scan("card", JSON.stringify(translateCard(c.card)));
      for (const u of feishu.updates) scan("update", JSON.stringify(translateCard(u.card)));
    } finally {
      setLocale("zh");
    }
  });
});
