import { describe, expect, it } from "vitest";
import type { ApiExecFn, ApiExecResult } from "../src/driver/api-client.js";
import type { SessionMessage } from "../src/driver/session-ops.js";
import { promptSession } from "../src/driver/session-ops.js";
import {
  type TurnDriverEvent,
  diffMessagesToEvents,
  mapContentEntry,
  runTurn,
  turnErrorMessage,
} from "../src/driver/turn-driver.js";
import {
  assistantMessage,
  failedTurnMessages,
  idleMessage,
  interruptResponse,
  messageListFailedResponse,
  messageListResponse,
  permissionListResponse,
  sessionCreateResponse,
  sessionGetResponse,
  toolEntry,
  userMessage,
} from "./helpers/opencode-fixtures.js";

describe("mapContentEntry", () => {
  it("maps text entries", () => {
    const evts = mapContentEntry({ type: "text", text: "hello" });
    expect(evts).toEqual([{ type: "text", text: "hello" }]);
  });

  it("maps a captured v2 tool entry (name + state.content) with full detail", () => {
    const evts = mapContentEntry(
      toolEntry({
        name: "shell",
        command: "echo x",
        output: "x\n",
        exit: 0,
        created: 1000,
        completed: 1500,
      }),
    );
    expect(evts).toHaveLength(1);
    const evt = evts[0] as Record<string, unknown>;
    expect(evt.type).toBe("tool_use");
    expect(evt.tool).toBe("shell");
    expect(evt.input).toEqual({ command: "echo x" });
    expect(evt.output).toBe("x\n");
    expect(evt.exit).toBe(0);
    expect(evt.durationMs).toBe(400);
  });

  it("measures execution time from ran, excluding the pre-execution approval wait", () => {
    const evts = mapContentEntry(
      toolEntry({
        name: "shell",
        command: "echo x",
        created: 1000,
        completed: 630_000,
      }),
    );
    const raw = toolEntry({ name: "shell", command: "echo x", created: 1000, completed: 630_000 });
    const time = (raw.time ?? {}) as { ran?: number };
    expect(time.ran).toBe(1100);
    expect((evts[0] as Record<string, unknown>).durationMs).toBe(630_000 - 1100);
  });

  it("still accepts the legacy v1 tool/state.output shape", () => {
    const evts = mapContentEntry({
      type: "tool",
      tool: "read",
      state: { status: "completed", output: "legacy" },
    });
    expect((evts[0] as Record<string, unknown>).tool).toBe("read");
    expect((evts[0] as Record<string, unknown>).output).toBe("legacy");
  });

  it("degrades gracefully when state fields are missing", () => {
    const evts = mapContentEntry({ type: "tool", name: "shell" });
    expect(evts).toHaveLength(1);
    expect((evts[0] as Record<string, unknown>).tool).toBe("shell");
    expect((evts[0] as Record<string, unknown>).exit).toBeUndefined();
  });

  it("skips unknown entry types without crashing", () => {
    expect(mapContentEntry({ type: "mystery" })).toEqual([]);
  });
});

describe("diffMessagesToEvents", () => {
  const settled: SessionMessage[] = [
    assistantMessage({
      id: "msg_1",
      content: [
        { type: "text", text: "done" },
        toolEntry({ name: "shell", command: "echo x", output: "x\n", exit: 0 }),
      ],
      tokens: { input: 100, output: 10, reasoning: 5, cache: { read: 0, write: 0 } },
      time: { created: 1, streamed: 2, completed: 123 },
    }) as unknown as SessionMessage,
  ];

  it("emits events for unseen settled messages", () => {
    const seen = new Map<string, string>();
    const { events, usage } = diffMessagesToEvents(settled, seen);
    expect(events.map((e) => e.type)).toEqual(["text", "tool_use", "step_usage"]);
    expect(usage).toEqual({ input_tokens: 100, output_tokens: 10, total_tokens: 115 });
    expect(seen.has("msg_1")).toBe(true);
  });

  it("does not re-emit unchanged messages", () => {
    const seen = new Map<string, string>();
    const first = diffMessagesToEvents(settled, seen);
    expect(first.events).toHaveLength(3);
    const second = diffMessagesToEvents(settled, seen);
    expect(second.events).toHaveLength(0);
    expect(second.usage.total_tokens).toBe(0);
  });

  it("ignores unsettled messages", () => {
    const unsettled: SessionMessage[] = [
      assistantMessage({
        id: "msg_2",
        content: [{ type: "text", text: "..." }],
        time: { created: 1, streamed: 1 },
      }) as unknown as SessionMessage,
    ];
    const seen = new Map<string, string>();
    const { events } = diffMessagesToEvents(unsettled, seen);
    expect(events).toHaveLength(0);
    expect(seen.has("msg_2")).toBe(false);
  });

  it("re-emits only the mutated entry and never double-counts tokens", () => {
    const tokens = { input: 10, output: 2, reasoning: 1, cache: { read: 0, write: 0 } };
    const running = assistantMessage({
      id: "msg_m",
      tokens,
      time: { created: 1, completed: 5 },
      content: [
        { type: "text", text: "a" },
        toolEntry({
          name: "shell",
          command: "echo x",
          status: "running",
          created: 1,
          completed: 2,
        }),
      ],
    }) as unknown as SessionMessage;
    const done = assistantMessage({
      id: "msg_m",
      tokens,
      time: { created: 1, completed: 6 },
      content: [
        { type: "text", text: "a" },
        toolEntry({
          name: "shell",
          command: "echo x",
          output: "x\n",
          status: "completed",
          created: 1,
          completed: 6,
        }),
      ],
    }) as unknown as SessionMessage;

    const seen = new Map<string, string>();
    const first = diffMessagesToEvents([running], seen);
    expect(first.usage.total_tokens).toBe(13);

    const second = diffMessagesToEvents([done], seen);
    const types = second.events.map((e) => e.type);
    expect(types).toContain("tool_use");
    expect(types).not.toContain("text");
    expect(types).not.toContain("step_usage");
    expect(second.usage.total_tokens).toBe(0);
  });
});

