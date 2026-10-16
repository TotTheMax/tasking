import { describe, expect, it } from "vitest";
import type { ApiExecFn, ApiExecResult } from "../src/driver/api-client.js";
import type { SessionMessage } from "../src/driver/session-ops.js";
import {
  type TurnDriverEvent,
  diffMessagesToEvents,
  mapContentEntry,
  runTurn,
} from "../src/driver/turn-driver.js";

describe("mapContentEntry", () => {
  it("maps text entries", () => {
    const evts = mapContentEntry({ type: "text", text: "hello" }, "msg_1");
    expect(evts).toEqual([{ type: "text", text: "hello" }]);
  });

  it("maps tool entries with full execution detail", () => {
    const evts = mapContentEntry(
      {
        type: "tool",
        tool: "shell",
        state: {
          status: "completed",
          input: { command: "echo x" },
          output: "x\n",
          metadata: { status: "completed", truncated: false, exit: 0 },
          time: { created: 1000, ran: 1100, completed: 1500 },
        },
      },
      "msg_1",
    );
    expect(evts).toHaveLength(1);
    const evt = evts[0] as Record<string, unknown>;
    expect(evt.type).toBe("tool_use");
    expect(evt.tool).toBe("shell");
    expect(evt.input).toEqual({ command: "echo x" });
    expect(evt.exit).toBe(0);
    expect(evt.durationMs).toBe(500);
  });

  it("degrades gracefully when state fields are missing", () => {
    const evts = mapContentEntry({ type: "tool", tool: "shell" }, "msg_1");
    expect(evts).toHaveLength(1);
    expect((evts[0] as Record<string, unknown>).tool).toBe("shell");
    expect((evts[0] as Record<string, unknown>).exit).toBeUndefined();
  });

  it("skips unknown entry types without crashing", () => {
    expect(mapContentEntry({ type: "mystery" }, "msg_1")).toEqual([]);
  });
});

describe("diffMessagesToEvents", () => {
  const settled: SessionMessage[] = [
    {
      id: "msg_1",
      type: "assistant",
      content: [
        { type: "text", text: "done" },
        { type: "tool", tool: "shell", state: { metadata: { exit: 0 } } },
      ],
      tokens: { input: 100, output: 10, reasoning: 5, cache: { read: 0, write: 0 } },
      time: { completed: 123 },
    },
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
      { id: "msg_2", type: "assistant", content: [{ type: "text", text: "..." }] },
    ];
    const seen = new Map<string, string>();
    const { events } = diffMessagesToEvents(unsettled, seen);
    expect(events).toHaveLength(0);
    expect(seen.has("msg_2")).toBe(false);
  });
});

interface Script {
  operation: string;
  respond: string;
  failOnce?: boolean;
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
    return { exitCode: 0, stdout: script.respond, stderr: "", timedOut: false } as ApiExecResult;
  };
  return { exec, calls };
}

const idleSleep = () => Promise.resolve();

describe("runTurn", () => {
  it("creates session, prompts, polls to success with usage and events", async () => {
    const msg1 =
      '{"data":[{"id":"msg_1","type":"assistant","content":[{"type":"text","text":"OK"}],"tokens":{"input":100,"output":10,"reasoning":5,"cache":{"read":0,"write":0}},"time":{"completed":1}}]}';
    const { exec, calls } = scriptExec([
      { operation: "session.create", respond: '{"data":{"id":"ses_new"}}' },
      { operation: "session.prompt", respond: '{"data":{"id":"msg_0"}}' },
      { operation: "session.get", respond: '{"data":{"id":"ses_new","outcome":null}}' },
      {
        operation: "session.get",
        respond:
          '{"data":{"id":"ses_new","outcome":"succeeded","tokens":{"input":100,"output":10,"reasoning":5,"cache":{"read":0,"write":0}}}}',
      },
      { operation: "session.permission.list", respond: '{"data":[]}' },
      { operation: "session.message.list", respond: msg1 },
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
    const { exec, calls } = scriptExec([
      { operation: "session.prompt", respond: '{"data":{"id":"m"}}' },
      { operation: "session.get", respond: '{"data":{"id":"ses_x","outcome":"failed"}}' },
      { operation: "session.permission.list", respond: '{"data":[]}' },
      { operation: "session.message.list", respond: '{"data":[]}' },
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
    const { exec } = scriptExec([
      { operation: "session.prompt", respond: '{"data":{"id":"m"}}' },
      { operation: "session.get", respond: "", failOnce: true },
      { operation: "session.get", respond: '{"data":{"id":"ses_x","outcome":"succeeded"}}' },
      { operation: "session.permission.list", respond: '{"data":[]}' },
      { operation: "session.message.list", respond: '{"data":[]}' },
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

describe("runTurn timers and interrupt ladder", () => {
  function realNowScript(scripts: Script[]): { exec: ApiExecFn; calls: string[] } {
    const { exec, calls } = scriptExec(scripts);
    return { exec, calls };
  }

  it("a poll timeout does not fail the turn (warn and continue)", async () => {
    let calls = 0;
    const exec: ApiExecFn = async (args) => {
      const op = args[2] ?? "";
      if (op === "session.prompt") {
        return { exitCode: 0, stdout: '{"data":{}}', stderr: "", timedOut: false };
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
        return { exitCode: 0, stdout: '{"data":[]}', stderr: "", timedOut: false };
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
      { operation: "session.get", respond: '{"data":{"id":"ses_x","outcome":null}}' },
      { operation: "session.permission.list", respond: '{"data":[]}' },
      { operation: "session.message.list", respond: '{"data":[]}' },
      { operation: "session.interrupt", respond: '{"interrupted":true}' },
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
      { operation: "session.get", respond: '{"data":{"id":"ses_x","outcome":null}}' },
      { operation: "session.permission.list", respond: '{"data":[]}' },
      { operation: "session.message.list", respond: '{"data":[]}' },
      { operation: "session.interrupt", respond: '{"interrupted":true}' },
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
      onPendingPermissions: () => {
        sawPending += 1;
      },
      onPermissionReply: (requestID, decision) => {
        replyDecisions.push(`${requestID}:${decision}`);
      },
    });
    expect(result.status).toBe("succeeded");
    expect(replyDecisions).toEqual(["per_1:reject"]);
    expect(sawPending).toBeGreaterThan(0);
  });
});
