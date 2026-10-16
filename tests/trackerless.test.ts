import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FeishuPolledMessage, FeishuSource } from "../src/adapters/feishu/source.js";
import { BindingStore } from "../src/bridge/binding-store.js";
import { CommentBridge } from "../src/bridge/comment-bridge.js";
import type { EffectiveConfig } from "../src/config/config-types.js";
import { resolveConfig } from "../src/config/resolver.js";
import type { DirectTurnOutcome } from "../src/direct/driver.js";
import { type DirectFeishuPort, DirectSessionManager } from "../src/direct/manager.js";
import type { TurnDriverEvent } from "../src/driver/turn-driver.js";
import { ActivityStore } from "../src/observability/activity-store.js";
import { ConsoleLogger } from "../src/observability/logger.js";
import { createInitialState } from "../src/shared/types.js";

const logger = new ConsoleLogger({}, () => {});

let workdir: string;
let store: BindingStore;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "tasking-trackerless-"));
  store = new BindingStore(join(workdir, "bindings.db"));
});

afterEach(() => {
  store.close();
  rmSync(workdir, { recursive: true, force: true });
});

function trackerlessConfig(): EffectiveConfig {
  return resolveConfig(
    {
      workspace: { root: workdir },
      tracker: { kind: "none" },
      feishu: {
        enabled: true,
        app_id: "c",
        app_secret: "s",
        intake_chat_id: "oc_intake",
        direct: { projects: { tasking: workdir }, verbosity: "summary" },
      },
    },
    "/tmp",
    "p",
  );
}

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
    chat_id: "oc_intake",
    ...overrides,
  };
}

class RecordingFeishu {
  replies: Array<{ rootId: string; text: string }> = [];
  threads = new Map<string, FeishuPolledMessage[]>();
  async replyInThread(rootId: string, text: string) {
    this.replies.push({ rootId, text });
    return {
      message_id: `om_r${this.replies.length}`,
      root_id: rootId,
      thread_id: `omt_${rootId}`,
    };
  }
  async replyFlat(rootId: string, text: string) {
    this.replies.push({ rootId, text });
  }
  async replyCardInThread(rootId: string, card: unknown) {
    this.replies.push({ rootId, text: JSON.stringify(card) });
    return {
      message_id: `om_c${this.replies.length}`,
      root_id: rootId,
      thread_id: `omt_${rootId}`,
    };
  }
  async replyCardFlat(rootId: string, card: unknown) {
    this.replies.push({ rootId, text: JSON.stringify(card) });
  }
  async listThreadReplies(): Promise<FeishuPolledMessage[]> {
    return [];
  }
  sent(rootId: string): string[] {
    return this.replies.filter((r) => r.rootId === rootId).map((r) => r.text);
  }
}

class FakeRunner {
  calls: Array<{
    cmd: string[];
    cwd: string;
    onEvent?: (evt: TurnDriverEvent) => void;
  }> = [];
  private resolvers: Array<(r: DirectTurnOutcome) => void> = [];

  spawn = (
    request: import("../src/direct/driver.js").DirectTurnRequest,
  ): Promise<DirectTurnOutcome> => {
    const cmd = ["opencode", "run", "--dir", request.directory, request.prompt];
    this.calls.push({ cmd, cwd: request.directory, onEvent: request.onEvent });
    return new Promise<DirectTurnOutcome>((resolve) => {
      this.resolvers.push(resolve);
    });
  };

  finish(index: number, events: TurnDriverEvent[], exitCode = 0): void {
    const call = this.calls[index];
    for (const evt of events) call?.onEvent?.(evt);
    this.resolvers[index]?.({
      status: exitCode === 0 ? "succeeded" : "failed",
      sessionId: `ses_fake${this.calls.length}`,
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      error: exitCode === 0 ? null : `exit ${exitCode}`,
      postureOpened: false,
    });
  }

  waitForCall(n: number): Promise<void> {
    return new Promise((resolve) => {
      const check = () => (this.calls.length >= n ? resolve() : setTimeout(check, 5));
      check();
    });
  }
}

function compose(config: EffectiveConfig): {
  bridge: CommentBridge;
  direct: DirectSessionManager;
  feishu: RecordingFeishu;
  runner: FakeRunner;
  activityStore: ActivityStore;
  runtimeState: () => ReturnType<typeof createInitialState>;
} {
  const feishu = new RecordingFeishu();
  const runner = new FakeRunner();
  const activityStore = new ActivityStore();
  const runtimeState = {
    get value() {
      return createInitialState(config.polling.interval_ms, config.agent.max_concurrent_agents);
    },
  };
  const direct = new DirectSessionManager({
    feishu: feishu as unknown as DirectFeishuPort,
    store,
    config: () => config,
    logger,
    turnDriver: runner.spawn,
    activity: (key, evt) => activityStore.record(key, evt),
    clearActivity: (key) => activityStore.clear(key),
    deleteSession: () => Promise.resolve(),
  });
  const bridge = new CommentBridge({
    tracker: null,
    feishu: feishu as unknown as FeishuSource,
    bindings: store,
    config: () => config,
    logger,
    requestRefresh: () => false,
    direct,
  });
  return { bridge, direct, feishu, runner, activityStore, runtimeState: () => runtimeState.value };
}

describe("trackerless composition (tracker.kind: none, no Jira anywhere)", () => {
  it("/chat works end to end and /issue degrades visibly — with zero Jira available", async () => {
    const { bridge, feishu, runner } = compose(trackerlessConfig());
    bridge.start();

    await bridge.ingestMessage(msg({ message_id: "om_root1", text: "/chat tasking 帮我跑测试" }));
    await runner.waitForCall(1);
    expect(feishu.sent("om_root1").some((t) => t.includes("已创建") || t.includes("会话"))).toBe(
      true,
    );
    runner.finish(0, [{ type: "text", text: "done", sessionId: "ses_fake1" }]);
    await bridge.whenIdle();

    await bridge.ingestMessage(msg({ message_id: "om_issue1", text: "/issue 修个 bug" }));
    expect(
      feishu.sent("om_issue1").some((t) => t.includes("未知命令。可用：/chat、/agent、/help")),
    ).toBe(true);

    await bridge.ingestMessage(msg({ message_id: "om_st1", text: "/state" }));
    expect(feishu.sent("om_st1").some((t) => t.includes("未知命令。可用："))).toBe(true);

    await bridge.ingestMessage(msg({ message_id: "om_ag1", text: "/agent" }));
    expect(JSON.stringify(feishu.sent("om_ag1"))).toContain("默认 agent");

    await bridge.sweepNow();
    bridge.stop();
  });

  it("the standalone activity store and empty runtime state back the dashboards", async () => {
    const config = trackerlessConfig();
    const { activityStore, runtimeState } = compose(config);
    activityStore.record("direct:om_x", { type: "turn_started", at: Date.now() } as never);
    const state = runtimeState();
    expect(state.running.size).toBe(0);
    expect(state.retry_attempts.size).toBe(0);
    expect(state.completed.size).toBe(0);
  });
});