interface Script {
  operation: string;
  respond: string;
  failOnce?: boolean;
  exitCode?: number;
  steady?: boolean;
}

function scriptExec(scripts: Script[]): { exec: ApiExecFn; calls: string[] } {
  const calls: string[] = [];
  const i = 0;
  const byOp = new Map<string, Script[]>();
  for (const s of scripts) {
    const list = byOp.get(s.operation) ?? [];
    list.push(s);
    byOp.set(s.operation, list);
  }
  const used = new Map<string, number>();
  const exec: ApiExecFn = async (args) => {
    const op = args.find((a) => a.includes(".")) ?? "";
    const opName = args[2] ?? op;
    calls.push(opName);
    const list = byOp.get(opName) ?? [];
    const idx = used.get(opName) ?? 0;
    used.set(opName, idx + 1);
    const script = list[Math.min(idx, list.length - 1)];
    if (!script) {
      return { exitCode: 0, stdout: "{}", stderr: "", timedOut: false } as ApiExecResult;
    }
    if (script.failOnce && idx === 0) {
      return { exitCode: 1, stdout: "", stderr: "transient", timedOut: false } as ApiExecResult;
    }
    let stdout = script.respond;
    if (opName === "session.get" && !script.steady && stdout.includes('"updated"')) {
      try {
        const parsed = JSON.parse(stdout) as {
          data?: { time?: { updated?: number } };
        };
        if (typeof parsed.data?.time?.updated === "number") {
          parsed.data.time.updated += idx;
          stdout = JSON.stringify(parsed);
        }
      } catch {
        void 0;
      }
    }
    return {
      exitCode: script.exitCode ?? 0,
      stdout,
      stderr: "",
      timedOut: false,
    } as ApiExecResult;
  };
  return { exec, calls };
}

const idleSleep = () => Promise.resolve();

describe("promptSession size guard", () => {
  it("refuses prompts that would blow the argv size limit", async () => {
    const exec = (async () => ({
      exitCode: 0,
      stdout: "{}",
      stderr: "",
      timedOut: false,
    })) as never;
    const huge = "x".repeat(120_001);
    await expect(
      promptSession(exec, { command: "opencode", serverUrl: null }, "ses_1", huge),
    ).rejects.toMatchObject({ category: "prompt_too_large" });
  });
});

describe("runTurn", () => {
  it("computes the live context size including cache reads", () => {
    const seen = new Map<string, string>();
    const msgs = [
      assistantMessage({
        id: "msg_ctx",
        content: [{ type: "text", text: "a" }],
        tokens: { input: 2000, output: 50, reasoning: 0, cache: { read: 98000, write: 0 } },
        time: { created: 1, completed: 2 },
      }) as unknown as SessionMessage,
    ];
    const { contextTokens } = diffMessagesToEvents(msgs, seen);
    expect(contextTokens).toBe(100050);
  });

  it("returns contextTokens on the turn result", async () => {
    const { exec } = scriptExec([
      { operation: "session.prompt", respond: '{"data":{"id":"msg_user_ctx"}}' },
      { operation: "session.get", respond: sessionGetResponse({ id: "ses_ctx", outcome: null }) },
      {
        operation: "session.get",
        respond: sessionGetResponse({ id: "ses_ctx", outcome: "succeeded" }),
      },
      { operation: "session.permission.list", respond: permissionListResponse([]) },
      { operation: "session.message.list", respond: messageListResponse([]) },
      {
        operation: "session.message.list",
        respond: messageListResponse([
          idleMessage({ id: "idle_ctx", outcome: "succeeded" }),
          assistantMessage({
            id: "msg_ctx2",
            content: [{ type: "text", text: "ok" }],
            tokens: { input: 3000, output: 10, reasoning: 0, cache: { read: 120000, write: 0 } },
            time: { created: 1, completed: 2 },
          }) as unknown as SessionMessage,
          userMessage({ id: "msg_user_ctx" }),
        ]),
      },
    ]);
    const result = await runTurn({
      exec,
      base: { command: "opencode" },
      directory: "/w",
      prompt: "p",
      sessionId: "ses_ctx",
      createOptions: { autoApprove: false },
      pollIntervalMs: 1,
      permissionTimeoutMs: 60000,
      turnTimeoutMs: 60000,
      sleep: idleSleep,
    });
    expect(result.status).toBe("succeeded");
    expect(result.contextTokens).toBe(123010);
  });

  it("creates session, prompts, polls to success with usage and events", async () => {
    const msg1 = messageListResponse([
      assistantMessage({
        id: "msg_1",
        content: [{ type: "text", text: "OK" }],
        tokens: { input: 100, output: 10, reasoning: 5, cache: { read: 0, write: 0 } },
        time: { created: 1, streamed: 1, completed: 1 },
      }),
      userMessage({ id: "msg_user_1" }),
    ]);
    const { exec, calls } = scriptExec([
      { operation: "session.create", respond: sessionCreateResponse({ id: "ses_new" }) },
      { operation: "session.get", respond: sessionGetResponse({ id: "ses_new", outcome: null }) },
      {
        operation: "session.get",
        respond: sessionGetResponse({
          id: "ses_new",
          outcome: "succeeded",
          tokens: { input: 100, output: 10, reasoning: 5, cache: { read: 0, write: 0 } },
        }),
      },
      { operation: "session.permission.list", respond: permissionListResponse([]) },
      { operation: "session.message.list", respond: messageListResponse([]) },
      { operation: "session.message.list", respond: msg1 },
      { operation: "session.prompt", respond: '{"data":{"id":"msg_user_1"}}' },
    ]);
    const events: TurnDriverEvent[] = [];
    const result = await runTurn({
      exec,
      base: { command: "opencode" },
      directory: "/w",
      prompt: "hi",
      sessionId: null,
      createOptions: { autoApprove: true },
      pollIntervalMs: 1,
      permissionTimeoutMs: 60000,
      sleep: idleSleep,
      onEvent: (e) => events.push(e),
    });
    expect(result.status).toBe("succeeded");
    expect(result.sessionId).toBe("ses_new");
    expect(result.usage).toEqual({ input_tokens: 100, output_tokens: 10, total_tokens: 115 });
    expect(calls[0]).toBe("session.create");
    expect(calls).toContain("session.prompt");
    expect(events.map((e) => e.type)).toContain("text");
  });

  it("reuses an existing session without create", async () => {
    const turnList = () => [
      assistantMessage({
        id: "msg_f",
        content: [],
        time: { created: 1, completed: 2 },
      }),
      userMessage({ id: "msg_user_f" }),
    ];
    const { exec, calls } = scriptExec([
      {
        operation: "session.get",
        respond: sessionGetResponse({ id: "ses_x", outcome: "succeeded" }),
      },
      { operation: "session.get", respond: sessionGetResponse({ id: "ses_x", outcome: "failed" }) },
      { operation: "session.permission.list", respond: permissionListResponse([]) },
      { operation: "session.message.list", respond: messageListResponse([]) },
      { operation: "session.message.list", respond: messageListResponse(turnList()) },
      { operation: "session.prompt", respond: '{"data":{"id":"msg_user_f"}}' },
    ]);
    const result = await runTurn({
      exec,
      base: { command: "opencode" },
      directory: "/w",
      prompt: "continue",
      sessionId: "ses_x",
      createOptions: { autoApprove: false },
      pollIntervalMs: 1,
      permissionTimeoutMs: 60000,
      sleep: idleSleep,
    });
    expect(result.status).toBe("failed");
    expect(calls).not.toContain("session.create");
    expect(result.sessionId).toBe("ses_x");
  });

  it("survives a transient poll failure", async () => {
    const turnList = () => [
      idleMessage({ id: "idle_t", outcome: "succeeded" }),
      assistantMessage({
        id: "msg_t",
        content: [{ type: "text", text: "ok" }],
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, completed: 2 },
      }),
      userMessage({ id: "msg_user_t" }),
    ];
    const { exec } = scriptExec([
      { operation: "session.get", respond: "", failOnce: true },
      {
        operation: "session.get",
        respond: sessionGetResponse({ id: "ses_x", outcome: "succeeded" }),
      },
      { operation: "session.permission.list", respond: permissionListResponse([]) },
      { operation: "session.message.list", respond: messageListResponse([]) },
      { operation: "session.message.list", respond: messageListResponse(turnList()) },
      { operation: "session.prompt", respond: '{"data":{"id":"msg_user_t"}}' },
    ]);
    const result = await runTurn({
      exec,
      base: { command: "opencode" },
      directory: "/w",
      prompt: "p",
      sessionId: "ses_x",
      createOptions: { autoApprove: false },
      pollIntervalMs: 1,
      permissionTimeoutMs: 60000,
      sleep: idleSleep,
    });
    expect(result.status).toBe("succeeded");
  });
});

describe("cross-turn message dedup and ordering", () => {
  it("does not re-emit earlier turns' messages when the seen map is shared", () => {
    const history = [
      {
        id: "msg_1",
        type: "assistant",
        content: [{ type: "text", text: "turn one" }],
        time: { completed: 10 },
      },
    ];
    const seen = new Map<string, string>();
    const first = diffMessagesToEvents(history, seen);
    expect(first.events).toHaveLength(1);
    const second = diffMessagesToEvents(history, seen);
    expect(second.events).toHaveLength(0);
  });

  it("processes messages oldest-first so the newest text wins", () => {
    const newestFirst = [
      {
        id: "msg_2",
        type: "assistant",
        content: [{ type: "text", text: "newest" }],
        time: { completed: 20 },
      },
      {
        id: "msg_1",
        type: "assistant",
        content: [{ type: "text", text: "oldest" }],
        time: { completed: 10 },
      },
    ];
    const { events } = diffMessagesToEvents(newestFirst, new Map());
    const texts = events.filter((e) => e.type === "text").map((e) => e.text);
    expect(texts).toEqual(["oldest", "newest"]);
  });
});

describe("turn failure reason (fixture-derived)", () => {
  it("extracts the provider error from the captured failed payload", () => {
    const msg = turnErrorMessage(failedTurnMessages() as SessionMessage[]);
    expect(msg).toContain("provider.auth");
    expect(msg).toContain("Access to model denied");
  });

  it("returns null when no message carries an error", () => {
    expect(turnErrorMessage([])).toBeNull();
    expect(
      turnErrorMessage([{ id: "m", type: "assistant", content: [] } as SessionMessage]),
    ).toBeNull();
  });

  it("surfaces the provider error as the turn result instead of a bare turn failed", async () => {
    const failedMessages = failedTurnMessages();
    const userEntry = failedMessages.find((m) => m.type === "user");
    if (userEntry !== undefined) userEntry.id = "msg_user_err";
    const { exec } = scriptExec([
      { operation: "session.prompt", respond: '{"data":{"id":"msg_user_err"}}' },
      { operation: "session.get", respond: sessionGetResponse({ id: "ses_fail", outcome: null }) },
      {
        operation: "session.get",
        respond: sessionGetResponse({ id: "ses_fail", outcome: "failed" }),
      },
      { operation: "session.permission.list", respond: permissionListResponse([]) },
      { operation: "session.message.list", respond: messageListResponse([]) },
      { operation: "session.message.list", respond: messageListResponse(failedMessages) },
    ]);
    const result = await runTurn({
      exec,
      base: { command: "opencode" },
      directory: "/w",
      prompt: "p",
      sessionId: "ses_fail",
      createOptions: { autoApprove: false },
      pollIntervalMs: 1,
      permissionTimeoutMs: 60000,
      sleep: idleSleep,
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("provider.auth");
    expect(result.error).toContain("Access to model denied");
  });
});

describe("turn completion vs stale outcome (v2 keeps the last turn's outcome on the session)", () => {
  const oldHistory = () => [
    idleMessage({ id: "idle_old", outcome: "succeeded" }),
    { id: "msg_user_old", type: "user", time: { created: 1 }, text: "prev" },
  ];
  const newTurnDone = () => [
    idleMessage({ id: "idle_new", outcome: "succeeded" }),
    assistantMessage({
      id: "msg_new",
      content: [{ type: "text", text: "fresh" }],
      tokens: { input: 7, output: 3, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 2, completed: 3 },
    }),
    { id: "msg_user_new", type: "user", time: { created: 2 }, text: "next" },
    ...oldHistory(),
  ];

  it("does not end the new turn on the previous turn's outcome", async () => {
    const { exec, calls } = scriptExec([
      { operation: "session.prompt", respond: '{"data":{"id":"msg_user_new"}}' },
      {
        operation: "session.get",
        respond: sessionGetResponse({ id: "ses_x", outcome: "succeeded" }),
      },
      {
        operation: "session.get",
        respond: sessionGetResponse({ id: "ses_x", outcome: "succeeded" }),
      },
      { operation: "session.get", respond: sessionGetResponse({ id: "ses_x", outcome: null }) },
      {
        operation: "session.get",
        respond: sessionGetResponse({ id: "ses_x", outcome: "succeeded" }),
      },
      { operation: "session.permission.list", respond: permissionListResponse([]) },
      { operation: "session.message.list", respond: messageListResponse(oldHistory()) },
      {
        operation: "session.message.list",
        respond: messageListResponse([
          { id: "msg_user_new", type: "user", time: { created: 2 }, text: "next" },
          ...oldHistory(),
        ]),
      },
      {
        operation: "session.message.list",
        respond: messageListResponse([
          { id: "msg_user_new", type: "user", time: { created: 2 }, text: "next" },
          ...oldHistory(),
        ]),
      },
      { operation: "session.message.list", respond: messageListResponse(newTurnDone()) },
    ]);
    const result = await runTurn({
      exec,
      base: { command: "opencode" },
      directory: "/w",
      prompt: "next",
      sessionId: "ses_x",
      createOptions: { autoApprove: false },
      pollIntervalMs: 1,
      permissionTimeoutMs: 60000,
      turnTimeoutMs: 60000,
      sleep: idleSleep,
    });
    expect(result.status).toBe("succeeded");
    expect(result.usage).toEqual({ input_tokens: 7, output_tokens: 3, total_tokens: 10 });
    expect(calls.filter((c) => c === "session.get").length).toBeGreaterThanOrEqual(4);
  });

  it("completes via the fresh idle message even while session.get keeps the stale outcome", async () => {
    const { exec } = scriptExec([
      { operation: "session.prompt", respond: '{"data":{"id":"msg_user_new"}}' },
      {
        operation: "session.get",
        respond: sessionGetResponse({ id: "ses_x", outcome: "succeeded" }),
      },
      { operation: "session.permission.list", respond: permissionListResponse([]) },
      { operation: "session.message.list", respond: messageListResponse(oldHistory()) },
      { operation: "session.message.list", respond: messageListResponse(newTurnDone()) },
    ]);
    const result = await runTurn({
      exec,
      base: { command: "opencode" },
      directory: "/w",
      prompt: "next",
      sessionId: "ses_x",
      createOptions: { autoApprove: false },
      pollIntervalMs: 1,
      permissionTimeoutMs: 60000,
      turnTimeoutMs: 60000,
      sleep: idleSleep,
    });
    expect(result.status).toBe("succeeded");
  });

  it("waits for the streaming final answer even when session.get already says succeeded", async () => {
    const streamingFinal = assistantMessage({
      id: "msg_final",
      content: [{ type: "text", text: "长答案……" }],
      tokens: { input: 1651, output: 5039, reasoning: 301, cache: { read: 0, write: 0 } },
      time: { created: 3, streamed: 4 },
    }) as unknown as SessionMessage;
    const settledFinal = assistantMessage({
      id: "msg_final",
      content: [{ type: "text", text: "长答案……" }],
      tokens: { input: 1651, output: 5039, reasoning: 301, cache: { read: 0, write: 0 } },
      time: { created: 3, streamed: 4, completed: 5 },
    }) as unknown as SessionMessage;
    const settledList = () => [
      idleMessage({ id: "idle_new", outcome: "succeeded" }),
      settledFinal,
      userMessage({ id: "msg_user_s" }),
    ];
    const { exec, calls } = scriptExec([
      { operation: "session.prompt", respond: '{"data":{"id":"msg_user_s"}}' },
      { operation: "session.get", respond: sessionGetResponse({ id: "ses_x", outcome: null }) },
      {
        operation: "session.get",
        respond: sessionGetResponse({ id: "ses_x", outcome: "succeeded" }),
      },
      {
        operation: "session.get",
        respond: sessionGetResponse({ id: "ses_x", outcome: "succeeded" }),
      },
      { operation: "session.permission.list", respond: permissionListResponse([]) },
      { operation: "session.message.list", respond: messageListResponse(oldHistory()) },
      {
        operation: "session.message.list",
        respond: messageListResponse([streamingFinal, userMessage({ id: "msg_user_s" })]),
      },
      { operation: "session.message.list", respond: messageListResponse(settledList()) },
    ]);
    const events: TurnDriverEvent[] = [];
    const result = await runTurn({
      exec,
      base: { command: "opencode" },
      directory: "/w",
      prompt: "write a long answer",
      sessionId: "ses_x",
      createOptions: { autoApprove: false },
      pollIntervalMs: 1,
      permissionTimeoutMs: 60000,
      turnTimeoutMs: 60000,
      sleep: idleSleep,
      onEvent: (e) => events.push(e),
    });
    expect(result.status).toBe("succeeded");
    expect(result.usage).toEqual({ input_tokens: 1651, output_tokens: 5039, total_tokens: 6991 });
    expect(events.some((e) => e.type === "text" && e.text === "长答案……")).toBe(true);
    expect(calls.filter((c) => c === "session.get").length).toBeGreaterThanOrEqual(3);
  });

  it("does not complete a same-value stale outcome on quiet polls alone (inter-step silence safety)", async () => {
    const deadEnd = () => [
      assistantMessage({
        id: "msg_dead",
        content: [
          { type: "reasoning", text: "step" },
          toolEntry({ name: "shell", command: "echo x", output: "", status: "error", exit: 1 }),
        ],
        tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 0, write: 0 } },
        time: { created: 2, completed: 3 },
      }) as unknown as SessionMessage,
      userMessage({ id: "msg_user_d" }),
      ...oldHistory(),
    ];
    const { exec, calls } = scriptExec([
      { operation: "session.prompt", respond: '{"data":{"id":"msg_user_d"}}' },
      {
        operation: "session.get",
        respond: sessionGetResponse({ id: "ses_x", outcome: "succeeded" }),
      },
      { operation: "session.permission.list", respond: permissionListResponse([]) },
      { operation: "session.message.list", respond: messageListResponse(oldHistory()) },
      { operation: "session.message.list", respond: messageListResponse(deadEnd()) },
      { operation: "session.message.list", respond: messageListResponse(deadEnd()) },
      { operation: "session.message.list", respond: messageListResponse(deadEnd()) },
      { operation: "session.message.list", respond: messageListResponse(deadEnd()) },
    ]);
    const result = await runTurn({
      exec,
      base: { command: "opencode" },
      directory: "/w",
      prompt: "next",
      sessionId: "ses_x",
      createOptions: { autoApprove: false },
      pollIntervalMs: 1,
      permissionTimeoutMs: 60000,
      turnTimeoutMs: 50,
      interruptGraceMs: 1,
      sleep: idleSleep,
    });
    expect(result.status).toBe("timed_out");
    expect(result.usage.total_tokens).toBe(125);
  });

  it("ignores a late idle from the previous zombie turn until our own prompt is registered", async () => {
    const old = () => [
      assistantMessage({
        id: "msg_old",
        content: [{ type: "text", text: "prev" }],
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, completed: 1 },
      }),
    ];
    const lateIdleOnly = () => [idleMessage({ id: "idle_late", outcome: "succeeded" }), ...old()];
    const realDone = () => [
      idleMessage({ id: "idle_ours", outcome: "succeeded" }),
      assistantMessage({
        id: "msg_new",
        content: [{ type: "text", text: "answer" }],
        tokens: { input: 2, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 2, completed: 3 },
      }),
      userMessage({ id: "msg_user_g" }),
      ...lateIdleOnly(),
    ];
    const { exec, calls } = scriptExec([
      { operation: "session.prompt", respond: '{"data":{"id":"msg_user_g"}}' },
      {
        operation: "session.get",
        respond: sessionGetResponse({ id: "ses_x", outcome: "succeeded" }),
      },
      { operation: "session.permission.list", respond: permissionListResponse([]) },
      { operation: "session.message.list", respond: messageListResponse(old()) },
      { operation: "session.message.list", respond: messageListResponse(lateIdleOnly()) },
      { operation: "session.message.list", respond: messageListResponse(realDone()) },
    ]);
    const result = await runTurn({
      exec,
      base: { command: "opencode" },
      directory: "/w",
      prompt: "next",
      sessionId: "ses_x",
      createOptions: { autoApprove: false },
      pollIntervalMs: 1,
      permissionTimeoutMs: 60000,
      turnTimeoutMs: 60000,
      sleep: idleSleep,
    });
    expect(result.status).toBe("succeeded");
    expect(result.usage.total_tokens).toBe(6);
    expect(calls.filter((c) => c === "session.get").length).toBeGreaterThanOrEqual(3);
  });

  it("keeps the streaming guard even when the baseline snapshot fails", async () => {
    const streaming = () => [
      assistantMessage({
        id: "msg_b",
        content: [{ type: "text", text: "长答案……" }],
        tokens: { input: 5, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, streamed: 1 },
      }),
      userMessage({ id: "msg_user_b" }),
    ];
    const done = () => [
      idleMessage({ id: "idle_b", outcome: "succeeded" }),
      assistantMessage({
        id: "msg_b",
        content: [{ type: "text", text: "长答案……" }],
        tokens: { input: 5, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, streamed: 1, completed: 2 },
      }),
      userMessage({ id: "msg_user_b" }),
    ];
    const { exec, calls } = scriptExec([
      { operation: "session.get", respond: "", exitCode: 1 },
      { operation: "session.get", respond: "", exitCode: 1 },
      { operation: "session.get", respond: sessionGetResponse({ id: "ses_x", outcome: null }) },
      {
        operation: "session.get",
        respond: sessionGetResponse({ id: "ses_x", outcome: "succeeded" }),
      },
      { operation: "session.permission.list", respond: permissionListResponse([]) },
      { operation: "session.message.list", respond: messageListResponse(streaming()) },
      { operation: "session.message.list", respond: messageListResponse(done()) },
      { operation: "session.prompt", respond: '{"data":{"id":"msg_user_b"}}' },
    ]);
    const result = await runTurn({
      exec,
      base: { command: "opencode" },
      directory: "/w",
      prompt: "long answer",
      sessionId: "ses_x",
      createOptions: { autoApprove: false },
      pollIntervalMs: 1,
      permissionTimeoutMs: 60000,
      turnTimeoutMs: 60000,
      sleep: idleSleep,
    });
    expect(result.status).toBe("succeeded");
    expect(result.usage.total_tokens).toBe(10);
    expect(calls.filter((c) => c === "session.get").length).toBeGreaterThanOrEqual(4);
  });

  it("settles a zombie turn shortly after the permission auto-reject (no outcome, no idle message)", async () => {
    const dead = () => [
      assistantMessage({
        id: "msg_dead",
        content: [
          { type: "reasoning", text: "step" },
          toolEntry({ name: "shell", command: "echo x", output: "", status: "error", exit: 1 }),
        ],
        error: { type: "aborted", message: "Step interrupted" },
        tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 0, write: 0 } },
        time: { created: 2, completed: 3 },
      }) as unknown as SessionMessage,
      userMessage({ id: "msg_user_z" }),
      ...oldHistory(),
    ];
    const pendingBody = JSON.stringify({
      data: [{ id: "per_z", sessionID: "ses_x", action: "shell", resources: ["echo x"], save: [] }],
    });
    let clock = 0;
    const { exec } = scriptExec([
      { operation: "session.prompt", respond: '{"data":{"id":"msg_user_z"}}' },
      {
        operation: "session.get",
        respond: sessionGetResponse({ id: "ses_x", outcome: null }),
        steady: true,
      },
      { operation: "session.permission.list", respond: pendingBody },
      { operation: "session.permission.list", respond: pendingBody },
      { operation: "session.permission.list", respond: pendingBody },
      { operation: "session.permission.list", respond: permissionListResponse([]) },
      { operation: "session.message.list", respond: messageListResponse(oldHistory()) },
      { operation: "session.message.list", respond: messageListResponse(dead()) },
    ]);
    const result = await runTurn({
      exec,
      base: { command: "opencode" },
      directory: "/w",
      prompt: "next",
      sessionId: "ses_x",
      createOptions: { autoApprove: false },
      pollIntervalMs: 1,
      permissionTimeoutMs: 2,
      turnTimeoutMs: 60000,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
      now: () => clock,
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("Step interrupted");
  });
});

describe("runTurn timers and interrupt ladder", () => {
  function realNowScript(scripts: Script[]): { exec: ApiExecFn; calls: string[] } {
    const { exec, calls } = scriptExec(scripts);
    return { exec, calls };
  }

  it("a poll timeout does not fail the turn (warn and continue)", async () => {
    let calls = 0;
    const done = JSON.stringify({
      data: [
        { id: "idle_pt", type: "idle", outcome: "succeeded", time: { created: 2 } },
        {
          id: "msg_pt",
          type: "assistant",
          content: [{ type: "text", text: "ok" }],
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, completed: 2 },
        },
        { id: "msg_user_pt", type: "user", time: { created: 1 }, text: "p" },
      ],
    });
    const exec: ApiExecFn = async (args) => {
      const op = args[2] ?? "";
      if (op === "session.prompt") {
        return {
          exitCode: 0,
          stdout: '{"data":{"id":"msg_user_pt"}}',
          stderr: "",
          timedOut: false,
        };
      }
      if (op === "session.get") {
        calls += 1;
        if (calls === 1) {
          return { exitCode: null, stdout: "", stderr: "", timedOut: true };
        }
        return {
          exitCode: 0,
          stdout: '{"data":{"id":"ses_x","outcome":"succeeded"}}',
          stderr: "",
          timedOut: false,
        };
      }
      if (op === "session.permission.list") {
        return { exitCode: 0, stdout: '{"data":[]}', stderr: "", timedOut: false };
      }
      if (op === "session.message.list") {
        return {
          exitCode: 0,
          stdout: calls === 1 ? '{"data":[]}' : done,
          stderr: "",
          timedOut: false,
        };
      }
      return { exitCode: 0, stdout: "{}", stderr: "", timedOut: false };
    };
    const result = await runTurn({
      exec,
      base: { command: "opencode" },
      directory: "/w",
      prompt: "p",
      sessionId: "ses_x",
      createOptions: { autoApprove: false },
      pollIntervalMs: 1,
      permissionTimeoutMs: 60000,
      sleep: idleSleep,
    });
    expect(result.status).toBe("succeeded");
  });

  it("wall-clock timeout triggers interrupt and settles timed_out", async () => {
    const { exec, calls } = realNowScript([
      { operation: "session.prompt", respond: '{"data":{"id":"m"}}' },
      { operation: "session.get", respond: sessionGetResponse({ id: "ses_x", outcome: null }) },
      { operation: "session.permission.list", respond: permissionListResponse([]) },
      { operation: "session.message.list", respond: messageListResponse([]) },
      { operation: "session.interrupt", respond: interruptResponse() },
    ]);
    let clock = 0;
    const result = await runTurn({
      exec,
      base: { command: "opencode" },
      directory: "/w",
      prompt: "p",
      sessionId: "ses_x",
      createOptions: { autoApprove: false },
      pollIntervalMs: 1,
      permissionTimeoutMs: 60000,
      turnTimeoutMs: 1000,
      interruptGraceMs: 5,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
      now: () => clock,
    });
    expect(result.status).toBe("timed_out");
    expect(result.error).toBe("turn_timeout");
    expect(calls).toContain("session.interrupt");
  });

  it("inactivity timeout settles timed_out with inactivity_timeout reason", async () => {
    const { exec } = realNowScript([
      { operation: "session.prompt", respond: '{"data":{"id":"m"}}' },
      {
        operation: "session.get",
        respond: sessionGetResponse({ id: "ses_x", outcome: null }),
        steady: true,
      },
      { operation: "session.permission.list", respond: permissionListResponse([]) },
      {
        operation: "session.message.list",
        respond: messageListResponse([userMessage({ id: "m" })]),
      },
      { operation: "session.interrupt", respond: interruptResponse() },
    ]);
    let clock = 0;
    const result = await runTurn({
      exec,
      base: { command: "opencode" },
      directory: "/w",
      prompt: "p",
      sessionId: "ses_x",
      createOptions: { autoApprove: false },
      pollIntervalMs: 1,
      permissionTimeoutMs: 60000,
      inactivityTimeoutMs: 500,
      interruptGraceMs: 5,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
      now: () => clock,
    });
    expect(result.status).toBe("timed_out");
    expect(result.error).toBe("inactivity_timeout");
  });

  it("refetches messages only when the session signals a change", async () => {
    let updated = 5000;
    let messageLists = 0;
    let getCalled = 0;
    const doneList = () => [
      idleMessage({ id: "idle_g1", outcome: "succeeded" }),
      assistantMessage({
        id: "msg_g1",
        content: [{ type: "text", text: "ok" }],
        tokens: { input: 3, output: 3, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, completed: 2 },
      }) as unknown as SessionMessage,
      userMessage({ id: "msg_user_g1" }),
    ];
    const exec: ApiExecFn = async (args) => {
      const op = args[2] ?? "";
      if (op === "session.prompt")
        return {
          exitCode: 0,
          stdout: '{"data":{"id":"msg_user_g1"}}',
          stderr: "",
          timedOut: false,
        };
      if (op === "session.get") {
        getCalled += 1;
        if (getCalled === 6) updated = 6000;
        return {
          exitCode: 0,
          stdout: `{"data":{"id":"ses_x","outcome":null,"time":{"created":1,"updated":${updated}}}}`,
          stderr: "",
          timedOut: false,
        };
      }
      if (op === "session.permission.list")
        return { exitCode: 0, stdout: '{"data":[]}', stderr: "", timedOut: false };
      if (op === "session.message.list") {
        messageLists += 1;
        const payload = updated < 6000 ? [userMessage({ id: "msg_user_g1" })] : doneList();
        return { exitCode: 0, stdout: messageListResponse(payload), stderr: "", timedOut: false };
      }
      return { exitCode: 0, stdout: "{}", stderr: "", timedOut: false };
    };
    await runTurn({
      exec,
      base: { command: "opencode" },
      directory: "/w",
      prompt: "p",
      sessionId: "ses_x",
      createOptions: { autoApprove: false },
      pollIntervalMs: 1,
      permissionTimeoutMs: 60000,
      turnTimeoutMs: 30,
      interruptGraceMs: 1,
      sleep: () => Promise.resolve(),
    });
    expect(getCalled).toBeGreaterThanOrEqual(6);
    expect(messageLists).toBe(3);
  });

  it("does not run the inactivity clock while the prompt is still queued server-side", async () => {
    const old = () => [
      idleMessage({ id: "idle_q", outcome: "succeeded" }),
      assistantMessage({
        id: "msg_q_old",
        content: [{ type: "text", text: "prev" }],
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, completed: 1 },
      }),
    ];
    const done = () => [
      idleMessage({ id: "idle_q2", outcome: "succeeded" }),
      assistantMessage({
        id: "msg_q_new",
        content: [{ type: "text", text: "late" }],
        tokens: { input: 2, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 2, completed: 3 },
      }),
      userMessage({ id: "msg_user_q" }),
      ...old(),
    ];
    let clock = 0;
    let registered = false;
    const exec: ApiExecFn = async (args) => {
      const op = args[2] ?? "";
      if (op === "session.prompt")
        return { exitCode: 0, stdout: '{"data":{"id":"msg_user_q"}}', stderr: "", timedOut: false };
      if (op === "session.get")
        return {
          exitCode: 0,
          stdout: `{"data":{"id":"ses_x","outcome":${registered ? '"succeeded"' : '"succeeded"'}}}`,
          stderr: "",
          timedOut: false,
        };
      if (op === "session.permission.list")
        return { exitCode: 0, stdout: '{"data":[]}', stderr: "", timedOut: false };
      if (op === "session.message.list")
        return {
          exitCode: 0,
          stdout: messageListResponse(registered ? done() : old()),
          stderr: "",
          timedOut: false,
        };
      return { exitCode: 0, stdout: "{}", stderr: "", timedOut: false };
    };
    const origSleep = (ms: number) => {
      clock += ms;
      if (clock > 900) registered = true;
      return Promise.resolve();
    };
    const result = await runTurn({
      exec,
      base: { command: "opencode" },
      directory: "/w",
      prompt: "p",
      sessionId: "ses_x",
      createOptions: { autoApprove: false },
      pollIntervalMs: 100,
      permissionTimeoutMs: 60000,
      inactivityTimeoutMs: 500,
      turnTimeoutMs: 60000,
      interruptGraceMs: 1,
      sleep: origSleep,
      now: () => clock,
    });
    expect(result.status).toBe("succeeded");
    expect(clock).toBeGreaterThanOrEqual(900);
  });

  it("counts an advancing session.updatedAt as activity (long tool is not killed)", async () => {
    let calls = 0;
    let clock = 0;
    const exec: ApiExecFn = async (args) => {
      const op = args[2] ?? "";
      if (op === "session.prompt")
        return { exitCode: 0, stdout: '{"data":{}}', stderr: "", timedOut: false };
      if (op === "session.permission.list")
        return { exitCode: 0, stdout: '{"data":[]}', stderr: "", timedOut: false };
      if (op === "session.message.list")
        return { exitCode: 0, stdout: '{"data":[]}', stderr: "", timedOut: false };
      if (op === "session.get") {
        calls += 1;
        const done = calls >= 5;
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            data: { id: "ses_x", outcome: done ? "succeeded" : null, time: { updated: clock + 1 } },
          }),
          stderr: "",
          timedOut: false,
        };
      }
      return { exitCode: 0, stdout: "{}", stderr: "", timedOut: false };
    };
    const result = await runTurn({
      exec,
      base: { command: "opencode" },
      directory: "/w",
      prompt: "p",
      sessionId: "ses_x",
      createOptions: { autoApprove: false },
      pollIntervalMs: 50,
      permissionTimeoutMs: 60000,
      inactivityTimeoutMs: 100,
      interruptGraceMs: 5,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
      now: () => clock,
    });
    expect(result.status).toBe("succeeded");
  });

  it("pending permission pauses wall clock; expiry auto-rejects and resumes", async () => {
    const pending = JSON.stringify({
      data: [
        {
          id: "per_1",
          sessionID: "ses_x",
          action: "shell",
          resources: ["echo x"],
          save: ["echo *"],
        },
      ],
    });
    const msgDone =
      '{"data":[{"id":"msg_1","type":"assistant","content":[{"type":"text","text":"after approval"}],"time":{"completed":9}}]}';
    let phase = 0;
    const calls: string[] = [];
    const exec: ApiExecFn = async (args) => {
      const op = args[2] ?? "";
      calls.push(op);
      if (op === "session.prompt")
        return { exitCode: 0, stdout: '{"data":{}}', stderr: "", timedOut: false };
      if (op === "session.permission.list") {
        return {
          exitCode: 0,
          stdout: phase === 0 ? pending : '{"data":[]}',
          stderr: "",
          timedOut: false,
        };
      }
      if (op === "session.permission.reply") {
        phase = 1;
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
      }
      if (op === "session.message.list") {
        return {
          exitCode: 0,
          stdout: phase === 0 ? '{"data":[]}' : msgDone,
          stderr: "",
          timedOut: false,
        };
      }
      if (op === "session.get") {
        return {
          exitCode: 0,
          stdout:
            phase === 0
              ? '{"data":{"id":"ses_x","outcome":null}}'
              : '{"data":{"id":"ses_x","outcome":"succeeded"}}',
          stderr: "",
          timedOut: false,
        };
      }
      return { exitCode: 0, stdout: "{}", stderr: "", timedOut: false };
    };
    let clock = 0;
    let sawPending = 0;
    const replyDecisions: string[] = [];
    const result = await runTurn({
      exec,
      base: { command: "opencode" },
      directory: "/w",
      prompt: "p",
      sessionId: "ses_x",
      createOptions: { autoApprove: false },
      pollIntervalMs: 1,
      permissionTimeoutMs: 800,
      turnTimeoutMs: 300,
      interruptGraceMs: 5,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
      now: () => clock,
      onPendingPermissions: (list) => {
        sawPending += list.length;
      },
      onPermissionReply: (requestID, decision) => {
        replyDecisions.push(`${requestID}:${decision}`);
      },
    });
    expect(result.status).toBe("succeeded");
    expect(replyDecisions).toEqual(["per_1:reject"]);
    expect(sawPending).toBeGreaterThan(0);
  });

  it("a transient permission.list failure does not reconcile pendings away", async () => {
    const pendingBody = JSON.stringify({
      data: [{ id: "per_t", sessionID: "ses_x", action: "shell", resources: ["echo x"] }],
    });
    let listCalls = 0;
    let clock = 0;
    const getCounter = { n: 0 };
    const exec: ApiExecFn = async (args) => {
      const op = args[2] ?? "";
      if (op === "session.prompt")
        return { exitCode: 0, stdout: '{"data":{}}', stderr: "", timedOut: false };
      let getCalls = 0;
      if (op === "session.get") {
        getCalls = ++getCounter.n;
        return {
          exitCode: 0,
          stdout: `{"data":{"id":"ses_x","outcome":${getCalls >= 5 ? '"succeeded"' : "null"}}}`,
          stderr: "",
          timedOut: false,
        };
      }
      if (op === "session.permission.list") {
        listCalls += 1;
        if (listCalls === 1) {
          return { exitCode: 1, stdout: "", stderr: "boom", timedOut: false };
        }
        if (listCalls <= 4) {
          return { exitCode: 0, stdout: pendingBody, stderr: "", timedOut: false };
        }
        return { exitCode: 0, stdout: '{"data":[]}', stderr: "", timedOut: false };
      }
      if (op === "session.message.list")
        return { exitCode: 0, stdout: '{"data":[]}', stderr: "", timedOut: false };
      return { exitCode: 0, stdout: "{}", stderr: "", timedOut: false };
    };
    const ingests: number[] = [];
    const result = await runTurn({
      exec,
      base: { command: "opencode" },
      directory: "/w",
      prompt: "p",
      sessionId: "ses_x",
      createOptions: { autoApprove: false },
      pollIntervalMs: 1,
      permissionTimeoutMs: 60000,
      turnTimeoutMs: 60000,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
      now: () => clock,
      onPendingPermissions: (list) => {
        ingests.push(list.length);
      },
    });
    expect(listCalls).toBeGreaterThanOrEqual(2);
    expect(ingests.length).toBeGreaterThanOrEqual(1);
    expect(ingests[0]).toBe(1);
    expect(result.status).toBe("succeeded");
  });
});
